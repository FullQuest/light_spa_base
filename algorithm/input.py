"""Read normalized JSON or PostgreSQL COPY/custom dump without changing any DB."""

from __future__ import annotations

import json
import re
import shutil
import subprocess
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

from .models import ConflictMatrix, Employee, Incident, Problem


ROOT = Path(__file__).resolve().parents[1]


def problem_from_dict(data: dict) -> Problem:
    return Problem(
        tuple(Employee(row["tabel"], dict(row["qualifications"])) for row in data["employees"]),
        tuple(Incident(row["event_id"], row["resource"], row["base_duration_seconds"],
                       row.get("object_id"), row.get("occurred_at")) for row in data["incidents"]),
        tuple(tuple(edge) for edge in data.get("precedences", [])),
    )


def load_problem(path: Path) -> Problem:
    return problem_from_dict(json.loads(path.read_text(encoding="utf-8")))


def load_conflicts(path: Path) -> ConflictMatrix:
    data = json.loads(path.read_text(encoding="utf-8"))
    return ConflictMatrix(tuple(data["employee_ids"]), tuple(tuple(row) for row in data["values"]))


def read_dump(path: Path) -> str:
    raw = path.read_bytes()
    if not raw.startswith(b"PGDMP"):
        return raw.decode("utf-8")
    # Decode the archive, never execute its SQL. Feed the current local file via stdin;
    # a running container's bind mount can still refer to an older replaced inode.
    if shutil.which("pg_restore"):
        command = ["pg_restore", "--data-only", "--file=-"]
    else:
        command = ["docker", "compose", "-f", "compose.yaml", "-f", "compose.override.yaml",
                   "-f", "compose.postgres-test.yaml", "exec", "-T", "postgres-fixture",
                   "pg_restore", "--data-only", "--file=-"]
    completed = subprocess.run(command, input=raw, capture_output=True, cwd=ROOT, timeout=30)
    if completed.returncode:
        raise ValueError("Cannot read dump. Install pg_restore or start postgres-fixture. "
                         + completed.stderr.decode("utf-8", errors="replace").strip())
    return completed.stdout.decode("utf-8")


def copy_tables(sql: str) -> dict[str, list[dict[str, str | None]]]:
    tables: dict[str, list[dict[str, str | None]]] = {}
    table = None
    columns: list[str] = []
    for line in sql.splitlines():
        match = re.fullmatch(r'COPY public\."?(\w+)"? \(([^)]+)\) FROM stdin;', line)
        if match:
            table = match[1]
            columns = [c.strip().strip('"') for c in match[2].split(",")]
            if table in tables:
                raise ValueError(f"Duplicate COPY table: {table}")
            tables[table] = []
        elif line == r"\.":
            table = None
        elif table is not None:
            fields = line.split("\t")
            if len(fields) != len(columns):
                raise ValueError(f"Invalid COPY row in {table}")
            tables[table].append(dict(zip(columns, [unescape_copy(v) for v in fields])))
    return tables


def unescape_copy(value: str) -> str | None:
    if value == r"\N":
        return None
    escapes = {"b": "\b", "f": "\f", "n": "\n", "r": "\r", "t": "\t", "v": "\v", "\\": "\\"}
    return re.sub(r"\\([0-7]{1,3}|x[0-9a-fA-F]{1,2}|.)",
                  lambda m: (chr(int(m[1], 16)) if m[1].startswith("x") else
                             chr(int(m[1], 8)) if m[1][0] in "01234567" else escapes.get(m[1], m[1])), value)


def duration_seconds(value: str) -> float:
    """PostgreSQL interval: [N days] HH:MM:SS[.ffffff], hours may exceed 23."""
    match = re.fullmatch(r"(?:(\d+) days? )?(\d+):([0-5]\d):([0-5]\d(?:\.\d+)?)", value.strip())
    if not match:
        raise ValueError(f"Unsupported avg_resolution_time interval: {value!r}")
    days, hours, minutes, seconds = match.groups()
    return int(days or 0) * 86400 + int(hours) * 3600 + int(minutes) * 60 + float(seconds)


