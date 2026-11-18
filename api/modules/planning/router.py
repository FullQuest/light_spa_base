from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session

from core.db import get_session
from modules.infra_loader.loader import _consistent_cache, sync_if_due, sync_metadata
from modules.users.dependencies import get_current_user
from modules.users.models import User
from . import data, service
from .models import FormationJob

router = APIRouter(tags=["planning"])
Database = Annotated[Session, Depends(get_session)]
CurrentUser = Annotated[User, Depends(get_current_user)]


@router.get("/workforce/employees")
@_consistent_cache
def read_employees(user: CurrentUser, session: Database):
    sync_if_due(session)
    result = data.employees(session)
    if not result and sync_metadata(session)["sourceStatus"] == "unavailable":
        raise HTTPException(status_code=503, detail="Источник недоступен, список рабочих ещё не загружен.")
    return result


@router.get("/brigades/result")
@_consistent_cache
def read_result(user: CurrentUser, session: Database):
    return service.last_result(session, user.id)


@router.get("/brigades/jobs/current")
@_consistent_cache
def read_current_job(user: CurrentUser, session: Database):
    job = service.current(session, user.id)
    return service.public_job(job) if job else None


@router.post("/brigades/jobs", status_code=202)
def start_job(user: CurrentUser, session: Database):
    sync_if_due(session)
    try:
        return service.public_job(service.start(session, user.id))
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    except RuntimeError as error:
        raise HTTPException(status_code=409, detail=str(error)) from error


@router.get("/brigades/jobs/{job_id}")
@_consistent_cache
def read_job(job_id: str, user: CurrentUser, session: Database):
    job = session.get(FormationJob, job_id)
    if job is None or job.user_id != user.id:
        raise HTTPException(status_code=404, detail="Расчёт не найден. Возможно, исходные данные были обновлены или очищены.")
    return service.public_job(job)
