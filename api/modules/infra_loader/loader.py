from datetime import datetime, timezone
from functools import lru_cache, wraps
import hashlib
import json
import logging
from threading import RLock
from time import monotonic
from zoneinfo import ZoneInfo

from sqlalchemy import create_engine, delete, func, text
from sqlalchemy.engine import Engine
from sqlmodel import Session, select, SQLModel

from .models import (
    Edifice,
    EdificeDependency,
    Employee,
    Event,
    EventStatus,
    InfrastructureSync,
    Qualification,
    TimeResolve,
)

PG_URL = "postgresql+psycopg2://anon:anon@as.start:5432/main"
SYNC_INTERVAL_SECONDS = 2
SOURCE_TIMEZONE = ZoneInfo("Europe/Moscow")
RESOURCES = {"water", "energy"}

logger = logging.getLogger(__name__)
_DELETE_ORDER = (
    Event,
    EdificeDependency,
    TimeResolve,
    Qualification,
    Employee,
    Edifice,
    EventStatus,
)
_sync_lock = RLock()
_last_attempt = 0.0
_last_success: datetime | None = None
_last_result: dict[str, int] | None = None
_source_status = "unavailable"
_schema_ready = False


def _consistent_cache(function):
    @wraps(function)
    def wrapped(*args, **kwargs):
        with _sync_lock:
            return function(*args, **kwargs)
    return wrapped


@lru_cache(maxsize=1)
def _pg_engine() -> Engine:
    return create_engine(
        PG_URL,
        pool_pre_ping=True,
        connect_args={"connect_timeout": 1, "options": "-c statement_timeout=3000"},
    )


def _ensure_schema(session: Session) -> None:
    """Один раз за процесс пересоздаёт qualification, чтобы снять устаревший
    UNIQUE-индекс на resource_type, оставшийся от старой схемы SQLite."""
    global _schema_ready
    if _schema_ready:
        return
    session.execute(text("DROP TABLE IF EXISTS qualification"))
    SQLModel.metadata.create_all(session.connection(), checkfirst=True)
    session.commit()
    _schema_ready = True


def _read_external():
    with _pg_engine().connect().execution_options(isolation_level="REPEATABLE READ") as connection, connection.begin():
        statuses = [dict(row) for row in connection.execute(text(
            "SELECT id_status, name FROM event_statuses ORDER BY id_status"
        )).mappings()]
        edifices = [dict(row) for row in connection.execute(text(
            "SELECT id_edifice, name, resource_type, district, street, house_number "
            "FROM edifices ORDER BY id_edifice"
        )).mappings()]
        dependencies = [dict(row) for row in connection.execute(text(
            "SELECT resource_type, id_edifice_dependent, id_edifice_source "
            "FROM edifice_dependencies ORDER BY id_edifice_source, id_edifice_dependent, resource_type"
        )).mappings()]
        events = [dict(row) for row in connection.execute(text(
            "SELECT id_event, id_status, id_edifice, resource_type, occurred_at "
            "FROM events ORDER BY id_event"
        )).mappings()]
        time_resolves = [dict(row) for row in connection.execute(text(
            "SELECT id_time, resource_type, avg_resolution_time, id_edifice "
            "FROM time_resolve ORDER BY id_time"
        )).mappings()]
        employees = [dict(row) for row in connection.execute(text(
            "SELECT tabel::int AS tabel, first_name, last_name, middle_name, start_date_experience "
            "FROM employee ORDER BY tabel"
        )).mappings()]
        qualifications = [dict(row) for row in connection.execute(text(
            "SELECT id_qualification, id_employee::int AS id_employee, resource_type, proff::float8 AS proff "
            "FROM qualification ORDER BY id_qualification"
        )).mappings()]
    return {
        "statuses": statuses,
        "edifices": edifices,
        "dependencies": dependencies,
        "events": events,
        "time_resolves": time_resolves,
        "employees": employees,
        "qualifications": qualifications,
    }


