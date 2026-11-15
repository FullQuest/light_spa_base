from typing import Annotated
from fastapi import APIRouter, Depends, HTTPException, Response
from sqlmodel import Session, select
from core.db import get_session
from modules.users.dependencies import require_permission
from modules.users.models import User
from .models import Request, RequestWrite, RequestPublic, RequestStatus, now_utc

router = APIRouter(prefix="/requests", tags=["requests"])
Database = Annotated[Session, Depends(get_session)]
Viewer = Annotated[User, Depends(require_permission("requests.view"))]
Manager = Annotated[User, Depends(require_permission("requests.manage"))]


def get_request(session: Session, request_id: int) -> Request:
    item = session.get(Request, request_id)
    if item is None:
        raise HTTPException(status_code=404, detail="Заявка не найдена")
    return item


def public_request(session: Session, item: Request) -> dict:
    author = session.get(User, item.author_id)
    assignee = session.get(User, item.assignee_id) if item.assignee_id else None
    return {**item.model_dump(),
            "author_name": (author.full_name or author.email) if author else f"Пользователь #{item.author_id}",
            "assignee_name": (assignee.full_name or assignee.email) if assignee else None}


def validate_assignee(session: Session, data: RequestWrite):
    if data.assignee_id is not None and session.get(User, data.assignee_id) is None:
        raise HTTPException(status_code=422, detail="Исполнитель не найден")


@router.get("", response_model=list[RequestPublic])
def list_requests(session: Database, user: Viewer, q: str = "", status: RequestStatus | None = None,
                  assignee_id: int | None = None, mine: bool = False):
    query = q.strip().casefold()
    items = session.exec(select(Request).order_by(Request.created_at.desc(), Request.id.desc())).all()
    return [public_request(session, item) for item in items
            if (not query or query in (item.title + "\n" + item.description).casefold())
            and (not status or item.status == status)
            and (assignee_id is None or item.assignee_id == assignee_id)
            and (not mine or item.author_id == user.id)]


@router.get("/assignees")
def assignees(session: Database, user: Viewer):
    return [{"id": person.id, "name": person.full_name or person.email, "is_active": person.is_active}
            for person in session.exec(select(User).order_by(User.email)).all()]


@router.post("", response_model=RequestPublic, status_code=201)
def create_request(data: RequestWrite, session: Database, user: Viewer, manager: Manager):
    validate_assignee(session, data)
    item = Request(**data.model_dump(), author_id=user.id)
    session.add(item)
    session.commit()
    session.refresh(item)
    return public_request(session, item)


@router.get("/{request_id}", response_model=RequestPublic)
def detail(request_id: int, session: Database, user: Viewer):
    return public_request(session, get_request(session, request_id))


@router.put("/{request_id}", response_model=RequestPublic)
def update_request(request_id: int, data: RequestWrite, session: Database, user: Viewer, manager: Manager):
    item = get_request(session, request_id)
    validate_assignee(session, data)
    for field, value in data.model_dump().items():
        setattr(item, field, value)
    item.updated_at = now_utc()
    session.add(item)
    session.commit()
    session.refresh(item)
    return public_request(session, item)


@router.delete("/{request_id}", status_code=204)
def delete_request(request_id: int, session: Database, user: Viewer, manager: Manager):
    session.delete(get_request(session, request_id))
    session.commit()
    return Response(status_code=204)
