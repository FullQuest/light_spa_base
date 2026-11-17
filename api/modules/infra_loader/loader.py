from functools import lru_cache

from sqlalchemy import create_engine, delete, func, select, text
from sqlalchemy.engine import Engine
from sqlmodel import Session, SQLModel

from .models import Edifice, EdificeDependency, Event, EventStatus

# Внешний PostgreSQL — единственный источник данных, только чтение.
PG_URL = "postgresql+psycopg2://anon:anon@as.start:5432/main"

# Порядок удаления: сначала зависимые таблицы, затем родительские.
_DELETE_ORDER = (Event, EdificeDependency, Edifice, EventStatus)
_TABLES = [m.__table__ for m in _DELETE_ORDER]


@lru_cache(maxsize=1)
def _pg_engine() -> Engine:
    return create_engine(PG_URL, pool_pre_ping=True)


def _reset_schema(session: Session) -> None:
    """Пересоздаёт таблицы модуля, чтобы схема SQLite соответствовала моделям."""
    engine = session.get_bind()
    # Порядок drop_all уже учтён: зависимые таблицы удаляются первыми.
    SQLModel.metadata.drop_all(engine, tables=_TABLES)
    SQLModel.metadata.create_all(engine, tables=_TABLES)


def delete_all(session: Session) -> dict[str, int]:
    """Полностью и безвозвратно удаляет все данные из локальных таблиц модуля."""
    counts: dict[str, int] = {}
    for model in _DELETE_ORDER:
        counts[model.__tablename__] = session.execute(
            select(func.count()).select_from(model)
        ).scalar_one()
    for model in _DELETE_ORDER:
        session.execute(delete(model))
    session.commit()
    return counts


def load_all(session: Session) -> dict[str, int]:
    """Копирует все данные из PostgreSQL в локальную SQLite (полная замена)."""
    with _pg_engine().connect() as conn:
        statuses = (
            conn.execute(text("SELECT id_status, name FROM event_statuses"))
            .mappings()
            .all()
        )
        edifices = (
            conn.execute(
                text(
                    "SELECT id_edifice, name, resource_type, district, street, house_number "
                    "FROM edifices"
                )
            )
            .mappings()
            .all()
        )
        deps = (
            conn.execute(
                text(
                    "SELECT resource_type, id_edifice_dependent, id_edifice_source "
                    "FROM edifice_dependencies"
                )
            )
            .mappings()
            .all()
        )
        events = (
            conn.execute(
                text(
                    "SELECT id_event, id_status, id_edifice, resource_type, occurred_at "
                    "FROM events"
                )
            )
            .mappings()
            .all()
        )

    # Пересоздаём схему, чтобы избавиться от устаревших таблиц (create_all не мигрирует).
    _reset_schema(session)

    for row in statuses:
        session.add(EventStatus(**row))
    for row in edifices:
        session.add(Edifice(**row))

    skipped_self_deps = 0
    for row in deps:
        if row["id_edifice_dependent"] == row["id_edifice_source"]:
            skipped_self_deps += 1
            continue
        session.add(EdificeDependency(**row))

    for row in events:
        session.add(Event(**row))

    session.commit()

    return {
        "event_statuses": len(statuses),
        "edifices": len(edifices),
        "edifice_dependencies": len(deps) - skipped_self_deps,
        "edifice_dependencies_skipped_self": skipped_self_deps,
        "events": len(events),
    }
