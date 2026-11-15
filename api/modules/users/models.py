from sqlmodel import SQLModel, Field
from pydantic import field_validator
import re


class UserBase(SQLModel):
    # Для первоначального администратора здесь хранится логин, для остальных — email.
    email: str = Field(unique=True, index=True)
    full_name: str | None = None

class User(UserBase, table=True):
    id: int | None = Field(default=None, primary_key=True)
    hashed_password: str
    is_active: bool = True
    role: str = "user"

class UserCreate(UserBase):
    password: str = Field(min_length=8, max_length=128)

    @field_validator("email")
    @classmethod
    def validate_email(cls, value: str) -> str:
        value = value.strip()
        if len(value) > 254 or not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", value):
            raise ValueError("Invalid email address")
        return value

class AdminUserCreate(UserCreate):
    role: str = "user"
    is_active: bool = True

class UserPublic(UserBase):
    """Ответ API: пароль и его хеш клиенту не передаются."""
    id: int
    role: str
    is_active: bool
    role_name: str
    permissions: list[str]

class UserUpdate(SQLModel):
    role: str
    is_active: bool

class Token(SQLModel):
    access_token: str
    token_type: str = "bearer"
