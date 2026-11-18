"""Multi-start search over worker partitions and feasible machine sequences.

The evaluator is exact for a fixed solution: it finds longest paths in the union
of incident precedences and brigade queue edges. The optimizer is a heuristic;
its incumbent is always feasible, but it does not certify global optimality.
"""

from __future__ import annotations

import math
import random
import time
from dataclasses import dataclass
from functools import lru_cache

from .models import Brigade, ConflictMatrix, Problem, Solution, identifier, number


Groups = tuple[tuple[int, ...], ...]
Routes = tuple[tuple[int, ...], ...]


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
        self.metrics = lru_cache(maxsize=8192)(self._metrics)

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
        work_bounds = [sum(base for base, r in zip(self.bases, self.resource_indices) if r == resource)
                       / sum(worker[resource] for worker in self.skills)
                       for resource in range(len(self.resources))]
        return max(max(finish), max(work_bounds))


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
    result = context.evaluate(new_groups, new_routes)
    return Candidate(new_groups, new_routes, result) if result is not None else None


def optimize(problem: Problem, conflicts: ConflictMatrix | None = None, *,
             initial_solution: Solution | None = None, seed: int = 0,
             iterations: int = 100_000, time_limit_seconds: float = 60) -> OptimizationResult:
    """Return the best feasible incumbent within an iteration/time budget.

    A supplied baseline participates in the search and can never be lost.
    Fixed seed + iteration budget are reproducible when the time limit is not hit.
    """
    if type(iterations) is not int or iterations < 0:
        raise ValueError("iterations must be a non-negative integer")
    number(time_limit_seconds, "time_limit_seconds", 0.001, 170)
    started = time.monotonic()
    deadline = started + time_limit_seconds
    context, rng = _Context(problem, conflicts), random.Random(seed)
    minimum_count = (context.n + 4) // 5
    # Each brigade requires a distinct employee/event pair with a matching skill.
    options = [[e for e, r in enumerate(context.resource_indices) if skills[r]] for skills in context.skills]
    maximum_count = min(context.n // 2, context.m, len(_matching(options)))
    if minimum_count > maximum_count:
        raise ValueError("No feasible formation: too few incidents or qualified workers to use all employees in groups of 2..5")
    current: dict[int, Candidate] = {}
    elite: dict[int, Candidate] = {}
    visits: dict[int, int] = {}
    improvements: list[tuple[int, float]] = []
    evaluated = 0
    best: Candidate | None = None

    def remember(candidate: Candidate) -> None:
        nonlocal best, evaluated
        evaluated += 1
        count = len(candidate.groups)
        if count not in elite or candidate.evaluation.score < elite[count].evaluation.score:
            elite[count] = candidate
        if best is None or candidate.evaluation.score < best.evaluation.score:
            if best is None or candidate.evaluation.makespan_seconds < best.evaluation.makespan_seconds:
                improvements.append((evaluated, candidate.evaluation.makespan_seconds))
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
    counts = sorted(current)
    visits = dict.fromkeys(counts, 0)
    completed_iterations = 0
    for step in range(iterations):
        if time.monotonic() >= deadline:
            break
        count = counts[step % len(counts)]
        visits[count] += 1
        # Independent annealing chains for different brigade counts; periodically
        # restart from new partitions to escape workforce/schedule local minima.
        if visits[count] % 700 == 0:
            if (visits[count] // 700) % 4:
                current[count] = elite[count]
                # Keep useful structures while exploring beyond the local optimum.
                for _ in range(3):
                    candidate = _mutate(context, current[count], rng)
                    evaluated += 1
                    if candidate is not None:
                        evaluated -= 1
                        remember(candidate)
                        current[count] = candidate
            else:
                candidate = _decode(context, _partition(context, count, rng, visits[count] // 700), rng, noise=0.5)
                if candidate is not None:
                    remember(candidate)
                    current[count] = candidate
        candidate = _mutate(context, current[count], rng)
        evaluated += 1
        completed_iterations = step + 1
        if candidate is None:
            continue
        evaluated -= 1  # remember accounts for this valid evaluation.
        remember(candidate)
        previous = current[count].evaluation
        delta = candidate.evaluation.makespan_seconds - previous.makespan_seconds
        # Allow moves on a Cmax plateau. The best incumbent still uses exact Cmax.
        if delta == 0:
            delta = (candidate.evaluation.score[1] - previous.score[1]) / context.m * 0.01
        temperature = max(elite[count].evaluation.makespan_seconds * 0.04
                          * 0.002 ** ((visits[count] % 700) / 700), 1e-12)
        if delta <= 0 or rng.random() < math.exp(-delta / temperature):
            current[count] = candidate
    assert best is not None
    solution = context.to_solution(best)
    # Validate the exported M2 document with the same public path as external input.
    final_evaluation = evaluate(problem, solution, context.conflicts)
    return OptimizationResult(solution, final_evaluation, context.lower_bound(), evaluated,
                              completed_iterations, time.monotonic() - started, seed,
                              "iteration_limit" if completed_iterations == iterations else "time_limit",
                              tuple(improvements))


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
