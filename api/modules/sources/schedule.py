from datetime import datetime, timedelta
from .models import Source, SourceSchedule


def next_poll_time(source: Source, schedule: SourceSchedule | None, now: datetime) -> datetime | None:
    if not source.enabled:
        return None
    if schedule is None:
        return now + timedelta(seconds=source.interval_seconds)
    local = now + timedelta(hours=3)  # Московское время (UTC+3).
    hour, minute = map(int, schedule.time.split(":"))
    for days in range(8):
        candidate = (local + timedelta(days=days)).replace(hour=hour, minute=minute, second=0, microsecond=0)
        if candidate.weekday() in schedule.weekdays and candidate > local:
            return candidate - timedelta(hours=3)
    raise ValueError("Не задан день расписания")


