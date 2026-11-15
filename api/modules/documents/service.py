import logging
from pathlib import Path
from fastapi import HTTPException, UploadFile
from sqlmodel import Session
from core.config import settings
from .extract import FORMATS, extract
from modules.users.models import User
from modules.roles.models import Role
from .models import Document, DocumentAccess

logger = logging.getLogger(__name__)
MAX_UPLOAD_BYTES = 20 * 1024 * 1024


def file_path(document: Document) -> Path:
    return Path(settings.DOCUMENTS_DIR) / f"{document.id}.{document.format}"


def can_view(document: Document, user: User) -> bool:
    return (user.role == "superadmin" or document.uploaded_by == user.id
            or document.access_mode == "all"
            or (document.access_mode == "roles" and user.role in document.allowed_role_ids)
            or (document.access_mode == "users" and user.id in document.allowed_user_ids))


def require_owner(document: Document, user: User):
    if user.role != "superadmin" and document.uploaded_by != user.id:
        raise HTTPException(status_code=403, detail="Изменять доступ и удалять документ может только владелец или суперадминистратор")


def validate_access(session: Session, access: DocumentAccess):
    for role_id in access.allowed_role_ids:
        if session.get(Role, role_id) is None:
            raise HTTPException(status_code=422, detail="Выбрана несуществующая роль")
    for user_id in access.allowed_user_ids:
        if session.get(User, user_id) is None:
            raise HTTPException(status_code=422, detail="Выбран несуществующий пользователь")


def document_data(session: Session, document: Document) -> dict:
    owner = session.get(User, document.uploaded_by)
    name = (owner.full_name or owner.email) if owner else f"Пользователь #{document.uploaded_by}"
    return {**document.model_dump(), "uploaded_by_name": name}


def get_document(session: Session, document_id: str, user: User) -> Document:
    document = session.get(Document, document_id)
    if document is None or not can_view(document, user):
        raise HTTPException(status_code=404, detail="Документ не найден")
    return document


def upload_document(session: Session, file: UploadFile, user_id: int, access: DocumentAccess) -> Document:
    validate_access(session, access)
    name = (file.filename or "document").replace("\\", "/").rsplit("/", 1)[-1]
    format = Path(name).suffix.lower().lstrip(".")
    if format not in FORMATS:
        raise HTTPException(status_code=415, detail="Поддерживаются TXT, MD, CSV, PDF и DOCX")
    data = file.file.read(MAX_UPLOAD_BYTES + 1)
    if len(data) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="Максимальный размер документа — 20 МиБ")
    document = Document(original_name=name, format=format, size_bytes=len(data), uploaded_by=user_id, **access.model_dump())
    path = file_path(document)
    path.parent.mkdir(parents=True, exist_ok=True)
    try:
        path.write_bytes(data)
        session.add(document)
        session.commit()
    except Exception:
        session.rollback()
        path.unlink(missing_ok=True)
        raise
    # Ошибка чтения сохраняется вместе с оригиналом, чтобы файл можно было скачать.
    try:
        document.text, document.tables, document.warnings = extract(path, format)
        document.status = "ready"
    except Exception as exc:
        logger.warning("Document %s extraction failed: %s", document.id, exc)
        document.status = "failed"
        document.error = str(exc) if isinstance(exc, ValueError) else "Не удалось прочитать файл. Возможно, он повреждён или не соответствует расширению."
    session.add(document)
    session.commit()
    session.refresh(document)
    return document
