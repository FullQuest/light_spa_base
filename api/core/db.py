import os
from collections.abc import Generator
from sqlmodel import Session, create_engine

# DATABASE_URL задан в compose.yaml как sqlite:////api/data/db.sqlite3
# (volume ./db монтируется в /api/data). Раньше здесь был жёстко прописан
# путь /app/data/db.sqlite3 — такого каталога в контейнере нет, из-за чего
# create_engine().connect() падал на старте, uvicorn не поднимался,
# и nginx/vite возвращали 502 Bad Gateway на /auth/*.
DATABASE_URL = os.getenv(
    "DATABASE_URL",
    "sqlite:////api/data/db.sqlite3",
)

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