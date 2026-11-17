from modules.graph.router import router as graph_router
from fastapi import FastAPI
from sqlmodel import SQLModel, Session
from core.db import engine
from modules.users.router import router as users_router
from modules.users.bootstrap import init_superadmin
from modules.user_admin.router import router as user_admin_router
from modules.roles.router import router as roles_router
from modules.roles.service import init_roles
from modules.documents.router import router as documents_router
from modules.search.router import router as search_router
from modules.sources.router import router as sources_router
from modules.sources.scheduler import sources_lifespan
from modules.requests.router import router as requests_router
from modules.infra_loader.router import router as infra_loader_router

# Модели новых модулей должны быть импортированы до создания таблиц.
SQLModel.metadata.create_all(engine)
with Session(engine) as session:
    init_roles(session)
init_superadmin()

app = FastAPI(title="Light SPA API", lifespan=sources_lifespan)
app.include_router(graph_router, prefix="/api")
app.include_router(roles_router, prefix="/api")
app.include_router(users_router, prefix="/api")
app.include_router(user_admin_router, prefix="/api")
app.include_router(documents_router, prefix="/api")
app.include_router(search_router, prefix="/api")
app.include_router(sources_router, prefix="/api")
app.include_router(requests_router, prefix="/api")
app.include_router(infra_loader_router, prefix="/api")
# Новые модули подключаются здесь через app.include_router(..., prefix="/api").