#!/usr/bin/env python3
"""Generate a deterministic, valid M2 test solution from backup.sql.

The file intentionally does not optimize the schedule. It only proves that the
organizers' checker accepts the employee/event identifiers from the supplied
fixture and that every M2 constraint can be represented in one JSON document.
"""

from __future__ import annotations

import argparse
import csv
import io
import json
import shutil
import subprocess
from collections import defaultdict, deque
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_BACKUP = ROOT / "backup.sql"
DEFAULT_OUTPUT = ROOT / "test_brigades.json"
COMPOSE = [
    "docker", "compose", "-f", "compose.yaml", "-f", "compose.override.yaml",
    "-f", "compose.postgres-test.yaml", "exec", "-T", "postgres-fixture",
    "pg_restore", "--data-only", "--file=-",
]


def restore_dump(path: Path) -> str:
    """Turn the custom PostgreSQL archive into COPY text.

    Prefer a host pg_restore. The fallback uses the already running fixture
    container, so the script remains usable on the supplied Docker machine.
    """
    if shutil.which("pg_restore"):
        command = ["pg_restore", "--data-only", "--file=-", str(path)]
        completed = subprocess.run(command, check=True, capture_output=True)
    else:
        completed = subprocess.run(COMPOSE, input=path.read_bytes(), check=True, capture_output=True)
    return completed.stdout.decode("utf-8")


def copy_tables(sql: str) -> dict[str, list[list[str]]]:
    tables: dict[str, list[list[str]]] = {}
    table: str | None = None
    reader: csv.reader[str] | None = None
    for line in sql.splitlines():
        if line.startswith("COPY public."):
            table = line[len("COPY public."):].split(" ", 1)[0]
            tables[table] = []
            reader = csv.reader([line], delimiter="\t", escapechar="\\")
            continue
        if line == r"\.":
            table = None
            reader = None
            continue
        if table is not None and reader is not None and line:
            row = next(csv.reader([line], delimiter="\t", escapechar="\\"))
            tables[table].append(row)
    return tables


@dataclass(frozen=True)
class Employee:
    tabel: int
    skills: frozenset[str]


@dataclass(frozen=True)
class Event:
    event_id: int
    edifice_id: int
    resource: str
    occurred_at: datetime


def parse_data(tables: dict[str, list[list[str]]]) -> tuple[list[Employee], list[Event], list[tuple[str, str, str]]]:
    required = {"employee", "qualification", "event_statuses", "events", "edifice_dependencies"}
    missing = sorted(required - tables.keys())
    if missing:
        raise ValueError(f"backup.sql has no required table data: {', '.join(missing)}")

    employee_skills: dict[int, set[str]] = defaultdict(set)
    employee_ids = [int(row[0]) for row in tables["employee"]]
    for row in tables["qualification"]:
        employee_skills[int(row[1])].add(row[2])
    employees = [Employee(tabel, frozenset(employee_skills[tabel])) for tabel in sorted(employee_ids)]

    statuses = {int(row[0]): row[1].casefold() for row in tables["event_statuses"]}
    active_ids = {status_id for status_id, name in statuses.items() if "авар" in name or "incident" in name}
    if not active_ids:
        active_ids = {1}
    events = [
        Event(int(row[0]), int(row[1]), row[2], datetime.fromisoformat(row[3]))
        for row in tables["events"] if int(row[4]) in active_ids
    ]
    dependencies = [(row[1], row[2], row[3]) for row in tables["edifice_dependencies"]]
    return employees, sorted(events, key=lambda event: (event.occurred_at, event.event_id)), dependencies


