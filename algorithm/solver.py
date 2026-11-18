"""Budgeted hybrid search over worker partitions and feasible machine sequences.

The evaluator is exact for a fixed solution: it finds longest paths in the union
of incident precedences and brigade queue edges. Small problems also receive an
exhaustive branch-and-bound search; large problems keep a feasible incumbent.
"""

from __future__ import annotations

import math
import random
import time
from dataclasses import dataclass
from functools import lru_cache
from itertools import combinations

from .models import Brigade, ConflictMatrix, Problem, Solution, identifier, number


Groups = tuple[tuple[int, ...], ...]
Routes = tuple[tuple[int, ...], ...]
DEFAULT_TIME_LIMIT_SECONDS = 30


@dataclass(frozen=True)
class Evaluation:
    makespan_seconds: float
    starts: tuple[float, ...]
    durations: tuple[float, ...]
    owners: tuple[int, ...]

    @property
    def score(self) -> tuple[float, float]:
        # Cmax is always the primary objective. Completion sum only breaks ties.
        return self.makespan_seconds, sum(s + d for s, d in zip(self.starts, self.durations))


@dataclass(frozen=True)
class Candidate:
    groups: Groups
    routes: Routes
    evaluation: Evaluation


@dataclass(frozen=True)
class OptimizationResult:
    solution: Solution
    evaluation: Evaluation
    lower_bound_seconds: float
    evaluated_candidates: int
    iterations: int
    elapsed_seconds: float
    seed: int
    stop_reason: str
    improvements: tuple[tuple[int, float], ...]
    optimality_proven: bool = False
    exact_nodes: int = 0


