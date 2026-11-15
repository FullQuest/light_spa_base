from datetime import date
from typing import Annotated, Literal
from uuid import UUID
from fastapi import APIRouter, Depends, Form, HTTPException, Response, UploadFile
from fastapi.responses import FileResponse
from pydantic import ValidationError
from sqlmodel import Session, select
from core.db import get_session
from modules.users.dependencies import require_permission
from modules.users.models import User
from modules.roles.models import Role
from .models import Document, DocumentInfo, DocumentDetail, DocumentAccess
from .service import (file_path, get_document, upload_document, can_view,
                      require_owner, validate_access, document_data)

router = APIRouter(prefix="/documents", tags=["documents"])
Database = Annotated[Session, Depends(get_session)]
Viewer = Annotated[User, Depends(require_permission("documents.view"))]
Manager = Annotated[User, Depends(require_permission("documents.manage"))]


def visible_documents(session: Session, user: User) -> list[Document]:
    return [doc for doc in session.exec(select(Document)).all() if can_view(doc, user)]


@router.get("", response_model=list[DocumentInfo])
def list_documents(session: Database, user: Viewer, q: str = "", author_id: int | None = None,
                   date_from: date | None = None, date_to: date | None = None,
                   format: str = "", status: str = "", mine: bool = False,
                   sort: Literal["newest", "oldest", "name"] = "newest"):
    if date_from and date_to and date_from > date_to:
        raise HTTPException(status_code=422, detail="Начальная дата должна быть не позже конечной")
    documents = [doc for doc in visible_documents(session, user)
                 if (not q or q.strip().casefold() in doc.original_name.casefold())
                 and (author_id is None or doc.uploaded_by == author_id)
                 and (not mine or doc.uploaded_by == user.id)
                 and (not date_from or doc.uploaded_at.date() >= date_from)
                 and (not date_to or doc.uploaded_at.date() <= date_to)
                 and (not format or doc.format == format)
                 and (not status or doc.status == status)]
    documents.sort(key=lambda doc: (doc.original_name.casefold(), doc.id) if sort == "name"
                   else (doc.uploaded_at, doc.id), reverse=sort == "newest")
    return [document_data(session, doc) for doc in documents]


@router.get("/authors")
def authors(session: Database, user: Viewer):
    ids = {doc.uploaded_by for doc in visible_documents(session, user)}
    return [{"id": item.id, "name": item.full_name or item.email}
            for item in session.exec(select(User).where(User.id.in_(ids)).order_by(User.email)).all()]


@router.get("/access-options")
def access_options(session: Database, user: Viewer):
    return {
        "roles": [{"id": role.id, "name": role.name} for role in session.exec(select(Role).order_by(Role.name)).all()],
        "users": [{"id": item.id, "name": item.full_name or item.email,
                   "is_active": item.is_active} for item in session.exec(select(User).order_by(User.email)).all()],
    }


@router.post("", response_model=DocumentDetail, status_code=201)
def upload(file: UploadFile, session: Database, user: Viewer, manager: Manager,
           access_mode: Annotated[Literal["all", "roles", "private", "users"], Form()] = "all",
           allowed_role_ids: Annotated[list[str], Form()] = [],
           allowed_user_ids: Annotated[list[int], Form()] = []):
    # Для multipart поля проверяются здесь теми же правилами, что и JSON при редактировании.
    try:
        access = DocumentAccess(access_mode=access_mode, allowed_role_ids=allowed_role_ids,
                                allowed_user_ids=allowed_user_ids)
    except ValidationError:
        raise HTTPException(status_code=422, detail="Выберите роли или пользователей для выбранного режима доступа") from None
    return document_data(session, upload_document(session, file, user.id, access))


@router.get("/{document_id}", response_model=DocumentDetail)
def detail(document_id: UUID, session: Database, user: Viewer):
    return document_data(session, get_document(session, document_id.hex, user))


@router.patch("/{document_id}/access", response_model=DocumentDetail)
def update_access(document_id: UUID, access: DocumentAccess, session: Database, user: Viewer):
    document = get_document(session, document_id.hex, user)
    require_owner(document, user)
    validate_access(session, access)
    document.access_mode = access.access_mode
    document.allowed_role_ids = access.allowed_role_ids
    document.allowed_user_ids = access.allowed_user_ids
    session.add(document)
    session.commit()
    session.refresh(document)
    return document_data(session, document)


@router.get("/{document_id}/original")
def original(document_id: UUID, session: Database, user: Viewer, download: bool = False):
    document = get_document(session, document_id.hex, user)
    path = file_path(document)
    if not path.is_file():
        raise HTTPException(status_code=404, detail="Оригинал отсутствует в хранилище")
    media_type = {"pdf": "application/pdf", "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document"}.get(document.format, "text/plain")
    return FileResponse(path, media_type=media_type, filename=document.original_name,
                        content_disposition_type="attachment" if download else "inline",
                        headers={"Cache-Control": "no-store", "X-Content-Type-Options": "nosniff"})


@router.delete("/{document_id}", status_code=204)
def remove(document_id: UUID, session: Database, user: Viewer, manager: Manager):
    document = get_document(session, document_id.hex, user)
    require_owner(document, user)
    file_path(document).unlink(missing_ok=True)
    session.delete(document)
    session.commit()
    return Response(status_code=204)
