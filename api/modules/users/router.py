from typing import Annotated
from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordRequestForm
from sqlmodel import Session
from core.db import get_session
from . import service
from .models import User, UserCreate, UserPublic, Token
from .dependencies import create_access_token, get_current_active_user

router = APIRouter(prefix="/auth", tags=["auth"])

@router.post("/register", response_model=UserPublic)
def register(
    user_create: UserCreate,
    session: Annotated[Session, Depends(get_session)],
):
    if service.get_user_by_email(session, user_create.email):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Email already registered",
        )
    return service.create_user(session, user_create)

@router.post("/login", response_model=Token)
def login(
    form_data: Annotated[OAuth2PasswordRequestForm, Depends()],
    session: Annotated[Session, Depends(get_session)],
):
    user = service.authenticate(session, form_data.username, form_data.password)
    if user is None or user.id is None or not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect email or password",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return Token(access_token=create_access_token(user.id))

@router.get("/me", response_model=UserPublic)
def read_me(
    current_user: Annotated[User, Depends(get_current_active_user)],
):
    return current_user