def _replace_local(session: Session, data: dict) -> dict[str, int]:
    _ensure_schema(session)
    try:
        for model in _DELETE_ORDER:
            session.execute(delete(model))
        session.add_all(EventStatus.model_validate(row) for row in data["statuses"])
        session.add_all(Edifice.model_validate(row) for row in data["edifices"])
        session.flush()
        session.add_all(EdificeDependency.model_validate(row) for row in data["dependencies"])
        session.add_all(Event.model_validate(row) for row in data["events"])
        session.add_all(TimeResolve.model_validate(row) for row in data["time_resolves"])
        session.add_all(Employee.model_validate(row) for row in data["employees"])
        session.flush()
        session.add_all(Qualification.model_validate(row) for row in data["qualifications"])
        sync = session.get(InfrastructureSync, 1) or InfrastructureSync(synced_at=datetime.now(timezone.utc))
        sync.synced_at = datetime.now(timezone.utc)
        session.add(sync)
        session.commit()
    except Exception:
        session.rollback()
        raise
    return {
        "event_statuses": len(data["statuses"]),
        "edifices": len(data["edifices"]),
        "edifice_dependencies": len(data["dependencies"]),
        "events": len(data["events"]),
        "time_resolve": len(data["time_resolves"]),
        "employees": len(data["employees"]),
        "qualifications": len(data["qualifications"]),
    }


@_consistent_cache
def load_all(session: Session) -> dict[str, int]:
    """Полностью копирует внешний снимок в локальную БД."""
    data = _read_external()
    return _replace_local(session, data)


@_consistent_cache
def delete_all(session: Session) -> dict[str, int]:
    global _last_attempt, _last_success, _last_result, _source_status
    counts = {model.__tablename__: session.exec(select(func.count()).select_from(model)).one()
              for model in _DELETE_ORDER}
    for model in _DELETE_ORDER:
        session.execute(delete(model))
    session.execute(delete(InfrastructureSync))
    session.commit()
    _last_attempt, _last_success, _last_result, _source_status = 0.0, None, None, "unavailable"
    return counts


def sync_if_due(session: Session, *, force: bool = False) -> dict[str, int] | None:
    """Копирует данные из PostgreSQL не чаще заданного интервала."""
    global _last_attempt, _last_success, _last_result, _source_status
    if not _sync_lock.acquire(timeout=1.5):
        return None
    try:
        now = monotonic()
        if not force and now - _last_attempt < SYNC_INTERVAL_SECONDS:
            return _last_result
        _last_attempt = now
        try:
            result = load_all(session)
        except Exception:
            logger.exception("Infrastructure database synchronization failed")
            session.rollback()
            try:
                has_cache = session.exec(select(func.count()).select_from(Edifice)).one() > 0
            except Exception:
                session.rollback()
                has_cache = False
            _source_status = "stale" if has_cache else "unavailable"
            return None
        _last_success = datetime.now(timezone.utc)
        _last_result = result
        _source_status = "online"
        return result
    finally:
        _sync_lock.release()


def sync_metadata(session: Session) -> dict[str, str | None]:
    sync = session.get(InfrastructureSync, 1)
    last_success = _last_success or (sync.synced_at.replace(tzinfo=timezone.utc) if sync else None)
    status = "stale" if _source_status == "unavailable" and last_success else _source_status
    return {
        "sourceStatus": status,
        "syncedAt": last_success.isoformat() if last_success else None,
    }


def status_category(name: str) -> str:
    normalized = name.casefold().strip()
    if "авар" in normalized or "incident" in normalized:
        return "incident"
    if "ремонт" in normalized or "техработ" in normalized or "maintenance" in normalized:
        return "maintenance"
    if "норм" in normalized or "восстанов" in normalized or "normal" in normalized:
        return "normal"
    raise ValueError(f"Неизвестная категория статуса события: {name}")


def resource_name(value: str) -> str:
    if value not in RESOURCES:
        raise ValueError(f"Неизвестный тип ресурса: {value}")
    return value