def event_precedences(active: list[dict], dependencies: list[dict]) -> tuple[tuple[int, int], ...]:
    """Follow resource-specific dependencies even through objects without incidents."""
    reverse: dict[tuple[int, str], set[int]] = defaultdict(set)
    for row in dependencies:
        source, target = int(row["id_edifice_source"]), int(row["id_edifice_dependent"])
        if source == target:
            raise ValueError(f"Self dependency on object {source}")
        reverse[target, row["resource_type"]].add(source)
    by_key = {(int(row["id_edifice"]), row["resource_type"]): int(row["id_event"]) for row in active}
    result = set()
    for (target, resource), target_event in by_key.items():
        todo = list(reverse[target, resource])
        visited = set()
        while todo:
            source = todo.pop()
            if source == target:
                raise ValueError(f"Dependency cycle reaching active object {target} ({resource})")
            if source in visited:
                continue
            visited.add(source)
            source_event = by_key.get((source, resource))
            if source_event is not None:
                result.add((source_event, target_event))
            todo.extend(reverse[source, resource] - visited)
    return tuple(sorted(result))


def problem_from_tables(tables: dict, active_status_ids: set[int] | None = None) -> Problem:
    required = {"employee", "qualification", "events", "event_statuses", "time_resolve", "edifice_dependencies"}
    missing = required - tables.keys()
    if missing:
        raise ValueError(f"Missing required tables: {', '.join(sorted(missing))}")
    qualifications: dict[int, dict[str, float]] = defaultdict(dict)
    employee_ids = {int(row["tabel"]) for row in tables["employee"]}
    for row in tables["qualification"]:
        employee_id, resource = int(row["id_employee"]), row["resource_type"]
        if employee_id not in employee_ids or resource in qualifications[employee_id]:
            raise ValueError("Unknown employee or duplicate resource qualification")
        qualifications[employee_id][resource] = float(row["proff"])
    employees = tuple(Employee(int(row["tabel"]), qualifications[int(row["tabel"])])
                      for row in sorted(tables["employee"], key=lambda r: int(r["tabel"])))
    statuses = {int(row["id_status"]): row["name"].casefold().strip() for row in tables["event_statuses"]}
    if active_status_ids is None:
        names = {"активная авария", "авария", "active incident", "incident", "active accident", "accident"}
        active_status_ids = {key for key, name in statuses.items() if name in names}
        if not active_status_ids:
            raise ValueError("Cannot identify active status; pass --active-status-id explicitly")
    if not active_status_ids or not active_status_ids <= statuses.keys():
        raise ValueError("Unknown or empty active status IDs")
    latest: dict[tuple[int, str], tuple[datetime, int, dict]] = {}
    seen_ids = set()
    for row in tables["events"]:
        event_id, status = int(row["id_event"]), int(row["id_status"])
        if event_id in seen_ids or status not in statuses:
            raise ValueError("Duplicate event ID or unknown event status")
        seen_ids.add(event_id)
        occurred = datetime.fromisoformat(row["occurred_at"])
        # PostgreSQL source timestamps without offset are local Moscow timestamps.
        if occurred.tzinfo is None:
            from datetime import timedelta
            occurred = occurred.replace(tzinfo=timezone(timedelta(hours=3)))
        key = int(row["id_edifice"]), row["resource_type"]
        candidate = (occurred, event_id, row)
        if key not in latest or candidate[:2] > latest[key][:2]:
            latest[key] = candidate
    active = [entry[2] for entry in latest.values() if int(entry[2]["id_status"]) in active_status_ids]
    times = {}
    for row in tables["time_resolve"]:
        key = int(row["id_edifice"]), row["resource_type"]
        if key in times:
            raise ValueError(f"Duplicate base duration for {key}")
        times[key] = duration_seconds(row["avg_resolution_time"])
    incidents = []
    for row in sorted(active, key=lambda r: int(r["id_event"])):
        key = int(row["id_edifice"]), row["resource_type"]
        if key not in times:
            raise ValueError(f"Missing base duration for active event {row['id_event']}")
        incidents.append(Incident(int(row["id_event"]), row["resource_type"], times[key],
                                  int(row["id_edifice"]), row["occurred_at"]))
    return Problem(employees, tuple(incidents), event_precedences(active, tables["edifice_dependencies"]))


def load_backup(path: Path, active_status_ids: set[int] | None = None) -> Problem:
    return problem_from_tables(copy_tables(read_dump(path)), active_status_ids)
