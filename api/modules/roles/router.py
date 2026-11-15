from typing import Annotated
from uuid import uuid4
from fastapi import APIRouter, Depends, HTTPException, Response
from sqlmodel import Session, select
from core.db import get_session
from modules.users.dependencies import get_current_user, require_roles
from modules.users.models import User
from .models import Role, RoleWrite, RolePublic, PERMISSIONS
from .service import get_role, permissions_for

router = APIRouter(prefix="/roles", tags=["roles"])
Superadmin = Annotated[User, Depends(require_roles("superadmin"))]
Database = Annotated[Session, Depends(get_session)]


@router.get("", response_model=list[RolePublic])
def list_roles(user: Annotated[User, Depends(get_current_user)], session: Database):
    return [RolePublic(id=r.id, name=r.name, permissions=permissions_for(r))
            for r in session.exec(select(Role).order_by(Role.name)).all()]


@router.get("/permissions")
def list_permissions(user: Superadmin):
    return PERMISSIONS


@router.post("", response_model=RolePublic, status_code=201)
def create_role(data: RoleWrite, user: Superadmin, session: Database):
    role = Role(id=uuid4().hex, **data.model_dump())
    session.add(role)
    session.commit()
    session.refresh(role)
    return role


@router.patch("/{role_id}", response_model=RolePublic)
def update_role(role_id: str, data: RoleWrite, user: Superadmin, session: Database):
    role = get_role(session, role_id)
    if role_id == "superadmin":
        raise HTTPException(status_code=403, detail="Системную роль суперадминистратора менять нельзя")
    role.name = data.name
    role.permissions = data.permissions
    session.commit()
    session.refresh(role)
    return role


@router.delete("/{role_id}", status_code=204)
def delete_role(role_id: str, user: Superadmin, session: Database):
    role = get_role(session, role_id)
    if role_id in ("user", "superadmin"):
        raise HTTPException(status_code=403, detail="Системную роль удалить нельзя")
    if session.exec(select(User).where(User.role == role_id)).first():
        raise HTTPException(status_code=409, detail="Сначала назначьте пользователям другую роль")
    session.delete(role)
    session.commit()
    return Response(status_code=204)
