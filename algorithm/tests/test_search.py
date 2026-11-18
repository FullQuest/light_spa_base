"""Independent oracle checks for exact and heuristic search modes."""

import heapq
import itertools
import random
import unittest
from fractions import Fraction

from algorithm import Brigade, ConflictMatrix, Employee, Incident, Problem, Solution, evaluate, optimize
from algorithm.models import EMBEDDED_EMPLOYEE_IDS


def simulate(problem, solution, conflicts=None):
    skills = {employee.tabel: employee.qualifications for employee in problem.employees}
    events = {event.event_id: event for event in problem.incidents}
    predecessors = {event_id: set() for event_id in events}
    for source, target in problem.precedences:
        predecessors[target].add(source)
    matrix = ({employee_id: index for index, employee_id in enumerate(conflicts.employee_ids)}
              if conflicts else {})
    durations = {}
    for brigade in solution.brigades:
        kmax = max((Fraction(str(conflicts.values[matrix[a]][matrix[b]]))
                    for a, b in itertools.combinations(brigade.employees, 2)), default=Fraction(0)) if conflicts else 0
        for event_id in brigade.event_order:
            event = events[event_id]
            speed = sum(Fraction(str(skills[worker].get(event.resource, 0))) / 5
                        for worker in brigade.employees)
            if not speed:
                return None
            durations[event_id] = (1 + kmax) * Fraction(str(event.base_duration_seconds)) / speed

    done, busy, running = set(), set(), []
    positions, starts = [0] * len(solution.brigades), {}
    now = Fraction(0)
    while len(done) < len(events):
        for index, brigade in enumerate(solution.brigades):
            if index in busy or positions[index] == len(brigade.event_order):
                continue
            event_id = brigade.event_order[positions[index]]
            if predecessors[event_id] <= done:
                starts[event_id] = now
                heapq.heappush(running, (now + durations[event_id], index, event_id))
                busy.add(index)
        if not running:
            return None
        now = running[0][0]
        while running and running[0][0] == now:
            _, index, event_id = heapq.heappop(running)
            positions[index] += 1
            busy.remove(index)
            done.add(event_id)
    return now, starts, durations


def generated(seed, employee_count, incident_count):
    rng = random.Random(seed)
    resources = ("water", "energy", "gas")
    employee_ids = rng.sample(range(100, 5000), employee_count)
    employees = tuple(Employee(employee_id, {
        resource: rng.randint(1, 100) / 10 for resource in resources
        if index < 2 or rng.random() < 0.65
    }) for index, employee_id in enumerate(employee_ids))
    event_ids = rng.sample(range(10000, 50000), incident_count)
    incidents = tuple(Incident(event_id, resources[index % 3], rng.randint(1, 100) / 2)
                      for index, event_id in enumerate(event_ids))
    edges = tuple((event_ids[a], event_ids[b]) for a in range(incident_count)
                  for b in range(a + 1, incident_count) if rng.random() < 0.22)
    values = [[0.0] * employee_count for _ in range(employee_count)]
    for a, b in itertools.combinations(range(employee_count), 2):
        values[a][b] = values[b][a] = rng.choice((0, 0.1, 0.5, 0.9))
    return Problem(employees, incidents, edges), ConflictMatrix(tuple(employee_ids), tuple(map(tuple, values)))


