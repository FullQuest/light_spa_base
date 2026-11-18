"""Exhaustive branch-and-bound for small workforce/scheduling instances.

The partition enumeration fixes the smallest remaining worker in the next
brigade, removing brigade-label symmetry. For each partition, every precedence-
ready event and compatible brigade is considered, appending to that brigade's
queue. Any feasible set of queues has a topological ordering of its combined
graph, so this includes waiting schedules as well as non-delay schedules.
"""

from __future__ import annotations

import math
import time
from itertools import combinations
from typing import TYPE_CHECKING, Callable

if TYPE_CHECKING:
    from .solver import Candidate, Groups, _Context


def search(context: _Context, incumbent: Candidate, deadline: float, node_limit: int,
           remember: Callable[[Candidate], None]) -> tuple[bool, int]:
    from .solver import Candidate

    best = incumbent
    nodes = 0
    predecessors = [sum(1 << p for p in row) for row in context.predecessors]
    full = (1 << context.m) - 1

    class BudgetExceeded(Exception):
        pass

    def tick() -> None:
        nonlocal nodes
        if nodes >= node_limit or time.monotonic() >= deadline:
            raise BudgetExceeded
        nodes += 1

    def partitions(remaining: tuple[int, ...], groups: Groups):
        tick()
        if not remaining:
            yield groups
            return
        if len(groups) + (len(remaining) + 4) // 5 > context.m:
            return
        for size in range(2, min(5, len(remaining)) + 1):
            if len(remaining) - size == 1:
                continue
            for rest in combinations(remaining[1:], size - 1):
                group = (remaining[0],) + rest
                if all(not math.isfinite(value) for value in context.metrics(group)[0]):
                    continue
                selected = set(group)
                yield from partitions(tuple(w for w in remaining if w not in selected), groups + (group,))

    def schedules(groups: Groups) -> None:
        times = [context.metrics(group)[0] for group in groups]
        fastest = [min(row[event] for row in times) for event in range(context.m)]
        if any(not math.isfinite(value) for value in fastest):
            return
        routes: list[list[int]] = [[] for _ in groups]
        available = [0.0] * len(groups)
        finish = [0.0] * context.m
        # Different linearizations can lead to identical partial queues. Their
        # earliest completion times are identical; visit that state just once.
        seen: set[tuple[tuple[int, ...], ...]] = set()

        def visit(done: int) -> None:
            nonlocal best
            tick()
            key = tuple(tuple(route) for route in routes)
            if key in seen:
                return
            seen.add(key)
            if done == full:
                result = context.evaluate(groups, key)
                if result is not None:
                    candidate = Candidate(groups, key, result)
                    if result.score < best.evaluation.score:
                        best = candidate
                        remember(candidate)
                return
            if sum(not route for route in routes) > context.m - done.bit_count():
                return
            # Precedence-only earliest finishes with the fastest brigade for
            # every remaining event. Resource contention is relaxed, never
            # overstated. Use a conservative tolerance for floating arithmetic.
            optimistic = list(finish)
            for event in context.topological:
                if not done & (1 << event):
                    optimistic[event] = fastest[event] + max(
                        (optimistic[p] for p in context.predecessors[event]), default=0)
            bound = max(max(optimistic), max(available))
            if bound > best.evaluation.makespan_seconds * (1 + 1e-12):
                return
            choices = []
            for event in range(context.m):
                if done & (1 << event) or predecessors[event] & done != predecessors[event]:
                    continue
                release = max((finish[p] for p in context.predecessors[event]), default=0)
                for brigade, row in enumerate(times):
                    end = max(release, available[brigade]) + row[event]
                    if end <= best.evaluation.makespan_seconds * (1 + 1e-12):
                        choices.append((end, event, brigade))
            for end, event, brigade in sorted(choices):
                previous = available[brigade]
                routes[brigade].append(event)
                available[brigade], finish[event] = end, end
                visit(done | (1 << event))
                available[brigade], finish[event] = previous, 0.0
                routes[brigade].pop()

        visit(0)

    try:
        for groups in partitions(tuple(range(context.n)), ()):
            schedules(groups)
    except BudgetExceeded:
        return False, nodes
    return True, nodes