class _Context:
    def __init__(self, problem: Problem, conflicts: ConflictMatrix | None):
        self.problem = problem
        self.conflicts = conflicts if conflicts is not None else ConflictMatrix.zeros(problem.employees)
        self.employee_index = {e.tabel: i for i, e in enumerate(problem.employees)}
        self.event_index = {e.event_id: i for i, e in enumerate(problem.incidents)}
        if set(self.conflicts.employee_ids) != self.employee_index.keys():
            raise ValueError("Conflict matrix IDs must match the problem employees exactly")
        matrix_index = {employee: i for i, employee in enumerate(self.conflicts.employee_ids)}
        self.matrix = tuple(tuple(self.conflicts.values[matrix_index[a]][matrix_index[b]]
                                 for b in self.employee_index) for a in self.employee_index)
        self.resources = sorted({e.resource for e in problem.incidents})
        self.skills = tuple(tuple(float(e.qualifications.get(r, 0)) / 5 for r in self.resources)
                            for e in problem.employees)
        self.resource_indices = tuple(self.resources.index(e.resource) for e in problem.incidents)
        self.bases = tuple(float(e.base_duration_seconds) for e in problem.incidents)
        self.n, self.m = len(problem.employees), len(problem.incidents)
        self.successors = [set() for _ in range(self.m)]
        self.predecessors = [set() for _ in range(self.m)]
        for source_id, target_id in problem.precedences:
            source, target = self.event_index[source_id], self.event_index[target_id]
            self.successors[source].add(target)
            self.predecessors[target].add(source)
        self.successors = tuple(tuple(sorted(row)) for row in self.successors)
        self.predecessors = tuple(tuple(sorted(row)) for row in self.predecessors)
        self.indegrees = tuple(map(len, self.predecessors))
        degrees = list(self.indegrees)
        ordered = [i for i, degree in enumerate(degrees) if degree == 0]
        for source in ordered:
            for target in self.successors[source]:
                degrees[target] -= 1
                if degrees[target] == 0:
                    ordered.append(target)
        if len(ordered) != self.m:
            raise ValueError("Incident precedence graph contains a cycle")
        self.topological = tuple(ordered)
        # Remove redundant transitive edges, retaining exactly the same partial
        # order. This matters when the loader supplies the transitive closure.
        reachable = [0] * self.m
        reduced = [[] for _ in range(self.m)]
        position = {event: i for i, event in enumerate(ordered)}
        for source in reversed(ordered):
            for target in sorted(self.successors[source], key=position.__getitem__):
                if not reachable[source] & (1 << target):
                    reduced[source].append(target)
                    reachable[source] |= (1 << target) | reachable[target]
        self.successors = tuple(tuple(row) for row in reduced)
        incoming = [[] for _ in range(self.m)]
        for source, row in enumerate(self.successors):
            for target in row:
                incoming[target].append(source)
        self.predecessors = tuple(tuple(row) for row in incoming)
        self.indegrees = tuple(map(len, incoming))
        self.reachable = tuple(reachable)
        self.metrics = lru_cache(maxsize=8192)(self._metrics)
        self.evaluations = 0

    def _metrics(self, group: tuple[int, ...]) -> tuple[tuple[float, ...], float]:
        kmax = max((self.matrix[a][b] for pos, a in enumerate(group) for b in group[pos + 1:]), default=0)
        speeds = tuple(sum(self.skills[worker][r] for worker in group) / (1 + kmax)
                       for r in range(len(self.resources)))
        durations = tuple(base / speeds[r] if speeds[r] else math.inf
                          for base, r in zip(self.bases, self.resource_indices))
        return durations, kmax

    def from_solution(self, solution: Solution) -> tuple[Groups, Routes]:
        brigade_ids = [identifier(b.brigade_id, "brigade_id") for b in solution.brigades]
        if not brigade_ids or len(set(brigade_ids)) != len(brigade_ids):
            raise ValueError("Brigade IDs must be unique and solution must not be empty")
        workers = [identifier(w, "employee") for b in solution.brigades for w in b.employees]
        events = [identifier(e, "event") for b in solution.brigades for e in b.event_order]
        if len(workers) != self.n or set(workers) != self.employee_index.keys():
            raise ValueError("Every employee must be assigned exactly once")
        if len(events) != self.m or set(events) != self.event_index.keys():
            raise ValueError("Every active incident must be assigned exactly once")
        if any(not 2 <= len(b.employees) <= 5 or not b.event_order for b in solution.brigades):
            raise ValueError("Every brigade needs 2..5 employees and at least one incident")
        return (tuple(tuple(sorted(self.employee_index[w] for w in b.employees)) for b in solution.brigades),
                tuple(tuple(self.event_index[e] for e in b.event_order) for b in solution.brigades))

    def to_solution(self, candidate: Candidate) -> Solution:
        return Solution(tuple(Brigade(i + 1,
                                     tuple(self.problem.employees[w].tabel for w in group),
                                     tuple(self.problem.incidents[e].event_id for e in route))
                              for i, (group, route) in enumerate(zip(candidate.groups, candidate.routes))))

    def evaluate(self, groups: Groups, routes: Routes) -> Evaluation | None:
        self.evaluations += 1
        # Internal candidates preserve employee/event membership by construction.
        if any(not 2 <= len(group) <= 5 for group in groups) or any(not route for route in routes):
            return None
        owners, durations = [-1] * self.m, [0.0] * self.m
        outgoing = [list(row) for row in self.successors]
        degrees = list(self.indegrees)
        for brigade, (group, route) in enumerate(zip(groups, routes)):
            times, _ = self.metrics(group)
            for event in route:
                owners[event], durations[event] = brigade, times[event]
                if not math.isfinite(times[event]):
                    return None
            for source, target in zip(route, route[1:]):
                outgoing[source].append(target)
                degrees[target] += 1
        starts = [0.0] * self.m
        ready = [i for i, degree in enumerate(degrees) if degree == 0]
        makespan = 0.0
        for source in ready:
            finish = starts[source] + durations[source]
            makespan = max(makespan, finish)
            for target in outgoing[source]:
                starts[target] = max(starts[target], finish)
                degrees[target] -= 1
                if degrees[target] == 0:
                    ready.append(target)
        if len(ready) != self.m or not math.isfinite(makespan):
            return None  # Includes deadlock cycles introduced by brigade orders.
        return Evaluation(makespan, tuple(starts), tuple(durations), tuple(owners))

    def lower_bound(self) -> float:
        # Optimistic speed: each task may use the five strongest workers, with K=0,
        # independently of other tasks. A real fixed partition cannot beat this.
        fastest = [sum(sorted((worker[r] for worker in self.skills), reverse=True)[:5])
                   for r in range(len(self.resources))]
        finish = [0.0] * self.m
        for event in self.topological:
            finish[event] = (max((finish[p] for p in self.predecessors[event]), default=0)
                             + self.bases[event] / fastest[self.resource_indices[event]])
        work = [sum(base for base, r in zip(self.bases, self.resource_indices) if r == resource)
                for resource in range(len(self.resources))]
        capacity = [sum(worker[r] for worker in self.skills) for r in range(len(work))]
        bounds = [max(finish), *(w / s for w, s in zip(work, capacity))]
        # A worker can process only ONE resource at a time. For any nonnegative
        # resource weights w, total weighted work / sum(max_r(w_r * skill_ir))
        # is a lower bound, even allowing workers to regroup/preempt with K=0.
        weights = [[1.0] * len(work), [1 / s for s in capacity]]
        for a, b in combinations(range(len(work)), 2):
            # All breakpoints of the two-resource relaxation. For two resources
            # this maximizes the bound exactly; for more, each pair is valid.
            for worker in self.skills:
                if worker[a] and worker[b]:
                    row = [0.0] * len(work)
                    row[a], row[b] = worker[b], worker[a]
                    weights.append(row)
        for row in weights:
            rate = sum(max(w * s for w, s in zip(row, worker)) for worker in self.skills)
            bounds.append(sum(w * value for w, value in zip(row, work)) / rate)
        return max(bounds)


