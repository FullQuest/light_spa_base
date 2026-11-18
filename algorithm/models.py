"""Input/output contracts. Time is measured in seconds from the planning start."""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Mapping


def identifier(value: object, label: str) -> int:
    if type(value) is not int or value <= 0:
        raise ValueError(f"{label} must be a positive integer")
    return value


def number(value: object, label: str, minimum: float, maximum: float = math.inf) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValueError(f"{label} must be a number")
    result = float(value)
    if not math.isfinite(result) or not minimum <= result <= maximum:
        raise ValueError(f"{label} must be finite and in [{minimum}, {maximum}]")
    return result


@dataclass(frozen=True)
class Employee:
    tabel: int
    qualifications: Mapping[str, float]


@dataclass(frozen=True)
class Incident:
    event_id: int
    resource: str
    base_duration_seconds: float
    object_id: int | None = None
    occurred_at: str | None = None


@dataclass(frozen=True)
class Problem:
    employees: tuple[Employee, ...]
    incidents: tuple[Incident, ...]
    # Edges refer to active event IDs, source -> dependent, including transit paths.
    precedences: tuple[tuple[int, int], ...] = ()

    def __post_init__(self) -> None:
        employee_ids = [identifier(e.tabel, "tabel") for e in self.employees]
        event_ids = [identifier(e.event_id, "event_id") for e in self.incidents]
        if len(set(employee_ids)) != len(employee_ids) or len(set(event_ids)) != len(event_ids):
            raise ValueError("Employee and event IDs must be unique")
        if len(employee_ids) < 2 or not event_ids:
            raise ValueError("At least two employees and one active incident are required")
        for employee in self.employees:
            for resource, level in employee.qualifications.items():
                if not isinstance(resource, str) or not resource.strip():
                    raise ValueError("Qualification resource must be a non-empty string")
                number(level, "qualification", 0.1, 10.0)
        for incident in self.incidents:
            if not isinstance(incident.resource, str) or not incident.resource.strip():
                raise ValueError("Incident resource must be a non-empty string")
            if number(incident.base_duration_seconds, "base_duration_seconds", 0) == 0:
                raise ValueError("base_duration_seconds must be positive")
            if incident.object_id is not None:
                identifier(incident.object_id, "object_id")
        for source, target in self.precedences:
            identifier(source, "precedence source")
            identifier(target, "precedence target")
            if source not in event_ids or target not in event_ids or source == target:
                raise ValueError(f"Invalid event precedence: {source} -> {target}")
        resources = {r for e in self.employees for r in e.qualifications}
        missing = {e.resource for e in self.incidents} - resources
        if missing:
            raise ValueError(f"No employee qualified for resources: {sorted(missing)}")


@dataclass(frozen=True)
class ConflictMatrix:
    employee_ids: tuple[int, ...]
    values: tuple[tuple[float, ...], ...]

    @classmethod
    def zeros(cls, employees: tuple[Employee, ...]) -> ConflictMatrix:
        """Hardcoded temporary model: every pair has K=0, regardless of skills."""
        ids = tuple(e.tabel for e in employees)
        return cls(ids, tuple(tuple(0.0 for _ in ids) for _ in ids))

    def __post_init__(self) -> None:
        size = len(self.employee_ids)
        for employee_id in self.employee_ids:
            identifier(employee_id, "conflict matrix employee_id")
        if len(set(self.employee_ids)) != size:
            raise ValueError("Conflict matrix employee IDs must be unique")
        if len(self.values) != size or any(len(row) != size for row in self.values):
            raise ValueError("Conflict matrix must be square")
        for i, row in enumerate(self.values):
            for j, value in enumerate(row):
                number(value, "conflict", 0, 0.9)
                if i == j and value != 0:
                    raise ValueError("Conflict matrix diagonal must be zero")
                if not math.isclose(value, self.values[j][i], abs_tol=1e-12):
                    raise ValueError("Conflict matrix must be symmetric")


@dataclass(frozen=True)
class Brigade:
    brigade_id: int
    employees: tuple[int, ...]
    event_order: tuple[int, ...]


@dataclass(frozen=True)
class Solution:
    brigades: tuple[Brigade, ...]

    def to_dict(self) -> dict:
        """Strict M2 output: diagnostics must never leak into this document."""
        return {"brigades": [
            {"brigade_id": b.brigade_id, "employees": list(b.employees),
             "event_order": list(b.event_order)}
            for b in self.brigades
        ]}

    @classmethod
    def from_dict(cls, data: dict) -> Solution:
        if set(data) != {"brigades"} or not isinstance(data["brigades"], list):
            raise ValueError("M2 document must contain only the brigades array")
        brigades = []
        for row in data["brigades"]:
            if not isinstance(row, dict) or set(row) != {"brigade_id", "employees", "event_order"}:
                raise ValueError("Invalid M2 brigade fields")
            if not isinstance(row["employees"], list) or not isinstance(row["event_order"], list):
                raise ValueError("employees and event_order must be arrays")
            brigades.append(Brigade(identifier(row["brigade_id"], "brigade_id"),
                                    tuple(identifier(x, "employee") for x in row["employees"]),
                                    tuple(identifier(x, "event") for x in row["event_order"])))
        return cls(tuple(brigades))