def topological_events(events: list[Event], dependencies: list[tuple[str, str, str]]) -> list[Event]:
    """Order active events so source objects precede dependent objects."""
    by_object_resource = {(event.edifice_id, event.resource): event for event in events}
    outgoing: dict[int, set[int]] = defaultdict(set)
    indegree = {event.event_id: 0 for event in events}
    for resource, source, dependent in dependencies:
        source_event = by_object_resource.get((int(source), resource))
        dependent_event = by_object_resource.get((int(dependent), resource))
        if source_event is None or dependent_event is None or dependent_event.event_id in outgoing[source_event.event_id]:
            continue
        outgoing[source_event.event_id].add(dependent_event.event_id)
        indegree[dependent_event.event_id] += 1

    by_id = {event.event_id: event for event in events}
    ready = [event for event in events if indegree[event.event_id] == 0]
    ordered: list[Event] = []
    while ready:
        ready.sort(key=lambda event: (event.occurred_at, event.event_id))
        event = ready.pop(0)
        ordered.append(event)
        for dependent_id in sorted(outgoing[event.event_id]):
            indegree[dependent_id] -= 1
            if indegree[dependent_id] == 0:
                ready.append(by_id[dependent_id])
    if len(ordered) != len(events):
        cycle_ids = sorted(event_id for event_id, degree in indegree.items() if degree)
        raise ValueError(f"Active event dependency graph contains a cycle: {cycle_ids}")
    return ordered


def build_solution(employees: list[Employee], ordered_events: list[Event]) -> dict[str, list[dict[str, object]]]:
    if not employees:
        raise ValueError("No employees in backup.sql")
    if not ordered_events:
        raise ValueError("No active incidents in backup.sql")
    if len(employees) != 28:
        raise ValueError(f"Expected 28 fixture employees, found {len(employees)}")

    universal = [employee for employee in employees if {"water", "energy"} <= employee.skills]
    water_only = [employee for employee in employees if employee.skills == {"water"}]
    energy_only = [employee for employee in employees if employee.skills == {"energy"}]
    if not (len(universal), len(water_only), len(energy_only)) == (14, 7, 7):
        raise ValueError("The fixture must contain 14 universal, 7 water-only and 7 energy-only workers")

    # Two universal, one water-only and one energy-only worker per brigade.
    brigades: list[dict[str, object]] = []
    for index in range(7):
        group = universal[index * 2:index * 2 + 2] + [water_only[index], energy_only[index]]
        brigades.append({"brigade_id": index + 1, "employees": [employee.tabel for employee in group], "event_order": []})

    # Round-robin over the dependency-safe order; every brigade gets work and
    # every brigade supports both resource types.
    for index, event in enumerate(ordered_events):
        brigades[index % len(brigades)]["event_order"].append(event.event_id)  # type: ignore[union-attr]
    return {"brigades": brigades}


def validate(solution: dict[str, list[dict[str, object]]], employees: list[Employee], events: list[Event]) -> None:
    brigades = solution["brigades"]
    employee_ids = [employee.tabel for employee in employees]
    assigned_employees = [employee for brigade in brigades for employee in brigade["employees"]]  # type: ignore[index]
    assigned_events = [event for brigade in brigades for event in brigade["event_order"]]  # type: ignore[index]
    event_ids = [event.event_id for event in events]
    if len(brigades) != 7 or any(not 2 <= len(brigade["employees"]) <= 5 for brigade in brigades):  # type: ignore[arg-type]
        raise ValueError("Every test brigade must contain from 2 to 5 workers")
    if sorted(assigned_employees) != sorted(employee_ids) or len(set(assigned_employees)) != len(assigned_employees):
        raise ValueError("Workers must be used exactly once")
    if sorted(assigned_events) != sorted(event_ids) or len(set(assigned_events)) != len(assigned_events):
        raise ValueError("Every active event must be assigned exactly once")
    if any(not brigade["event_order"] for brigade in brigades):
        raise ValueError("Every brigade must receive at least one active event")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--backup", type=Path, default=DEFAULT_BACKUP)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    args = parser.parse_args()
    tables = copy_tables(restore_dump(args.backup))
    employees, events, dependencies = parse_data(tables)
    ordered_events = topological_events(events, dependencies)
    solution = build_solution(employees, ordered_events)
    validate(solution, employees, events)
    args.output.write_text(json.dumps(solution, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Generated {args.output}: {len(solution['brigades'])} brigades, {len(employees)} employees, {len(events)} active events")


if __name__ == "__main__":
    main()