def evaluate(problem: Problem, solution: Solution, conflicts: ConflictMatrix | None = None) -> Evaluation:
    context = _Context(problem, conflicts)
    groups, routes = context.from_solution(solution)
    result = context.evaluate(groups, routes)
    if result is None:
        raise ValueError("Infeasible solution: missing qualification or cycle in brigade orders/dependencies")
    return result


def _matching(options: list[list[int]]) -> dict[int, int]:
    """Maximum bipartite matching: left index -> distinct right index."""
    right_owner: dict[int, int] = {}

    def augment(left: int, seen: set[int]) -> bool:
        for right in options[left]:
            if right in seen:
                continue
            seen.add(right)
            if right not in right_owner or augment(right_owner[right], seen):
                right_owner[right] = left
                return True
        return False

    for left in range(len(options)):
        augment(left, set())
    return {left: right for right, left in right_owner.items()}


def _partition(context: _Context, count: int, rng: random.Random, variant: int) -> Groups:
    # A distinct qualified anchor/event pair per group guarantees that every
    # brigade can get work. Even employees without any skill are all included.
    workers = list(range(context.n))
    rng.shuffle(workers)
    options = []
    for worker in workers:
        compatible = [e for e, r in enumerate(context.resource_indices) if context.skills[worker][r] > 0]
        rng.shuffle(compatible)
        options.append(compatible)
    matched = _matching(options)
    anchors = [workers[i] for i in matched]
    rng.shuffle(anchors)
    if len(anchors) < count:
        raise ValueError("Too few qualified workers/compatible incidents for this brigade count")
    groups = [[worker] for worker in anchors[:count]]
    remaining = [worker for worker in workers if worker not in anchors[:count]]
    capacities = [context.n // count + (i < context.n % count) for i in range(count)]
    rng.shuffle(capacities)
    if variant % 3 != 2:
        remaining.sort(key=lambda worker: max(context.skills[worker]), reverse=True)
    for worker in remaining:
        available = [i for i, group in enumerate(groups) if len(group) < capacities[i]]
        if variant % 3 == 0:
            # Build specialized groups with similar resource profiles.
            selected = max(available, key=lambda i: (
                sum(context.skills[worker][r] * sum(context.skills[w][r] for w in groups[i])
                    for r in range(len(context.resources))) / len(groups[i]), -len(groups[i]), -i))
        elif variant % 3 == 1:
            selected = min(available, key=lambda i: (sum(sum(context.skills[w]) for w in groups[i]), i))
        else:
            selected = rng.choice(available)
        groups[selected].append(worker)
    return tuple(tuple(sorted(group)) for group in groups)


def _decode(context: _Context, groups: Groups, rng: random.Random, noise: float = 0) -> Candidate | None:
    """Precedence-ready list scheduling, earliest finish with insertion into gaps.

    Scheduling a future task can reserve its best brigade and leave it waiting;
    independent jobs may be inserted into the resulting gaps. This is not limited
    to a non-delay policy.
    """
    times = [context.metrics(group)[0] for group in groups]
    minimum = [min(row[e] for row in times) for e in range(context.m)]
    if any(not math.isfinite(value) for value in minimum):
        return None
    rank = [0.0] * context.m
    for event in reversed(context.topological):
        rank[event] = minimum[event] + max((rank[e] for e in context.successors[event]), default=0)
    priorities = [value * (1 + rng.uniform(-noise, noise)) for value in rank]

    def schedule(forced: dict[int, int]) -> Routes:
        timelines: list[list[tuple[float, float, int]]] = [[] for _ in groups]
        finish = [0.0] * context.m
        degrees = list(context.indegrees)
        ready = [i for i, degree in enumerate(degrees) if degree == 0]
        while ready:
            event = max(ready, key=lambda e: (priorities[e], -e))
            ready.remove(event)
            release = max((finish[p] for p in context.predecessors[event]), default=0)
            choices = []
            for brigade, timeline in enumerate(timelines):
                if event in forced and brigade != forced[event]:
                    continue
                duration = times[brigade][event]
                if not math.isfinite(duration):
                    continue
                start, position = release, 0
                for position, (begin, end, _) in enumerate(timeline):
                    if start + duration <= begin:
                        break
                    start = max(start, end)
                else:
                    position = len(timeline)
                choices.append((start + duration, start, brigade, position))
            end, start, brigade, position = min(choices)
            timelines[brigade].insert(position, (start, end, event))
            finish[event] = end
            for successor in context.successors[event]:
                degrees[successor] -= 1
                if degrees[successor] == 0:
                    ready.append(successor)
        return tuple(tuple(event for _, _, event in timeline) for timeline in timelines)

    routes = schedule({})
    if any(not route for route in routes):
        # Reserve a distinct compatible event per brigade only when greedy EFT
        # left empty groups. Prefer its current events to disturb as little as possible.
        options = [list(route) + [e for e in range(context.m) if e not in route and math.isfinite(times[b][e])]
                   for b, route in enumerate(routes)]
        matched = _matching(options)
        if len(matched) != len(groups):
            return None
        routes = schedule({event: brigade for brigade, event in matched.items()})
    result = context.evaluate(groups, routes)
    return Candidate(groups, routes, result) if result is not None else None


def _mutate(context: _Context, candidate: Candidate, rng: random.Random) -> Candidate | None:
    groups, routes = [list(group) for group in candidate.groups], [list(route) for route in candidate.routes]
    count = len(groups)
    kind = rng.random()
    if kind < 0.28 and count > 1:
        a, b = rng.sample(range(count), 2)
        x, y = rng.randrange(len(groups[a])), rng.randrange(len(groups[b]))
        groups[a][x], groups[b][y] = groups[b][y], groups[a][x]
    elif kind < 0.44 and count > 1:
        donors = [i for i, group in enumerate(groups) if len(group) > 2]
        receivers = [i for i, group in enumerate(groups) if len(group) < 5]
        if not donors or not receivers:
            return None
        a = rng.choice(donors)
        receivers = [i for i in receivers if i != a]
        if not receivers:
            return None
        b = rng.choice(receivers)
        groups[b].append(groups[a].pop(rng.randrange(len(groups[a]))))
    elif kind < 0.78:
        # Biased toward the critical brigade, while still exploring all events.
        critical = max(range(context.m), key=lambda e: candidate.evaluation.starts[e] + candidate.evaluation.durations[e])
        a = candidate.evaluation.owners[critical] if rng.random() < 0.6 else rng.randrange(count)
        b = rng.randrange(count)
        if a != b and len(routes[a]) == 1:
            return None
        event = routes[a].pop(rng.randrange(len(routes[a])))
        routes[b].insert(rng.randrange(len(routes[b]) + 1), event)
    elif kind < 0.93:
        a, b = rng.randrange(count), rng.randrange(count)
        x, y = rng.randrange(len(routes[a])), rng.randrange(len(routes[b]))
        routes[a][x], routes[b][y] = routes[b][y], routes[a][x]
    else:
        return _decode(context, candidate.groups, rng, noise=rng.uniform(0.1, 1.0))
    new_groups = tuple(tuple(sorted(group)) for group in groups)
    new_routes = tuple(tuple(route) for route in routes)
    # Coordinate workforce and schedule changes: a good new composition may
    # need different assignments, even when keeping the old queues is infeasible.
    if new_groups != candidate.groups and rng.random() < 0.3:
        return _decode(context, new_groups, rng, noise=rng.uniform(0, 0.5))
    result = context.evaluate(new_groups, new_routes)
    return Candidate(new_groups, new_routes, result) if result is not None else None


def _neighborhood(context: _Context, candidate: Candidate, *, wide: bool = False):
    """All single-worker moves/swaps and single-event insertions/swaps.

    This is a complete local neighborhood, not a claim of global optimality.
    Queues may intentionally wait; the evaluator rejects only infeasibility.
    """
    groups, routes = candidate.groups, candidate.routes
    count = len(groups)
    for a, b in combinations(range(count), 2):
        for x in range(len(groups[a])):
            for y in range(len(groups[b])):
                changed = [list(group) for group in groups]
                changed[a][x], changed[b][y] = changed[b][y], changed[a][x]
                yield tuple(tuple(sorted(group)) for group in changed), routes
    for a in range(count):
        if len(groups[a]) <= 2:
            continue
        for b in range(count):
            if a == b or len(groups[b]) >= 5:
                continue
            for x in range(len(groups[a])):
                changed = [list(group) for group in groups]
                changed[b].append(changed[a].pop(x))
                yield tuple(tuple(sorted(group)) for group in changed), routes
    # Late events first, but earlier predecessors are also fully enumerated.
    events = sorted(range(context.m), key=lambda e: (
        candidate.evaluation.starts[e] + candidate.evaluation.durations[e]), reverse=True)
    for event in events:
        a = candidate.evaluation.owners[event]
        x = routes[a].index(event)
        for b in range(count):
            if a != b and len(routes[a]) == 1:
                continue
            if not math.isfinite(context.metrics(groups[b])[0][event]):
                continue
            remaining = [list(route) for route in routes]
            remaining[a].pop(x)
            for y in range(len(remaining[b]) + 1):
                if a == b and x == y:
                    continue
                changed = [list(route) for route in remaining]
                changed[b].insert(y, event)
                yield groups, tuple(tuple(route) for route in changed)
    for event, other in combinations(events, 2):
        a, b = candidate.evaluation.owners[event], candidate.evaluation.owners[other]
        if (not math.isfinite(context.metrics(groups[a])[0][other]) or
                not math.isfinite(context.metrics(groups[b])[0][event])):
            continue
        changed = [list(route) for route in routes]
        x, y = routes[a].index(event), routes[b].index(other)
        changed[a][x], changed[b][y] = other, event
        yield groups, tuple(tuple(route) for route in changed)
    if not wide:
        return
    # Exact re-partition of every pair of brigades (at most ten workers). Unlike
    # single swaps this crosses barriers that require moving several workers at
    # once. Queues stay fixed, so brigade labels are NOT interchangeable here.
    for a, b in combinations(range(count), 2):
        workers = tuple(sorted(groups[a] + groups[b]))
        for size in range(max(2, len(workers) - 5), min(5, len(workers) - 2) + 1):
            for first in combinations(workers, size):
                second = tuple(w for w in workers if w not in first)
                if first == groups[a]:
                    continue
                # Each brigade's serial load is a necessary lower bound for
                # this fixed assignment, independent of dependency waiting.
                if any(sum(context.metrics(group)[0][e] for e in routes[index]) > candidate.evaluation.makespan_seconds
                       for group, index in ((first, a), (second, b))):
                    continue
                changed = list(groups)
                changed[a], changed[b] = first, second
                yield tuple(changed), routes
    # Move consecutive blocks together; a useful chain often cannot be moved
    # one event at a time without a cycle or a temporary Cmax increase.
    for a, route in enumerate(routes):
        for length in (2, 3):
            if len(route) <= length:
                continue
            for x in range(len(route) - length + 1):
                block = route[x:x + length]
                for b in range(count):
                    if a == b or any(not math.isfinite(context.metrics(groups[b])[0][e]) for e in block):
                        continue
                    for y in range(len(routes[b]) + 1):
                        changed = list(routes)
                        changed[a] = route[:x] + route[x + length:]
                        changed[b] = routes[b][:y] + block + routes[b][y:]
                        yield groups, tuple(changed)


def optimize(problem: Problem, conflicts: ConflictMatrix | None = None, *,
             initial_solution: Solution | None = None, seed: int = 0,
             iterations: int | None = None, time_limit_seconds: float = DEFAULT_TIME_LIMIT_SECONDS) -> OptimizationResult:
    """Return the best feasible incumbent within a shared time/iteration budget.

    No iteration cap is imposed by default. Small instances are enumerated with
    branch-and-bound; otherwise annealing alternates with exhaustive local
    neighborhoods. Fixed seed + iterations are reproducible unless time expires.
    A supplied baseline is never lost. Optimality is reported only after complete
    enumeration or attaining a valid lower bound (floating tolerance 1e-12).
    """
    if iterations is not None and (type(iterations) is not int or iterations < 0):
        raise ValueError("iterations must be a non-negative integer or None")
    if type(seed) is not int:
        raise ValueError("seed must be an integer")
    number(time_limit_seconds, "time_limit_seconds", 0.001, 170)
    started = time.monotonic()
    deadline = started + time_limit_seconds
    context, rng = _Context(problem, conflicts), random.Random(seed)
    minimum_count = (context.n + 4) // 5
    options = [[e for e, r in enumerate(context.resource_indices) if skills[r]] for skills in context.skills]
    maximum_count = min(context.n // 2, context.m, len(_matching(options)))
    if minimum_count > maximum_count:
        raise ValueError("No feasible formation: too few incidents or qualified workers to use all employees in groups of 2..5")
    lower_bound = context.lower_bound()
    current: dict[int, Candidate] = {}
    elite: dict[int, Candidate] = {}
    pools: dict[int, dict[Groups, Candidate]] = {}
    improvements: list[tuple[int, float]] = []
    best: Candidate | None = None

    def remember(candidate: Candidate) -> None:
        nonlocal best
        count = len(candidate.groups)
        if count not in elite or candidate.evaluation.score < elite[count].evaluation.score:
            elite[count] = candidate
        pool = pools.setdefault(count, {})
        signature = tuple(sorted(candidate.groups))
        if signature not in pool or candidate.evaluation.score < pool[signature].evaluation.score:
            pool[signature] = candidate
            if len(pool) > 8:
                del pool[max(pool, key=lambda key: pool[key].evaluation.score)]
        if best is None or candidate.evaluation.score < best.evaluation.score:
            if best is None or candidate.evaluation.makespan_seconds < best.evaluation.makespan_seconds:
                improvements.append((context.evaluations, candidate.evaluation.makespan_seconds))
            best = candidate

    if initial_solution is not None:
        groups, routes = context.from_solution(initial_solution)
        result = context.evaluate(groups, routes)
        if result is None:
            raise ValueError("Initial solution has a precedence cycle or missing qualification")
        initial = Candidate(groups, routes, result)
        current[len(groups)] = initial
        remember(initial)
    for count in range(minimum_count, maximum_count + 1):
        if best is not None and time.monotonic() >= deadline:
            break
        candidate = _decode(context, _partition(context, count, rng, count), rng)
        if candidate is None:
            raise ValueError("Cannot construct a feasible initial schedule")
        remember(candidate)
        current[count] = elite[count]
    assert best is not None
    counts = sorted(current)
    visits = dict.fromkeys(counts, 0)
    completed_iterations, exact_nodes = 0, 0
    # A feasible upper bound attaining a valid lower bound proves optimality,
    # but a finite iteration cap keeps the historic stop-reason contract.
    proven = iterations is None and (maximum_count == 1 or
                                     math.isclose(best.evaluation.makespan_seconds, lower_bound, rel_tol=1e-12))
    reason = "lower_bound" if proven else "iteration_limit"
    if maximum_count == 1 and iterations is None:
        # Only one partition and one serial processor: all topological queues
        # have the same total processing time, including nonzero conflicts.
        reason = "exact_optimum"
    if not proven and iterations is None and context.n <= 10 and context.m <= 10:
        from .exact import search
        proven, exact_nodes = search(context, best, deadline,
                                     min(iterations, 200_000) if iterations is not None else 1_000_000_000,
                                     remember)
        completed_iterations += exact_nodes
        if proven:
            reason = "exact_optimum"

    # Complete local sweeps run through the SAME budget checks as random moves.
    # A sweep snapshots a candidate; the next one starts from the improved best.
    neighborhood = None
    neighborhood_best = None
    sweep_count = 0
    next_sweep = completed_iterations + 5000
    while not proven and (iterations is None or completed_iterations < iterations):
        if time.monotonic() >= deadline:
            reason = "time_limit"
            break
        completed_iterations += 1
        if neighborhood is None and completed_iterations >= next_sweep:
            neighborhood_best = best
            sweep_count += 1
            neighborhood = iter(_neighborhood(context, best, wide=sweep_count % 3 == 0))
        if neighborhood is not None:
            move = next(neighborhood, None)
            if move is None:
                # Consecutive descent sweeps while improving, then diversify.
                next_sweep = completed_iterations + (1 if best.evaluation.score < neighborhood_best.evaluation.score else 5000)
                neighborhood = None
                continue
            groups, routes = move
            result = context.evaluate(groups, routes)
            if result is not None:
                remember(Candidate(groups, routes, result))
            continue
        # Every fifth random step explores all counts in turn. The other steps
        # prefer counts with good incumbents, without hardcoding a fixture count.
        if completed_iterations % 5 == 0:
            count = counts[(completed_iterations // 5) % len(counts)]
        else:
            scale = max(best.evaluation.makespan_seconds * 0.04, 1e-12)
            weights = [math.exp(-min(50, (elite[c].evaluation.makespan_seconds - best.evaluation.makespan_seconds) / scale))
                       for c in counts]
            count = rng.choices(counts, weights)[0]
        visits[count] += 1
        if visits[count] % 2000 == 0:
            candidate = _decode(context, _partition(context, count, rng, visits[count] // 2000), rng, noise=0.5)
        else:
            if visits[count] % 700 == 0:
                current[count] = rng.choice(list(pools[count].values()))
            parent = rng.choice(list(pools[count].values())) if rng.random() < 0.25 else current[count]
            candidate = _mutate(context, parent, rng)
        if candidate is None:
            continue
        remember(candidate)
        previous = current[count].evaluation
        delta = candidate.evaluation.makespan_seconds - previous.makespan_seconds
        if delta == 0:
            delta = (candidate.evaluation.score[1] - previous.score[1]) / context.m * 0.01
        temperature = max(elite[count].evaluation.makespan_seconds * 0.04
                          * 0.002 ** ((visits[count] % 700) / 700), 1e-12)
        if delta <= 0 or rng.random() < math.exp(-delta / temperature):
            current[count] = candidate
        if iterations is None and math.isclose(best.evaluation.makespan_seconds, lower_bound, rel_tol=1e-12):
            proven, reason = True, "lower_bound"
    if proven:
        lower_bound = best.evaluation.makespan_seconds
    solution = context.to_solution(best)
    final_evaluation = evaluate(problem, solution, context.conflicts)
    return OptimizationResult(solution, final_evaluation, lower_bound, context.evaluations,
                              completed_iterations, time.monotonic() - started, seed, reason,
                              tuple(improvements), proven, exact_nodes)


def evaluation_report(problem: Problem, solution: Solution, evaluation: Evaluation,
                      conflicts: ConflictMatrix | None = None) -> dict:
    context = _Context(problem, conflicts)
    groups, _ = context.from_solution(solution)
    return {
        "makespan_seconds": evaluation.makespan_seconds,
        "brigade_count": len(solution.brigades), "employee_count": len(problem.employees),
        "incident_count": len(problem.incidents),
        "schedule": [{
            "event_id": incident.event_id, "object_id": incident.object_id, "resource": incident.resource,
            "occurred_at": incident.occurred_at, "brigade_id": solution.brigades[evaluation.owners[i]].brigade_id,
            "sequence": solution.brigades[evaluation.owners[i]].event_order.index(incident.event_id) + 1,
            "base_duration_seconds": incident.base_duration_seconds,
            "start_seconds": evaluation.starts[i], "finish_seconds": evaluation.starts[i] + evaluation.durations[i],
            "duration_seconds": evaluation.durations[i],
            "kmax": context.metrics(groups[evaluation.owners[i]])[1],
        } for i, incident in enumerate(problem.incidents)],
    }
