"""Поиск строк по доступным документам без отдельного индекса."""
import re
from datetime import datetime
from typing import Annotated
from fastapi import APIRouter, Depends, Query
from sqlmodel import Session, SQLModel, select
from core.db import get_session
from modules.users.dependencies import require_permission
from modules.users.models import User
from modules.documents.models import Document
from modules.documents.service import can_view, document_data

router = APIRouter(prefix="/search", tags=["search"])


class SearchResult(SQLModel):
    id: str
    original_name: str
    format: str
    uploaded_by_name: str
    uploaded_at: datetime
    status: str
    snippet: str


def make_snippet(text: str, terms: list[str]) -> str:
    text = " ".join(text.split())
    if not text:
        return ""
    match = re.search("|".join(re.escape(term) for term in terms), text, re.IGNORECASE)
    start = max(0, match.start() - 80) if match else 0
    end = min(len(text), start + 280)
    return ("…" if start else "") + text[start:end] + ("…" if end < len(text) else "")


@router.get("", response_model=list[SearchResult])
def search_documents(user: Annotated[User, Depends(require_permission("documents.view"))],
                     session: Annotated[Session, Depends(get_session)],
                     q: Annotated[str, Query(max_length=200)] = ""):
    terms = list(dict.fromkeys(q.casefold().split()))
    if not terms:
        return []
    results = []
    for document in session.exec(select(Document)).all():
        if not can_view(document, user):
            continue
        title = document.original_name.casefold()
        content = (document.original_name + "\n" + document.text).casefold()
        if not all(term in content for term in terms):
            continue
        title_matches = sum(term in title for term in terms)
        result = SearchResult(**document_data(session, document), snippet=make_snippet(document.text, terms))
        results.append((title_matches, document.uploaded_at, document.id, result))
    results.sort(key=lambda item: item[:3], reverse=True)
    return [item[3] for item in results]
