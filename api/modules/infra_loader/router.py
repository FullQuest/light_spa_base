from typing import Annotated

from fastapi import APIRouter, Depends
from sqlmodel import Session, select

from core.db import get_session

from .loader import delete_all, load_all
from .models import Edifice, EdificeDependency, Event, EventStatus

router = APIRouter(prefix="/infra-loader", tags=["infra-loader"])
Database = Annotated[Session, Depends(get_session)]


@router.post("/delete-all")
def delete_all_endpoint(session: Database) -> dict[str, int]:
    """Разрушительно удаляет все локальные данные модуля (без возможности восстановления)."""
    return delete_all(session)


@router.post("/fetch-all")
def fetch_all_endpoint(session: Database) -> dict[str, int]:
    """Заменяет все локальные данные копией из внешней PostgreSQL."""
    return load_all(session)


@router.get("/event-statuses", response_model=list[EventStatus])
def get_event_statuses(session: Database) -> list[EventStatus]:
    return list(session.exec(select(EventStatus).order_by(EventStatus.id_status)).all())


@router.get("/edifices", response_model=list[Edifice])
def get_edifices(session: Database) -> list[Edifice]:
    return list(session.exec(select(Edifice).order_by(Edifice.id_edifice)).all())


@router.get("/edifice-dependencies", response_model=list[EdificeDependency])
def get_edifice_dependencies(session: Database) -> list[EdificeDependency]:
    return list(
        session.exec(
            select(EdificeDependency).order_by(
                EdificeDependency.id_edifice_dependent,
                EdificeDependency.id_edifice_source,
                EdificeDependency.resource_type,
            )
        ).all()
    )


@router.get("/events", response_model=list[Event])
def get_events(session: Database) -> list[Event]:
    return list(session.exec(select(Event).order_by(Event.id_event)).all())
