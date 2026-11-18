"""Consistent database snapshot -> normalized algorithm input and UI metadata."""
from dataclasses import dataclass
from datetime import datetime, timezone

from sqlmodel import Session, select

from algorithm.input import event_precedences
from algorithm.models import Problem
from algorithm.input import problem_from_dict
from modules.infra_loader.loader import SOURCE_TIMEZONE, _consistent_cache, event_time, status_category
from modules.infra_loader.models import Edifice, EdificeDependency, Employee, Event, EventStatus, Qualification, TimeResolve
from .models import PlanningData


def employees(session: Session) -> list[dict]:
    qualifications: dict[int, list[dict]] = {}
    for row in session.exec(select(Qualification).order_by(Qualification.id_qualification)):
        qualifications.setdefault(row.id_employee, []).append(row.model_dump(mode="json"))
    return [{**row.model_dump(mode="json"),
             "qualifications": qualifications.get(row.tabel, [])}
            for row in session.exec(select(Employee).order_by(Employee.tabel))]


@dataclass(frozen=True)
class PlanningInput:
    revision: str
    origin: datetime
    employees: list[dict]
    objects: dict[int, str]
    problem: dict


@_consistent_cache
def prepare(session: Session) -> PlanningInput:
    state = session.get(PlanningData, 1)
    if state is None:
        raise ValueError("Сначала загрузите данные из внешней БД.")
    origin = datetime.now(timezone.utc)
    cutoff = origin.astimezone(SOURCE_TIMEZONE).replace(tzinfo=None)
    statuses = {row.id_status: row.name for row in session.exec(select(EventStatus))}
    latest = {}
    for row in session.exec(select(Event).where(Event.occurred_at <= cutoff)
                            .order_by(Event.occurred_at.desc(), Event.id_event.desc())):
        latest.setdefault((row.id_edifice, row.resource_type), row)
    active = sorted((row for row in latest.values() if status_category(statuses[row.id_status]) == "incident"),
                    key=lambda row: row.id_event)
    roster = employees(session)
    bases = {}
    for row in session.exec(select(TimeResolve)):
        key = row.id_edifice, row.resource_type
        if key in bases:
            raise ValueError(f"Повторяется базовое время объекта №{row.id_edifice} ({row.resource_type}).")
        bases[key] = row.avg_resolution_time.total_seconds() if row.avg_resolution_time is not None else None
    incidents = []
    for row in active:
        seconds = bases.get((row.id_edifice, row.resource_type))
        if seconds is None or seconds <= 0:
            raise ValueError(f"Нет положительного базового времени для события №{row.id_event}.")
        incidents.append({"event_id": row.id_event, "object_id": row.id_edifice,
                          "resource": row.resource_type, "base_duration_seconds": seconds,
                          "occurred_at": event_time(row.occurred_at)})
    workforce = []
    for row in roster:
        skills = {}
        for qualification in row["qualifications"]:
            resource = qualification["resource_type"]
            if resource in skills:
                raise ValueError(f"Повторяется квалификация рабочего №{row['tabel']} ({resource}).")
            if qualification["proff"] is not None:
                skills[resource] = qualification["proff"]
        workforce.append({"tabel": row["tabel"], "qualifications": skills})
    dependencies = [row.model_dump() for row in session.exec(select(EdificeDependency))]
    problem = {"employees": workforce, "incidents": incidents,
               "precedences": event_precedences([row.model_dump() for row in active], dependencies)}
    if incidents:
        problem_from_dict(problem)  # Fail before starting a background job.
    return PlanningInput(state.revision, origin, roster,
                         {row.id_edifice: row.name for row in session.exec(select(Edifice))}, problem)


def validated_problem(snapshot: PlanningInput) -> Problem:
    return problem_from_dict(snapshot.problem)
