from datetime import datetime, timezone
from uuid import uuid4
from typing import Literal
from pydantic import model_validator
from sqlalchemy import Column, JSON
from sqlmodel import SQLModel, Field


class DocumentSummary(SQLModel):
    id: str
    original_name: str
    format: str
    size_bytes: int
    uploaded_by: int
    uploaded_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    status: str = "processing"
    warnings: list[str] = Field(default_factory=list)
    error: str | None = None
    access_mode: str = "all"


class Document(DocumentSummary, table=True):
    id: str = Field(default_factory=lambda: uuid4().hex, primary_key=True)
    text: str = ""
    tables: list[dict] = Field(default_factory=list, sa_column=Column(JSON, nullable=False))
    warnings: list[str] = Field(default_factory=list, sa_column=Column(JSON, nullable=False))
    allowed_role_ids: list[str] = Field(default_factory=list, sa_column=Column(JSON, nullable=False))
    allowed_user_ids: list[int] = Field(default_factory=list, sa_column=Column(JSON, nullable=False))


class DocumentTable(SQLModel):
    name: str
    rows: list[list[str]]


class DocumentInfo(DocumentSummary):
    uploaded_by_name: str


class DocumentDetail(DocumentInfo):
    text: str
    tables: list[DocumentTable]
    allowed_role_ids: list[str]
    allowed_user_ids: list[int]


class DocumentAccess(SQLModel):
    access_mode: Literal["all", "roles", "private", "users"] = "all"
    allowed_role_ids: list[str] = Field(default_factory=list)
    allowed_user_ids: list[int] = Field(default_factory=list)

    @model_validator(mode="after")
    def normalize(self):
        self.allowed_role_ids = sorted(set(self.allowed_role_ids)) if self.access_mode == "roles" else []
        self.allowed_user_ids = sorted(set(self.allowed_user_ids)) if self.access_mode == "users" else []
        if self.access_mode == "roles" and not self.allowed_role_ids:
            raise ValueError("Выберите хотя бы одну роль")
        if self.access_mode == "users" and not self.allowed_user_ids:
            raise ValueError("Выберите хотя бы одного пользователя")
        return self
