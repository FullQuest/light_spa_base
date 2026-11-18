from datetime import date, datetime, timedelta

from sqlalchemy import JSON, Column, Interval
from sqlmodel import Field, SQLModel


class EventStatus(SQLModel, table=True):
    __tablename__ = "event_statuses"

    id_status: int = Field(primary_key=True)
    name: str = Field(max_length=20)


class Edifice(SQLModel, table=True):
    __tablename__ = "edifices"

    id_edifice: int = Field(primary_key=True)
    name: str = Field(max_length=120)
    # В PostgreSQL varchar(15)[], в SQLite — JSON-массив строк.
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
    occurred_at: datetime


class InfrastructureSync(SQLModel, table=True):
    __tablename__ = "infrastructure_sync"

    id: int = Field(default=1, primary_key=True)
    synced_at: datetime


class TimeResolve(SQLModel, table=True):
    __tablename__ = "time_resolve"

    id_time: int = Field(primary_key=True)
    resource_type: str = Field(max_length=20)
    avg_resolution_time: timedelta | None = Field(
        default=None, sa_column=Column(Interval, nullable=True)
    )
    id_edifice: int = Field(foreign_key="edifices.id_edifice")


class Employee(SQLModel, table=True):
    __tablename__ = "employee"

    tabel: int = Field(primary_key=True)
    first_name: str | None = Field(default=None, max_length=100)
    last_name: str | None = Field(default=None, max_length=100)
    middle_name: str | None = Field(default=None, max_length=100)
    start_date_experience: date | None = None


class Qualification(SQLModel, table=True):
    __tablename__ = "qualification"

    id_qualification: int = Field(primary_key=True)
    id_employee: int = Field(foreign_key="employee.tabel")
    resource_type: str = Field(max_length=20)
    proff: float | None = None