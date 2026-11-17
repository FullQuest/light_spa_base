from datetime import datetime

from sqlalchemy import JSON, Column
from sqlmodel import Field, SQLModel


class EventStatus(SQLModel, table=True):
    __tablename__ = "event_statuses"

    id_status: int = Field(primary_key=True)
    name: str = Field(max_length=20)


class Edifice(SQLModel, table=True):
    __tablename__ = "edifices"

    id_edifice: int = Field(primary_key=True)
    name: str = Field(max_length=120)
    # В PostgreSQL это varchar(15)[]. В SQLite храним как JSON-массив строк.
    resource_type: list[str] = Field(sa_column=Column(JSON, nullable=False))
    district: str = Field(max_length=50)
    street: str = Field(max_length=80)
    house_number: str = Field(max_length=10)


class EdificeDependency(SQLModel, table=True):
    __tablename__ = "edifice_dependencies"

    resource_type: str = Field(primary_key=True, max_length=15)
    id_edifice_dependent: int = Field(
        primary_key=True, foreign_key="edifices.id_edifice"
    )
    id_edifice_source: int = Field(
        primary_key=True, foreign_key="edifices.id_edifice"
    )


class Event(SQLModel, table=True):
    __tablename__ = "events"

    id_event: int = Field(primary_key=True)
    id_status: int = Field(foreign_key="event_statuses.id_status")
    id_edifice: int = Field(foreign_key="edifices.id_edifice")
    resource_type: str = Field(max_length=15)
    # timestamp без таймзоны — как в PostgreSQL, без каких-либо преобразований.
    occurred_at: datetime


class InfrastructureSync(SQLModel, table=True):
    """Последняя успешная синхронизация переживает перезапуск API."""

    id: int = Field(default=1, primary_key=True)
    synced_at: datetime
