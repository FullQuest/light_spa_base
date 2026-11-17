from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func
from sqlmodel import Session, select

from core.db import get_session
from modules.users.dependencies import get_current_user, require_roles
from modules.users.models import User

from .loader import delete_all, event_archive, sync_if_due, sync_metadata
from .models import Edifice, EdificeDependency, Event, EventStatus

router = APIRouter(prefix="/infra-loader", tags=["infra-loader"])
archive_router = APIRouter(prefix="/events", tags=["events"])
Database = Annotated[Session, Depends(get_session)]
Superadmin = Annotated[User, Depends(require_roles("superadmin"))]


@router.post("/delete-all")
def delete_all_endpoint(user: Superadmin, session: Database) -> dict[str, int]:
    """Разрушительно удаляет локальный кэш (только суперадминистратор)."""
    return delete_all(session)


@router.get("/status")
def get_sync_status(user: Superadmin, session: Database) -> dict:
    return {
        **sync_metadata(session),
        "counts": {model.__tablename__: session.exec(select(func.count()).select_from(model)).one()
                   for model in (Event, EdificeDependency, Edifice, EventStatus)},
    }


@router.post("/fetch-all")
def fetch_all_endpoint(user: Superadmin, session: Database) -> dict[str, int]:
    """Заменяет локальный кэш копией из внешнего PostgreSQL."""
    result = sync_if_due(session, force=True)
    if result is None:
        raise HTTPException(status_code=503, detail="Источник недоступен. Сохранён предыдущий локальный снимок.")
    return result


@router.get("/event-statuses", response_model=list[EventStatus])
def get_event_statuses(user: Annotated[User, Depends(require_roles("superadmin"))], session: Database) -> list[EventStatus]:
    return list(session.exec(select(EventStatus).order_by(EventStatus.id_status)).all())


@router.get("/edifices", response_model=list[Edifice])
def get_edifices(user: Annotated[User, Depends(require_roles("superadmin"))], session: Database) -> list[Edifice]:
    return list(session.exec(select(Edifice).order_by(Edifice.id_edifice)).all())


@router.get("/edifice-dependencies", response_model=list[EdificeDependency])
def get_edifice_dependencies(user: Annotated[User, Depends(require_roles("superadmin"))], session: Database) -> list[EdificeDependency]:
    return list(session.exec(select(EdificeDependency).order_by(
        EdificeDependency.id_edifice_dependent,
        EdificeDependency.id_edifice_source,
        EdificeDependency.resource_type,
    )).all())


@router.get("/events", response_model=list[Event])
def get_events(user: Annotated[User, Depends(require_roles("superadmin"))], session: Database) -> list[Event]:
    return list(session.exec(select(Event).order_by(Event.id_event)).all())


@archive_router.get("/archive")
def get_archive(user: Annotated[User, Depends(get_current_user)], session: Database):
    # Архив обновляет общий кэш один раз при открытии и возвращает все события.
    sync_if_due(session)
    if sync_metadata(session)["sourceStatus"] == "unavailable":
        raise HTTPException(status_code=503, detail="Архив недоступен: локальный снимок ещё не загружен")
    return event_archive(session)
