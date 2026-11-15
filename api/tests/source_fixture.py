"""Локальный JSON API для тестов источников. Запуск: python tests/source_fixture.py."""
import argparse
import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from threading import Event, Lock
import time
from urllib.parse import urlsplit


class FixtureHandler(BaseHTTPRequestHandler):
    counts = {}
    lock = Lock()
    slow_started = Event()

    def log_message(self, *args):
        pass

    def do_GET(self):
        path = urlsplit(self.path).path
        if path == "/stats":
            with self.lock:
                data = dict(self.counts)
            return self.reply(200, json.dumps(data).encode())
        with self.lock:
            self.counts[path] = self.counts.get(path, 0) + 1
            count = self.counts[path]
        if path in ("/auth", "/auth-new"):
            expected = "fixture-token-new" if path == "/auth-new" else "fixture-token"
            if self.headers.get("Authorization") != "Bearer " + expected:
                return self.reply(401, b'{"error":"unauthorized"}')
        if path == "/error":
            return self.reply(503, b'{"error":"unavailable"}')
        if path == "/invalid":
            return self.reply(200, b"<html>not JSON</html>")
        if path == "/redirect":
            self.send_response(302)
            self.send_header("Location", "/auth")
            self.end_headers()
            return
        if path in ("/slow", "/timeout"):
            self.slow_started.set()
            time.sleep(6 if path == "/timeout" else 2)
        if path == "/null":
            return self.reply(200, b"null")
        data = {"value": count, "message": "Данные предприятия", "path": path}
        if path == "/echo":
            data["authorization"] = self.headers.get("Authorization")
        self.reply(200, json.dumps(data, ensure_ascii=False).encode())

    def reply(self, status, body):
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        try:
            self.wfile.write(body)
        except (BrokenPipeError, ConnectionResetError):
            pass


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--host", default="0.0.0.0")
    parser.add_argument("--port", type=int, default=9000)
    args = parser.parse_args()
    ThreadingHTTPServer((args.host, args.port), FixtureHandler).serve_forever()
