from typing import Annotated
from uuid import UUID
from fastapi import APIRouter, Depends, Response
from sqlmodel import Session, select
from core.db import get_session
from modules.users.dependencies import require_permission
from modules.users.models import User
from .models import Source, SourceSchedule, SourceWrite, SourceInfo, SourceDetail, SourceSettings
from .service import get_source, apply_settings, poll_source, source_lock, public_source

router = APIRouter(prefix="/sources", tags=["sources"], dependencies=[Depends(require_permission("sources.view"))])
Database = Annotated[Session, Depends(get_session)]
Manager = Annotated[User, Depends(require_permission("sources.manage"))]


def public_settings(session: Session, source: Source) -> dict:
    return public_source(session, source)


@router.get("", response_model=list[SourceInfo])
def list_sources(session: Database):
    return [public_source(session, source) for source in session.exec(select(Source).order_by(Source.name)).all()]


@router.post("", response_model=SourceSettings, status_code=201)
def create_source(data: SourceWrite, session: Database, user: Manager):
    source = Source()
    apply_settings(session, source, data)
    session.add(source)
    session.commit()
    session.refresh(source)
    return public_settings(session, source)


@router.get("/{source_id}", response_model=SourceDetail)
def detail(source_id: UUID, session: Database):
    return public_source(session, get_source(session, source_id.hex))


@router.get("/{source_id}/settings", response_model=SourceSettings)
def settings(source_id: UUID, session: Database, user: Manager):
    return public_settings(session, get_source(session, source_id.hex))


@router.put("/{source_id}", response_model=SourceSettings)
def update_source(source_id: UUID, data: SourceWrite, session: Database, user: Manager):
    with source_lock(source_id.hex):
        source = get_source(session, source_id.hex)
        apply_settings(session, source, data)
        session.add(source)
        session.commit()
        session.refresh(source)
        return public_settings(session, source)


@router.post("/{source_id}/poll", response_model=SourceDetail)
def poll(source_id: UUID, user: Manager):
    return poll_source(source_id.hex)


@router.delete("/{source_id}", status_code=204)
def delete_source(source_id: UUID, session: Database, user: Manager):
    with source_lock(source_id.hex):
        source = get_source(session, source_id.hex)
        schedule = session.get(SourceSchedule, source.id)
        if schedule:
            session.delete(schedule)
        session.delete(source)
        session.commit()
    return Response(status_code=204)
