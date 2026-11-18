from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func
from sqlmodel import Session, select

from core.db import get_session
from modules.users.dependencies import get_current_user, require_roles
from modules.users.models import User

from .loader import delete_all, event_archive, sync_if_due, sync_metadata
from .models import (
    Edifice,
    EdificeDependency,
    Employee,
    Event,
    EventStatus,
    Qualification,
    TimeResolve,
)

router = APIRouter(prefix="/infra-loader", tags=["infra-loader"])
archive_router = APIRouter(prefix="/events", tags=["events"])
Database = Annotated[Session, Depends(get_session)]
Superadmin = Annotated[User, Depends(require_roles("superadmin"))]


@router.post("/delete-all")
def delete_all_endpoint(user: Superadmin, session: Database) -> dict[str, int]:
    """Удаляет локальный кэш (только суперадминистратор)."""
    return delete_all(session)


@router.get("/status")
def get_sync_status(user: Superadmin, session: Database) -> dict:
    return {
        **sync_metadata(session),
        "counts": {
            model.__tablename__: session.exec(select(func.count()).select_from(model)).one()
            for model in (
                Event,
                EdificeDependency,
                TimeResolve,
                Qualification,
                Employee,
                Edifice,
                EventStatus,
            )
        },
    }


@router.post("/fetch-all")
def fetch_all_endpoint(user: Superadmin, session: Database) -> dict[str, int]:
    """Копирует данные из внешнего PostgreSQL в локальную БД."""
    result = sync_if_due(session, force=True)
    if result is None:
        raise HTTPException(status_code=503, detail="Источник недоступен. Сохранён предыдущий локальный снимок.")
    return result


@router.get("/event-statuses", response_model=list[EventStatus])
def get_event_statuses(user: Superadmin, session: Database) -> list[EventStatus]:
    return list(session.exec(select(EventStatus).order_by(EventStatus.id_status)).all())


@router.get("/edifices", response_model=list[Edifice])
def get_edifices(user: Superadmin, session: Database) -> list[Edifice]:
    return list(session.exec(select(Edifice).order_by(Edifice.id_edifice)).all())


@router.get("/edifice-dependencies", response_model=list[EdificeDependency])
def get_edifice_dependencies(user: Superadmin, session: Database) -> list[EdificeDependency]:
    return list(session.exec(select(EdificeDependency).order_by(
        EdificeDependency.id_edifice_dependent,
        EdificeDependency.id_edifice_source,
        EdificeDependency.resource_type,
    )).all())


@router.get("/events", response_model=list[Event])
def get_events(user: Superadmin, session: Database) -> list[Event]:
    return list(session.exec(select(Event).order_by(Event.id_event)).all())


@router.get("/time-resolve", response_model=list[TimeResolve])
def get_time_resolve(user: Superadmin, session: Database) -> list[TimeResolve]:
    return list(session.exec(select(TimeResolve).order_by(TimeResolve.id_time)).all())


@router.get("/employees", response_model=list[Employee])
def get_employees(user: Superadmin, session: Database) -> list[Employee]:
    return list(session.exec(select(Employee).order_by(Employee.tabel)).all())


@router.get("/qualifications", response_model=list[Qualification])
def get_qualifications(user: Superadmin, session: Database) -> list[Qualification]:
    return list(session.exec(select(Qualification).order_by(Qualification.id_qualification)).all())


@archive_router.get("/archive")
def get_archive(user: Annotated[User, Depends(get_current_user)], session: Database):
    sync_if_due(session)
    if sync_metadata(session)["sourceStatus"] == "unavailable":
        raise HTTPException(status_code=503, detail="Архив недоступен: локальный снимок ещё не загружен")
    return event_archive(session)