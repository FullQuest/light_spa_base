from sqlmodel import Session, select
from pwdlib import PasswordHash
from .models import User, UserCreate

password_hash = PasswordHash.recommended()  # Argon2id

def get_user_by_email(session: Session, email: str) -> User | None:
    return session.exec(select(User).where(User.email == email)).first()

def create_user(session: Session, user_create: UserCreate) -> User:
    db_user = User(
        email=user_create.email,
        full_name=user_create.full_name,
        hashed_password=password_hash.hash(user_create.password),
    )
    session.add(db_user)
    session.commit()
    session.refresh(db_user)
    return db_user

def authenticate(session: Session, email: str, password: str) -> User | None:
    user = get_user_by_email(session, email)
    if not user:
        return None
    if not password_hash.verify(password, user.hashed_password):
        return None
    return user
