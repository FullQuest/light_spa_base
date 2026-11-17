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
from sqlmodel import Session, select

from .models import Edifice, EdificeDependency, Event, EventStatus, InfrastructureSync

# Внешний PostgreSQL — единственный источник данных, только чтение.
PG_URL = "postgresql+psycopg2://anon:anon@as.start:5432/main"
SYNC_INTERVAL_SECONDS = 5
SOURCE_TIMEZONE = ZoneInfo("Europe/Moscow")
RESOURCES = {"water", "energy"}

logger = logging.getLogger(__name__)
_DELETE_ORDER = (Event, EdificeDependency, Edifice, EventStatus)
_sync_lock = RLock()
_last_attempt = 0.0
_last_success: datetime | None = None
_last_result: dict[str, int] | None = None
_source_status = "unavailable"


def _consistent_cache(function):
    # Импорт и чтение полного снимка не перемежаются в одном процессе API.
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
        connect_args={"connect_timeout": 4, "options": "-c statement_timeout=5000"},
    )


def _read_external() -> tuple[list[dict], list[dict], list[dict], list[dict]]:
    # Все четыре таблицы читаем из одного согласованного снимка PostgreSQL.
    with _pg_engine().connect().execution_options(isolation_level="REPEATABLE READ") as connection, connection.begin():
        statuses = [dict(row) for row in connection.execute(text(
            "SELECT id_status, name FROM event_statuses ORDER BY id_status"
        )).mappings()]
        edifices = [dict(row) for row in connection.execute(text(
            "SELECT id_edifice, name, resource_type, district, street, house_number FROM edifices ORDER BY id_edifice"
        )).mappings()]
        dependencies = [dict(row) for row in connection.execute(text(
            "SELECT resource_type, id_edifice_dependent, id_edifice_source FROM edifice_dependencies"
        )).mappings()]
        events = [dict(row) for row in connection.execute(text(
            "SELECT id_event, id_status, id_edifice, resource_type, occurred_at FROM events"
        )).mappings()]
    return statuses, edifices, dependencies, events


def _validate_external(data: tuple[list[dict], list[dict], list[dict], list[dict]]) -> int:
    statuses, edifices, dependencies, events = data
    status_names = {row["id_status"]: row["name"] for row in statuses}
    edifice_ids = {row["id_edifice"] for row in edifices}
    resources_by_id = {row["id_edifice"]: set(row["resource_type"] or []) for row in edifices}
    if len(edifice_ids) != len(edifices):
        raise ValueError("Внешняя БД вернула повторяющиеся ID объектов")
    for resources in resources_by_id.values():
        if not resources or not resources <= RESOURCES:
            raise ValueError("Внешняя БД содержит неподдерживаемые типы ресурсов")

    adjacency = {edifice_id: [] for edifice_id in edifice_ids}
    indegree = dict.fromkeys(edifice_ids, 0)
    for edge in dependencies:
        source, target, resource = edge["id_edifice_source"], edge["id_edifice_dependent"], edge["resource_type"]
        if source not in edifice_ids or target not in edifice_ids or resource not in RESOURCES:
            raise ValueError("Внешняя БД вернула некорректную зависимость")
        if resource not in resources_by_id[source] or resource not in resources_by_id[target]:
            raise ValueError("Ресурс зависимости отсутствует у связанного объекта")
        if source != target:
            adjacency[source].append(target)
            indegree[target] += 1

    queue = [edifice_id for edifice_id, degree in indegree.items() if degree == 0]
    visited = 0
    for source in queue:
        visited += 1
        for target in adjacency[source]:
            indegree[target] -= 1
            if indegree[target] == 0:
                queue.append(target)
    if visited != len(edifice_ids):
        raise ValueError("Топология внешней БД содержит цикл")

    for event in events:
        if (event["id_edifice"] not in edifice_ids or event["resource_type"] not in RESOURCES or
                event["resource_type"] not in resources_by_id[event["id_edifice"]] or
                event["id_status"] not in status_names):
            raise ValueError("Внешняя БД вернула некорректное событие")
        status_category(status_names[event["id_status"]])
    return sum(1 for edge in dependencies if edge["id_edifice_source"] == edge["id_edifice_dependent"])


def _replace_local(session: Session, data: tuple[list[dict], list[dict], list[dict], list[dict]]) -> dict[str, int]:
    statuses, edifices, dependencies, events = data
    skipped_self = _validate_external(data)
    prepared_dependencies = [row for row in dependencies
                             if row["id_edifice_source"] != row["id_edifice_dependent"]]
    # Проверяем обязательные поля до любых изменений локальной копии.
    prepared_statuses = [EventStatus.model_validate(row) for row in statuses]
    prepared_edifices = [Edifice.model_validate(row) for row in edifices]
    prepared_edges = [EdificeDependency.model_validate(row) for row in prepared_dependencies]
    prepared_events = [Event.model_validate(row) for row in events]
    try:
        for model in _DELETE_ORDER:
            session.execute(delete(model))
        session.add_all(prepared_statuses)
        session.add_all(prepared_edifices)
        session.flush()
        session.add_all(prepared_edges)
        session.add_all(prepared_events)
        sync = session.get(InfrastructureSync, 1) or InfrastructureSync(synced_at=datetime.now(timezone.utc))
        sync.synced_at = datetime.now(timezone.utc)
        session.add(sync)
        session.commit()
    except Exception:
        session.rollback()
        raise
    return {
        "event_statuses": len(statuses),
        "edifices": len(edifices),
        "edifice_dependencies": len(prepared_dependencies),
        "edifice_dependencies_skipped_self": skipped_self,
        "events": len(events),
    }


@_consistent_cache
def load_all(session: Session) -> dict[str, int]:
    """Полностью загружает внешний снимок и атомарно заменяет локальный кэш."""
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
    """Обновляет кэш не чаще заданного интервала; сбой оставляет прежний снимок."""
    global _last_attempt, _last_success, _last_result, _source_status
    if not _sync_lock.acquire(timeout=5):
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
    return {"sourceStatus": _source_status,
            "syncedAt": last_success.isoformat() if last_success else None}


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
    # В исходной БД timestamp хранится как местное московское время без offset.
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
        "demo": False,
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
