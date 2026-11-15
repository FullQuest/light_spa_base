import asyncio
from contextlib import asynccontextmanager
from threading import Event, Thread
from .service import poll_due_sources, REQUEST_TIMEOUT


@asynccontextmanager
async def sources_lifespan(app):
    stop = Event()
    worker = Thread(target=poll_due_sources, args=(stop,), daemon=True, name="source-poller")
    worker.start()
    try:
        yield
    finally:
        stop.set()
        await asyncio.to_thread(worker.join, REQUEST_TIMEOUT + 2)
