import os
from collections.abc import Generator
from sqlmodel import Session, create_engine

# В контейнере /api/data связан с локальным каталогом db через Compose.
DATABASE_URL = os.getenv(
    "DATABASE_URL",
    "sqlite:////api/data/db.sqlite3",
)

# FastAPI может использовать соединение SQLite из разных потоков.
connect_args = (
    {"check_same_thread": False}
    if DATABASE_URL.startswith("sqlite")
    else {}
)

engine = create_engine(
    DATABASE_URL,
    connect_args=connect_args,
    echo=False,
)


def get_session() -> Generator[Session, None, None]:
    """Зависимость FastAPI: одна сессия на запрос, автоматически закрывается."""
    with Session(engine) as session:
        yield session
