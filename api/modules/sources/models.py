from datetime import datetime
from typing import Any, Literal
from uuid import uuid4
from pydantic import HttpUrl, field_validator, model_validator
from sqlalchemy import Column, JSON
from sqlmodel import SQLModel, Field


class Source(SQLModel, table=True):
    id: str = Field(default_factory=lambda: uuid4().hex, primary_key=True)
    name: str
    url: str
    auth_type: str = "none"
    token: str = ""
    interval_seconds: int = 300
    enabled: bool = True
    next_poll_at: datetime | None = None
    last_attempt_at: datetime | None = None
    last_success_at: datetime | None = None
    status: str = "never"
    error: str | None = None
    payload: Any = Field(default=None, sa_column=Column(JSON, nullable=True))


class SourceSchedule(SQLModel, table=True):
    source_id: str = Field(primary_key=True)
    time: str
    weekdays: list[int] = Field(sa_column=Column(JSON, nullable=False))


class SourceWrite(SQLModel):
    name: str = Field(min_length=1, max_length=120)
    url: HttpUrl
    auth_type: Literal["none", "bearer"] = "none"
    token: str = Field(default="", max_length=4096, repr=False)
    interval_seconds: int = Field(default=300, ge=1, le=86400)
    enabled: bool = True

    schedule_mode: Literal["interval", "calendar"] = "interval"
    schedule_time: str = "09:00"
    weekdays: list[int] = Field(default_factory=lambda: list(range(7)))

    @model_validator(mode="after")
    def validate_schedule(self):
        if self.schedule_mode == "calendar":
            import re
            if not re.fullmatch(r"(?:[01]\d|2[0-3]):[0-5]\d", self.schedule_time):
                raise ValueError("Укажите время в формате ЧЧ:ММ")
            if not self.weekdays or any(day not in range(7) for day in self.weekdays):
                raise ValueError("Выберите дни недели от 0 (понедельник) до 6 (воскресенье)")
            self.weekdays = sorted(set(self.weekdays))
        return self

    @field_validator("name")
    @classmethod
    def valid_name(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("Название не должно быть пустым")
        return value

    @field_validator("url")
    @classmethod
    def valid_url(cls, value: HttpUrl) -> HttpUrl:
        if value.username or value.password or value.fragment:
            raise ValueError("Авторизация задаётся отдельно, URL должен быть без фрагмента")
        return value

    @field_validator("token")
    @classmethod
    def valid_token(cls, value: str) -> str:
        if "\r" in value or "\n" in value:
            raise ValueError("Недопустимые символы токена")
        return value.strip()


class SourceInfo(SQLModel):
    schedule_mode: str = "interval"
    schedule_time: str = "09:00"
    weekdays: list[int] = Field(default_factory=lambda: list(range(7)))
    id: str
    name: str
    interval_seconds: int
    enabled: bool
    next_poll_at: datetime | None
    last_attempt_at: datetime | None
    last_success_at: datetime | None
    status: str
    error: str | None


class SourceDetail(SourceInfo):
    payload: Any


class SourceSettings(SourceInfo):
    url: str
    auth_type: str
    has_token: bool
