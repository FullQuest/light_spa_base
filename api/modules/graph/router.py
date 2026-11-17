from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func
from sqlmodel import Session, select

from modules.infra_loader.loader import graph_snapshot, sync_if_due, sync_metadata
from modules.infra_loader.models import Edifice
from modules.users.dependencies import get_current_user
from modules.users.models import User
from core.db import get_session

router = APIRouter(prefix="/graph", tags=["graph"])
Database = Annotated[Session, Depends(get_session)]
CurrentUser = Annotated[User, Depends(get_current_user)]


@router.get("")
def read_graph(
    user: CurrentUser,
    session: Database,
    at: Annotated[datetime | None, Query(description="Момент снимка ISO-8601; по умолчанию текущее время")] = None,
):
    if at is not None and at.tzinfo is None:
        raise HTTPException(status_code=422, detail="Параметр at должен содержать часовой пояс")
    # Частые клиентские запросы разделяют общий двухсекундный интервал импорта.
    sync_if_due(session)
    metadata = sync_metadata(session)
    object_count = session.exec(select(func.count()).select_from(Edifice)).one()
    if object_count == 0 and metadata["sourceStatus"] == "unavailable":
        raise HTTPException(status_code=503, detail="Источник инфраструктурных данных недоступен, локальный снимок ещё не загружен")
    return graph_snapshot(session, at)