def exhaustive(problem, conflicts):
    """Enumerate small partitions, event assignments, and every queue order."""
    workers = [employee.tabel for employee in problem.employees]
    events = [event.event_id for event in problem.incidents]
    best = None
    for count in range((len(workers) + 4) // 5, min(len(workers) // 2, len(events)) + 1):
        for labels in itertools.product(range(count), repeat=len(workers)):
            if tuple(dict.fromkeys(labels)) != tuple(range(count)):
                continue
            groups = [tuple(worker for worker, label in zip(workers, labels) if label == brigade)
                      for brigade in range(count)]
            if any(not 2 <= len(group) <= 5 for group in groups):
                continue
            for owners in itertools.product(range(count), repeat=len(events)):
                if len(set(owners)) != count:
                    continue
                queues = [[event for event, owner in zip(events, owners) if owner == brigade]
                          for brigade in range(count)]
                for routes in itertools.product(*(itertools.permutations(queue) for queue in queues)):
                    solution = Solution(tuple(Brigade(brigade + 1, groups[brigade], routes[brigade])
                                              for brigade in range(count)))
                    result = simulate(problem, solution, conflicts)
                    if result is not None and (best is None or result[0] < best):
                        best = result[0]
    return best


class SearchOracleTests(unittest.TestCase):
    def test_embedded_matrix_is_used_and_reordered_by_employee_id(self):
        employees = tuple(Employee(employee_id, {"water": 5})
                          for employee_id in reversed(EMBEDDED_EMPLOYEE_IDS))
        matrix = ConflictMatrix.zeros(employees)
        canonical = ConflictMatrix.zeros(tuple(reversed(employees)))
        self.assertEqual(matrix.employee_ids, tuple(reversed(EMBEDDED_EMPLOYEE_IDS)))
        self.assertGreater(max(max(row) for row in matrix.values), 0)
        self.assertEqual(matrix.values[0][1], canonical.values[-1][-2])
        self.assertTrue(all(matrix.values[i][i] == 0 for i in range(len(employees))))

    def test_exact_search_matches_independent_enumeration(self):
        for seed in range(6):
            problem, conflicts = generated(seed, 4 + seed % 3, 4)
            with self.subTest(seed=seed):
                expected = exhaustive(problem, conflicts)
                result = optimize(problem, conflicts, seed=seed, time_limit_seconds=5)
                self.assertIsNotNone(expected)
                self.assertTrue(result.optimality_proven)
                self.assertAlmostEqual(result.evaluation.makespan_seconds, float(expected), places=8)
                self.assertAlmostEqual(result.lower_bound_seconds, float(expected), places=8)
                self.assertGreater(result.exact_nodes, 0)

    def test_exact_budget_limit_keeps_valid_incumbent_without_claiming_proof(self):
        problem, conflicts = generated(2, 6, 4)
        result = optimize(problem, conflicts, iterations=1, time_limit_seconds=5)
        self.assertFalse(result.optimality_proven)
        self.assertEqual(result.stop_reason, "iteration_limit")
        self.assertEqual(result.exact_nodes, 0)
        self.assertIsNotNone(simulate(problem, result.solution, conflicts))

    def test_solver_schedule_matches_independent_discrete_simulation(self):
        for seed in range(4):
            problem, conflicts = generated(seed, 12 + seed * 2, 15 + seed)
            with self.subTest(seed=seed):
                result = optimize(problem, conflicts, seed=seed, iterations=6000, time_limit_seconds=10)
                expected = simulate(problem, result.solution, conflicts)
                self.assertIsNotNone(expected)
                makespan, starts, durations = expected
                self.assertAlmostEqual(result.evaluation.makespan_seconds, float(makespan), places=8)
                for index, event in enumerate(problem.incidents):
                    self.assertAlmostEqual(result.evaluation.starts[index], float(starts[event.event_id]), places=8)
                    self.assertAlmostEqual(result.evaluation.durations[index], float(durations[event.event_id]), places=8)
                self.assertLessEqual(result.lower_bound_seconds, float(makespan) + 1e-8)
                self.assertEqual(result.evaluation, evaluate(problem, result.solution, conflicts))

    def test_shared_multiresource_capacity_strengthens_lower_bound(self):
        problem = Problem(tuple(Employee(worker, {"water": 5, "energy": 5}) for worker in range(1, 5)),
                          (Incident(10, "water", 100), Incident(11, "energy", 100)))
        result = optimize(problem, time_limit_seconds=5)
        self.assertEqual(result.lower_bound_seconds, 50)
        self.assertTrue(result.optimality_proven)


if __name__ == "__main__":
    unittest.main()
