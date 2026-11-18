"""Run with python3 -m algorithm; no app/database integration is required."""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path

from .input import ROOT, load_backup, load_conflicts, load_problem
from .models import ConflictMatrix, Solution
from .solver import evaluation_report, evaluate, optimize


def write_json(path: Path, data: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2, allow_nan=False) + "\n", encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser(description="Standalone M2 brigade/schedule optimizer (zero conflicts by default).")
    source = parser.add_mutually_exclusive_group()
    source.add_argument("--input", type=Path, help="Normalized problem JSON")
    source.add_argument("--backup", type=Path, help="PostgreSQL custom archive or plain COPY dump; default: backup.sql")
    parser.add_argument("--active-status-id", type=int, action="append", help="Active dump status ID; repeat for multiple IDs")
    parser.add_argument("--conflicts", type=Path, help="Optional employee_ids/values JSON; default is a hardcoded zero matrix")
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--baseline", type=Path, help="Valid M2 incumbent; search never returns a worse makespan")
    mode.add_argument("--evaluate", type=Path, help="Only validate/evaluate this M2 file, without optimization")
    parser.add_argument("--output", type=Path, default=ROOT / "algorithm/output/brigades.json")
    parser.add_argument("--report", type=Path, help="Write diagnostics/schedule separately from the strict M2 output")
    parser.add_argument("--seed", type=int, default=0)
    parser.add_argument("--iterations", type=int, default=100_000)
    parser.add_argument("--time-limit", type=float, default=60, help="Search budget in seconds, 0.001..170; default: 60")
    args = parser.parse_args()
    try:
        if args.input and args.active_status_id:
            raise ValueError("--active-status-id applies only to --backup")
        protected = [p.resolve() for p in [args.input, args.backup or ROOT / "backup.sql", args.conflicts,
                                         args.baseline, args.evaluate, ROOT / "test_brigades.json"] if p is not None]
        destinations = ([args.output] if not args.evaluate else []) + ([args.report] if args.report else [])
        if any(path.resolve() in protected for path in destinations):
            raise ValueError("Output/report must not overwrite input, baseline or test_brigades.json")
        if len({path.resolve() for path in destinations}) != len(destinations):
            raise ValueError("Output and report must be different files")
        problem = (load_problem(args.input) if args.input else
                   load_backup(args.backup or ROOT / "backup.sql", set(args.active_status_id) if args.active_status_id else None))
        conflicts = load_conflicts(args.conflicts) if args.conflicts else ConflictMatrix.zeros(problem.employees)
        path = args.evaluate or args.baseline
        initial = Solution.from_dict(json.loads(path.read_text(encoding="utf-8"))) if path else None
        if args.evaluate:
            evaluation = evaluate(problem, initial, conflicts)
            report = evaluation_report(problem, initial, evaluation, conflicts)
        else:
            result = optimize(problem, conflicts, initial_solution=initial, seed=args.seed,
                              iterations=args.iterations, time_limit_seconds=args.time_limit)
            report = evaluation_report(problem, result.solution, result.evaluation, conflicts)
            report.update({
                "algorithm": "multi_start_simulated_annealing", "optimality_proven": False,
                "conflict_model": "provided_matrix" if args.conflicts else "hardcoded_zero_matrix",
                "lower_bound_seconds": result.lower_bound_seconds,
                "gap_to_lower_bound_percent": max(0, (result.evaluation.makespan_seconds / result.lower_bound_seconds - 1) * 100),
                "evaluated_candidates": result.evaluated_candidates, "iterations": result.iterations,
                "elapsed_seconds": result.elapsed_seconds, "seed": result.seed, "stop_reason": result.stop_reason,
                "improvements": [{"evaluation": i, "makespan_seconds": value} for i, value in result.improvements],
            })
            if initial:
                baseline_time = evaluate(problem, initial, conflicts).makespan_seconds
                report.update({"baseline_makespan_seconds": baseline_time,
                               "improvement_percent": (1 - result.evaluation.makespan_seconds / baseline_time) * 100})
            write_json(args.output, result.solution.to_dict())
        if args.report:
            write_json(args.report, report)
        if args.evaluate and not args.report:
            print(json.dumps(report, ensure_ascii=False, indent=2, allow_nan=False))
        else:
            print(f"Valid: {report['brigade_count']} brigades, {report['employee_count']} employees, "
                  f"{report['incident_count']} incidents; Cmax={report['makespan_seconds']:.3f} s")
            if not args.evaluate:
                print(f"M2: {args.output.resolve()}")
            if args.report:
                print(f"Report: {args.report.resolve()}")
        return 0
    except (ValueError, KeyError, TypeError, OSError, subprocess.SubprocessError) as error:
        print(f"Error: {error}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
