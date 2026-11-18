import itertools
import math
import unittest
from dataclasses import replace

from algorithm import Brigade, ConflictMatrix, Employee, Incident, Problem, Solution, evaluate, optimize


def problem(levels=(5, 5, 5, 5), durations=(100, 100, 100), precedences=()):
    return Problem(tuple(Employee(i + 1, {"water": level}) for i, level in enumerate(levels)),
                   tuple(Incident(100 + i, "water", duration) for i, duration in enumerate(durations)),
                   tuple(precedences))


def solution(*rows):
    return Solution(tuple(Brigade(i + 1, tuple(workers), tuple(events)) for i, (workers, events) in enumerate(rows)))


class EvaluatorTests(unittest.TestCase):
    def test_parallel_work_and_precedence_waiting(self):
        data = problem(durations=(100, 80, 60), precedences=((100, 102),))
        plan = solution(([1, 2], [100]), ([3, 4], [101, 102]))
        result = evaluate(data, plan)
        self.assertEqual(result.durations, (50, 40, 30))
        self.assertEqual(result.starts, (0, 0, 50))
        self.assertEqual(result.makespan_seconds, 80)

    def test_explicit_queue_can_wait_instead_of_starting_an_available_job(self):
        data = problem(durations=(100, 100, 20, 20), precedences=((100, 101),))
        plan = solution(([1, 2], [101, 102]), ([3, 4], [100, 103]))
        self.assertEqual(evaluate(data, plan).starts, (0, 50, 100, 50))

    def test_conflict_max_includes_worker_without_matching_skill(self):
        data = Problem((Employee(1, {"water": 5}), Employee(2, {"water": 10}),
                        Employee(3, {"energy": 10})), (Incident(100, "water", 300),))
        plan = solution(([1, 2, 3], [100]))
        # Deliberately reorder IDs: no assumption of contiguous employee IDs.
        matrix = ConflictMatrix((3, 1, 2), ((0, 0.9, 0.2), (0.9, 0, 0.1), (0.2, 0.1, 0)))
        self.assertAlmostEqual(evaluate(data, plan, matrix).makespan_seconds, 190)
        self.assertEqual(evaluate(data, plan).makespan_seconds, 100)

    def test_catches_cycle_created_only_by_combined_brigade_orders(self):
        data = problem(durations=(10, 10, 10, 10), precedences=((100, 101), (102, 103)))
        plan = solution(([1, 2], [103, 100]), ([3, 4], [101, 102]))
        with self.assertRaisesRegex(ValueError, "cycle"):
            evaluate(data, plan)

    def test_invalid_membership_sizes_qualification_and_empty_brigade(self):
        data = problem()
        plans = [solution(([1, 2], [100]), ([2, 4], [101, 102])),
                 solution(([1, 2], [100]), ([3, 4], [100, 102])),
                 solution(([1], [100]), ([2, 3, 4], [101, 102])),
                 solution(([1, 2], []), ([3, 4], [100, 101, 102]))]
        for plan in plans:
            with self.subTest(plan=plan), self.assertRaises(ValueError):
                evaluate(data, plan)
        water_only = problem(durations=(100, 100))
        mixed = replace(water_only, employees=(Employee(1, {"energy": 5}), Employee(2, {"energy": 5}),
                                               Employee(3, {"water": 5}), Employee(4, {"water": 5})))
        with self.assertRaisesRegex(ValueError, "qualification"):
            evaluate(mixed, solution(([1, 2], [100]), ([3, 4], [101])))

    def test_invalid_graph_and_matrix_fail_explicitly(self):
        with self.assertRaisesRegex(ValueError, "cycle"):
            optimize(problem(precedences=((100, 101), (101, 100))), iterations=0)
        invalid = [((0, 0.1), (0.2, 0)), ((1, 0), (0, 0)), ((0, math.nan), (math.nan, 0))]
        for values in invalid:
            with self.subTest(values=values), self.assertRaises(ValueError):
                ConflictMatrix((1, 2), values)
        with self.assertRaisesRegex(ValueError, "match"):
            evaluate(problem(), solution(([1, 2, 3, 4], [100, 101, 102])), ConflictMatrix((1,), ((0,),)))


