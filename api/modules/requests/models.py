from datetime import datetime, timezone
from typing import Literal
from pydantic import field_validator
from sqlmodel import SQLModel, Field

RequestStatus = Literal["new", "in_progress", "done"]


def now_utc() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


class RequestWrite(SQLModel):
    title: str = Field(min_length=1, max_length=200)
    description: str = Field(default="", max_length=10000)
    status: RequestStatus = "new"
    assignee_id: int | None = None

    @field_validator("title")
    @classmethod
    def valid_title(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("Название не должно быть пустым")
        return value


class Request(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    title: str
    description: str = ""
    status: str = "new"
    author_id: int
    assignee_id: int | None = None
    created_at: datetime = Field(default_factory=now_utc)
    updated_at: datetime = Field(default_factory=now_utc)


class RequestPublic(RequestWrite):
    id: int
    author_id: int
    author_name: str
    assignee_name: str | None
    created_at: datetime
    updated_at: datetime
