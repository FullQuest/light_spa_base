from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
import json
import logging
from threading import Lock
from urllib.error import HTTPError, URLError
from urllib.request import Request, HTTPRedirectHandler, build_opener
from fastapi import HTTPException
from sqlmodel import Session, select
from core.db import engine
from .models import Source, SourceWrite, SourceSchedule
from .schedule import next_poll_time

logger = logging.getLogger(__name__)
REQUEST_TIMEOUT = 5
MAX_RESPONSE_BYTES = 5 * 1024 * 1024
_busy: set[str] = set()
_lock = Lock()


def now_utc() -> datetime:
    # SQLite возвращает datetime без timezone; все значения здесь — UTC.
    return datetime.now(timezone.utc).replace(tzinfo=None)


@contextmanager
def source_lock(source_id: str):
    with _lock:
        if source_id in _busy:
            raise HTTPException(status_code=409, detail="Источник уже обрабатывается. Повторите после завершения опроса.")
        _busy.add(source_id)
    try:
        yield
    finally:
        with _lock:
            _busy.discard(source_id)


def get_source(session: Session, source_id: str) -> Source:
    source = session.get(Source, source_id)
    if source is None:
        raise HTTPException(status_code=404, detail="Источник не найден")
    return source


def public_source(session: Session, source: Source) -> dict:
    schedule = session.get(SourceSchedule, source.id)
    return {**source.model_dump(exclude={"token"}), "has_token": bool(source.token),
            "schedule_mode": "calendar" if schedule else "interval",
            "schedule_time": schedule.time if schedule else "09:00",
            "weekdays": schedule.weekdays if schedule else list(range(7))}


def apply_settings(session: Session, source: Source, data: SourceWrite):
    token = (data.token or source.token) if data.auth_type == "bearer" else ""
    if data.auth_type == "bearer" and not token:
        raise HTTPException(status_code=422, detail="Укажите Bearer-токен")
    source.name = data.name
    source.url = str(data.url)
    source.auth_type = data.auth_type
    source.token = token
    source.interval_seconds = data.interval_seconds
    source.enabled = data.enabled
    schedule = session.get(SourceSchedule, source.id)
    if data.schedule_mode == "calendar":
        schedule = schedule or SourceSchedule(source_id=source.id, time=data.schedule_time, weekdays=data.weekdays)
        schedule.time, schedule.weekdays = data.schedule_time, data.weekdays
        session.add(schedule)
    elif schedule:
        session.delete(schedule)
        schedule = None
    source.next_poll_at = next_poll_time(source, schedule, now_utc())


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def redact(value, token: str):
    if not token:
        return value
    if isinstance(value, str):
        return value.replace(token, "[скрыто]")
    if isinstance(value, list):
        return [redact(item, token) for item in value]
    if isinstance(value, dict):
        return {redact(key, token): redact(item, token) for key, item in value.items()}
    return value


def invalid_constant(value):
    raise ValueError("Ответ содержит недопустимое JSON-значение")


def poll_source(source_id: str, *, scheduled: bool = False) -> dict | None:
    with source_lock(source_id), Session(engine) as session:
        source = get_source(session, source_id)
        if scheduled and (not source.enabled or (source.next_poll_at and source.next_poll_at > now_utc())):
            return None
        url, token = source.url, source.token
        source.last_attempt_at = now_utc()
        schedule = session.get(SourceSchedule, source.id)
        source.next_poll_at = next_poll_time(source, schedule, now_utc())
        session.add(source)
        session.commit()
        headers = {"Accept": "application/json"}
        if token:
            headers["Authorization"] = f"Bearer {token}"
        try:
            with build_opener(NoRedirect()).open(Request(url, headers=headers), timeout=REQUEST_TIMEOUT) as response:
                body = response.read(MAX_RESPONSE_BYTES + 1)
            if len(body) > MAX_RESPONSE_BYTES:
                raise ValueError("Ответ больше 5 МиБ")
            payload = json.loads(body, parse_constant=invalid_constant)
            json.dumps(payload, allow_nan=False)
            source.payload = redact(payload, token)
            source.last_success_at = now_utc()
            source.status, source.error = "success", None
        except HTTPError as exc:
            source.status, source.error = "error", f"API вернул HTTP {exc.code}. Проверьте адрес и авторизацию."
            exc.close()
        except (TimeoutError, URLError):
            source.status, source.error = "error", "API недоступен или не ответил за 5 секунд."
        except (ValueError, UnicodeError, RecursionError):
            source.status, source.error = "error", "Ответ не является корректным JSON или превышает 5 МиБ."
        except Exception:
            # Не записываем URL, токен и текст удалённого ответа в ошибку.
            logger.error("Unexpected polling failure for source %s", source_id)
            source.status, source.error = "error", "Не удалось обработать ответ API."
        source.next_poll_at = next_poll_time(source, schedule, now_utc())
        session.add(source)
        session.commit()
        session.refresh(source)
        return public_source(session, source)


def poll_due_sources(stop):
    while not stop.is_set():
        try:
            with Session(engine) as session:
                ids = session.exec(select(Source.id).where(Source.enabled, Source.next_poll_at <= now_utc())).all()
            for source_id in ids:
                if stop.is_set():
                    break
                try:
                    poll_source(source_id, scheduled=True)
                except HTTPException:
                    pass  # Ручной опрос/редактирование уже заняли источник или он удалён.
        except Exception:
            logger.error("Source scheduler iteration failed")
        stop.wait(1)