def event_time(value: datetime) -> str:
    aware = value.replace(tzinfo=SOURCE_TIMEZONE) if value.tzinfo is None else value
    return aware.isoformat()


def snapshot_time(value: datetime | None) -> tuple[datetime, str]:
    requested = value or datetime.now(timezone.utc)
    if requested.tzinfo is None:
        requested = requested.replace(tzinfo=SOURCE_TIMEZONE)
    local_cutoff = requested.astimezone(SOURCE_TIMEZONE).replace(tzinfo=None)
    return local_cutoff, requested.astimezone(timezone.utc).isoformat()


def _revision(value: object) -> str:
    encoded = json.dumps(value, ensure_ascii=True, sort_keys=True, separators=(",", ":")).encode()
    return hashlib.sha256(encoded).hexdigest()[:16]


@_consistent_cache
def graph_snapshot(session: Session, requested_at: datetime | None = None) -> dict:
    local_cutoff, as_of = snapshot_time(requested_at)
    edifices = session.exec(select(Edifice).order_by(Edifice.id_edifice)).all()
    dependencies = session.exec(select(EdificeDependency).order_by(
        EdificeDependency.id_edifice_source,
        EdificeDependency.id_edifice_dependent,
        EdificeDependency.resource_type,
    )).all()
    event_rows = session.exec(
        select(Event, EventStatus.name).join(EventStatus, Event.id_status == EventStatus.id_status)
        .where(Event.occurred_at <= local_cutoff)
        .order_by(Event.occurred_at.desc(), Event.id_event.desc())
    ).all()

    latest: dict[tuple[int, str], dict] = {}
    for event, status_name in event_rows:
        resource = resource_name(event.resource_type)
        key = (event.id_edifice, resource)
        if key not in latest:
            latest[key] = {
                "id": str(event.id_event), "objectId": str(event.id_edifice),
                "resource": resource, "occurredAt": event_time(event.occurred_at),
                "status": status_category(status_name), "statusName": status_name,
            }
    event_objects = list(latest.values())

    outgoing = {edge.id_edifice_source for edge in dependencies}
    objects = [{
        "id": str(item.id_edifice),
        "name": item.name,
        "kind": "station" if item.id_edifice in outgoing else "consumer",
        "resources": sorted(resource_name(value) for value in (item.resource_type or [])),
        "states": {},
        "district": item.district or "",
        "address": ", ".join(value for value in (item.street, item.house_number) if value),
        "description": "",
    } for item in edifices]
    edges = [{
        "id": f"{edge.resource_type}:{edge.id_edifice_source}:{edge.id_edifice_dependent}",
        "source": str(edge.id_edifice_source),
        "target": str(edge.id_edifice_dependent),
        "resource": resource_name(edge.resource_type),
    } for edge in dependencies]
    metadata = sync_metadata(session)
    return {
        "topologyRevision": _revision([objects, edges]),
        "eventRevision": _revision(event_objects),
        "asOf": as_of,
        **metadata,
        "objects": objects,
        "dependencies": edges,
        "currentEvents": event_objects,
    }


@_consistent_cache
def event_archive(session: Session) -> dict:
    edifices = {row.id_edifice: row for row in session.exec(select(Edifice)).all()}
    statuses = {row.id_status: row.name for row in session.exec(select(EventStatus)).all()}
    events = session.exec(select(Event).order_by(Event.occurred_at.desc(), Event.id_event.desc())).all()
    return {"events": [{
        "id": str(event.id_event),
        "objectId": str(event.id_edifice),
        "objectName": edifices[event.id_edifice].name,
        "resource": resource_name(event.resource_type),
        "occurredAt": event_time(event.occurred_at),
        "status": status_category(statuses[event.id_status]),
        "statusName": statuses[event.id_status],
        "description": "",
    } for event in events if event.id_edifice in edifices and event.id_status in statuses]}
