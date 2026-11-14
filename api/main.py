from fastapi import FastAPI
from sqlmodel import SQLModel
from core.db import engine
from modules.users.router import router as users_router

SQLModel.metadata.create_all(engine)  # на старте MVP — быстро и просто

app = FastAPI(title="Contest API")
app.include_router(users_router)

