from pydantic import field_validator
from sqlalchemy import Column, JSON
from sqlmodel import SQLModel, Field

# Новые возможности модулей добавляются здесь.
PERMISSIONS = {
    "users.manage": "Управление пользователями",
    "documents.view": "Просмотр документов",
    "documents.manage": "Загрузка и удаление документов",
}


class Role(SQLModel, table=True):
    id: str = Field(primary_key=True)
    name: str
    permissions: list[str] = Field(default_factory=list, sa_column=Column(JSON, nullable=False))


class RoleWrite(SQLModel):
    name: str = Field(min_length=1, max_length=80)
    permissions: list[str] = Field(default_factory=list)

    @field_validator("name")
    @classmethod
    def valid_name(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("Название не должно быть пустым")
        return value

    @field_validator("permissions")
    @classmethod
    def valid_permissions(cls, value: list[str]) -> list[str]:
        if any(item not in PERMISSIONS for item in value):
            raise ValueError("Неизвестное разрешение")
        return sorted(set(value))


class RolePublic(SQLModel):
    id: str
    name: str
    permissions: list[str]
