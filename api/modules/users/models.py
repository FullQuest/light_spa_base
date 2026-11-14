from typing import Optional
from sqlmodel import SQLModel, Field

class UserBase(SQLModel):
    email: str = Field(unique=True, index=True)
    full_name: Optional[str] = None

class User(UserBase, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    hashed_password: str
    is_active: bool = True

class UserCreate(UserBase):
    password: str

class UserPublic(UserBase):
    id: int

class Token(SQLModel):
    access_token: str
    token_type: str = "bearer"
