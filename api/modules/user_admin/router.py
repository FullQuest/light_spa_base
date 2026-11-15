from typing import Annotated
from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, select
from core.db import get_session
from modules.users.dependencies import require_permission
from modules.users.models import User, UserPublic, UserUpdate, AdminUserCreate
from modules.users.service import create_user, public_user
from modules.roles.service import get_role

router = APIRouter(prefix="/users", tags=["users"])
# Этот параметр одновременно проверяет доступ и передаёт текущего пользователя.
UserManager = Annotated[User, Depends(require_permission("users.manage"))]


@router.get("", response_model=list[UserPublic])
def list_users(current_user: UserManager, session: Annotated[Session, Depends(get_session)]):
    return [public_user(session, user) for user in session.exec(select(User).order_by(User.id)).all()]


@router.patch("/{user_id}", response_model=UserPublic)
def update_user(
    user_id: int,
    changes: UserUpdate,
    current_user: UserManager,
    session: Annotated[Session, Depends(get_session)],
):
    user = session.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="Пользователь не найден")
    if user.id == current_user.id and (changes.role != user.role or not changes.is_active):
        raise HTTPException(status_code=403, detail="Нельзя изменить свою роль или заблокировать себя")
    get_role(session, changes.role)
    if current_user.role != "superadmin" and (user.role == "superadmin" or changes.role == "superadmin"):
        raise HTTPException(status_code=403, detail="Только суперадминистратор управляет суперадминистраторами")
    user.role = changes.role
    user.is_active = changes.is_active
    session.commit()
    session.refresh(user)
    return public_user(session, user)


@router.post("", response_model=UserPublic, status_code=201)
def add_user(
    data: AdminUserCreate,
    current_user: UserManager,
    session: Annotated[Session, Depends(get_session)],
):
    if data.role == "superadmin" and current_user.role != "superadmin":
        raise HTTPException(status_code=403, detail="Только суперадминистратор назначает эту роль")
    return public_user(session, create_user(session, data, role=data.role, is_active=data.is_active))
