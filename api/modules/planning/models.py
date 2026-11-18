from datetime import datetime
from uuid import uuid4

from sqlalchemy import JSON, Column, delete
from sqlmodel import Field, SQLModel


class PlanningData(SQLModel, table=True):
    id: int = Field(default=1, primary_key=True)
    revision: str = Field(default_factory=lambda: uuid4().hex)
    fingerprint: str = ""


class FormationJob(SQLModel, table=True):
    id: str = Field(default_factory=lambda: uuid4().hex, primary_key=True)
    user_id: int = Field(index=True)
    data_revision: str
    created_at: datetime
    status: str = "running"
    progress: int | None = 5
    stage: str = "Подготовка данных"
    error: str | None = None
    result: dict | None = Field(default=None, sa_column=Column(JSON, nullable=True))


def invalidate_plans(session, fingerprint: str = "") -> None:
    """Called in the SAME transaction as data replacement/deletion."""
    state = session.get(PlanningData, 1) or PlanningData()
    state.revision = uuid4().hex
    state.fingerprint = fingerprint
    session.add(state)
    session.execute(delete(FormationJob))
