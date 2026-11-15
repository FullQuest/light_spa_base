from modules.roles.service import get_role, permissions_for
from sqlmodel import Session, select
from pwdlib import PasswordHash
from fastapi import HTTPException
from sqlalchemy.exc import IntegrityError
from .models import User, UserCreate, UserPublic

password_hash = PasswordHash.recommended()  # Argon2id

def get_user_by_email(session: Session, email: str) -> User | None:
    return session.exec(select(User).where(User.email == email)).first()

def create_user(session: Session, user_create: UserCreate, *, role: str = "user", is_active: bool = True) -> User:
    get_role(session, role)
    db_user = User(
        email=user_create.email,
        full_name=user_create.full_name,
        hashed_password=password_hash.hash(user_create.password),
        role=role,
        is_active=is_active,
    )
    session.add(db_user)
    try:
        session.commit()
    except IntegrityError:
        session.rollback()
        # Уникальность проверяет БД, в том числе при одновременном создании аккаунтов.
        if get_user_by_email(session, user_create.email):
            raise HTTPException(status_code=409, detail="Email already registered") from None
        raise
    session.refresh(db_user)
    return db_user

def authenticate(session: Session, email: str, password: str) -> User | None:
    user = get_user_by_email(session, email)
    if not user:
        return None
    if not password_hash.verify(password, user.hashed_password):
        return None
    return user


def public_user(session: Session, user: User) -> UserPublic:
    role = get_role(session, user.role)
    return UserPublic(**user.model_dump(), role_name=role.name,
                      permissions=permissions_for(role))
