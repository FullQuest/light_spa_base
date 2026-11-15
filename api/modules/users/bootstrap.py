"""Создание первоначального суперадминистратора, если его ещё нет."""
from sqlmodel import Session
from core.config import settings
from core.db import engine
from .models import User
from .service import get_user_by_email, password_hash


def init_superadmin():
    if not settings.ADMIN_LOGIN or not settings.ADMIN_PASSWORD:
        return
    with Session(engine) as session:
        # Настройки задают только начальный аккаунт, существующий не меняем.
        if get_user_by_email(session, settings.ADMIN_LOGIN):
            return
        session.add(User(
            email=settings.ADMIN_LOGIN,
            full_name="Администратор",
            hashed_password=password_hash.hash(settings.ADMIN_PASSWORD),
            role="superadmin",
        ))
        session.commit()