class OptimizerTests(unittest.TestCase):
    def test_matches_exhaustive_optimum_for_small_independent_problem(self):
        data = problem(levels=(2, 5, 8, 10), durations=(160, 80, 50))
        # Independent oracle: enumerate all legal partitions and all non-empty
        # event allocations, calculate loads directly, without the scheduler.
        levels = {e.tabel: e.qualifications["water"] / 5 for e in data.employees}
        times = {e.event_id: e.base_duration_seconds for e in data.incidents}
        workers, events = tuple(levels), tuple(times)
        optimum = sum(times.values()) / sum(levels.values())  # Single brigade of 4.
        for pair in itertools.combinations(workers[1:], 1):
            a = (workers[0],) + pair
            b = tuple(w for w in workers if w not in a)
            for mask in range(1, (1 << len(events)) - 1):
                load_a = sum(times[e] for i, e in enumerate(events) if mask & (1 << i)) / sum(levels[w] for w in a)
                load_b = sum(times[e] for i, e in enumerate(events) if not mask & (1 << i)) / sum(levels[w] for w in b)
                optimum = min(optimum, max(load_a, load_b))
        result = optimize(data, seed=13, iterations=3000, time_limit_seconds=10)
        self.assertAlmostEqual(result.evaluation.makespan_seconds, optimum)
        self.assertLessEqual(result.lower_bound_seconds, optimum + 1e-9)

    def test_seed_reproducible_and_baseline_never_lost(self):
        data = problem(levels=(2, 5, 8, 10), durations=(160, 80, 50))
        baseline = solution(([1, 2], [100, 101]), ([3, 4], [102]))
        runs = [optimize(data, seed=7, iterations=2000, time_limit_seconds=10,
                         initial_solution=baseline) for _ in range(2)]
        self.assertEqual(runs[0].solution, runs[1].solution)
        self.assertEqual(runs[0].improvements, runs[1].improvements)
        self.assertLessEqual(runs[0].evaluation.makespan_seconds, evaluate(data, baseline).makespan_seconds)
        self.assertEqual(runs[0].stop_reason, "iteration_limit")

    def test_search_avoids_a_known_conflicting_pair(self):
        data = problem(durations=(100, 100))
        matrix = ConflictMatrix((1, 2, 3, 4), ((0, 0.9, 0, 0), (0.9, 0, 0, 0),
                                              (0, 0, 0, 0), (0, 0, 0, 0)))
        result = optimize(data, matrix, seed=0, iterations=2000, time_limit_seconds=5)
        self.assertEqual(result.evaluation.makespan_seconds, 50)
        self.assertTrue(all(not {1, 2} <= set(b.employees) for b in result.solution.brigades))

    def test_supports_three_resources_unqualified_workers_and_one_incident(self):
        data = Problem(tuple(Employee(i, {"gas": 5} if i == 1 else {}) for i in range(1, 6)),
                       (Incident(12, "gas", 100),))
        result = optimize(data, iterations=100, time_limit_seconds=2)
        self.assertEqual(len(result.solution.brigades), 1)
        self.assertEqual(result.evaluation.makespan_seconds, 100)
        data = Problem(tuple(Employee(i, {"gas": 3, "water": 6, "energy": 9}) for i in range(1, 10)),
                       tuple(Incident(100 + i, r, 100) for i, r in enumerate(("gas", "water", "energy"))))
        result = optimize(data, iterations=200, time_limit_seconds=2)
        evaluate(data, result.solution)
        self.assertEqual(set(result.solution.to_dict()), {"brigades"})

    def test_infeasible_worker_and_incident_counts(self):
        for data in [problem(levels=(5,) * 6, durations=(100,)),
                     Problem(tuple(Employee(i, {"water": 5} if i == 1 else {}) for i in range(1, 7)),
                             (Incident(10, "water", 100), Incident(11, "water", 100)))]:
            with self.subTest(data=data), self.assertRaisesRegex(ValueError, "No feasible"):
                optimize(data, iterations=0)

    def test_very_short_budget_returns_valid_incumbent(self):
        result = optimize(problem(), iterations=1_000_000, time_limit_seconds=0.01)
        evaluate(problem(), result.solution)
        self.assertEqual(result.stop_reason, "time_limit")
        self.assertLess(result.elapsed_seconds, 1)


if __name__ == "__main__":
    unittest.main()
