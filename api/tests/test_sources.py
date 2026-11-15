from concurrent.futures import ThreadPoolExecutor
from http.server import ThreadingHTTPServer
import json
from threading import Thread
import time
from source_fixture import FixtureHandler
from test_auth import ApiTestCase


class SourceTests(ApiTestCase):
    request_timeout = 15

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.fixture = ThreadingHTTPServer(("127.0.0.1", 0), FixtureHandler)
        cls.fixture.daemon_threads = True
        cls.fixture_url = f"http://127.0.0.1:{cls.fixture.server_port}"
        cls.fixture_thread = Thread(target=cls.fixture.serve_forever, daemon=True)
        cls.fixture_thread.start()
        cls.addClassCleanup(cls.close_fixture)

    @classmethod
    def close_fixture(cls):
        cls.fixture.shutdown()
        cls.fixture.server_close()
        cls.fixture_thread.join(timeout=2)

    def root(self):
        return self.login("admin1", "12345678")[1]["access_token"]

    def create(self, path="/ok", **changes):
        data = {"name": "Test source", "url": self.fixture_url + path, "enabled": False, **changes}
        status, result, _ = self.request("/api/sources", data, token=self.root())
        self.assertEqual(status, 201, result)
        return result

    def poll(self, source_id, token=None):
        return self.request(f"/api/sources/{source_id}/poll", token=token or self.root(), method="POST")

    def update(self, source, **changes):
        data = {"name": source["name"], "url": source["url"], "enabled": source["enabled"],
                "interval_seconds": source["interval_seconds"], "auth_type": source["auth_type"], **changes}
        status, result, _ = self.request(f"/api/sources/{source['id']}", data, token=self.root(), method="PUT")
        self.assertEqual(status, 200, result)
        return result

    def test_manual_auth_and_token_visibility(self):
        source = self.create("/auth", auth_type="bearer", token="fixture-token")
        self.assertTrue(source["has_token"])
        self.assertNotIn("token", source)
        self.assertEqual(self.poll(source["id"])[1]["status"], "success")
        source = self.update(source, name="Renamed source", token="")
        self.assertEqual(self.poll(source["id"])[1]["status"], "success")
        source = self.update(source, url=self.fixture_url + "/auth-new", token="fixture-token-new")
        self.assertEqual(self.poll(source["id"])[1]["status"], "success")
        source = self.update(source, url=self.fixture_url + "/echo")
        detail = self.poll(source["id"])[1]
        self.assertEqual(detail["payload"]["authorization"], "Bearer [скрыто]")
        self.assertNotIn("fixture-token-new", json.dumps(detail))
        _, listing, _ = self.request("/api/sources", token=self.root())
        self.assertNotIn("token", listing[0])
        self.assertNotIn("url", listing[0])
        source = self.update(source, auth_type="none")
        self.assertFalse(source["has_token"])

    def test_failures_preserve_last_success_and_json_null_is_valid(self):
        source = self.create()
        successful = self.poll(source["id"])[1]
        for path in ["/error", "/invalid", "/timeout", "/redirect"]:
            source = self.update(source, url=self.fixture_url + path)
            status, failed, _ = self.poll(source["id"])
            self.assertEqual(status, 200)
            self.assertEqual(failed["status"], "error")
            self.assertTrue(failed["error"])
            self.assertEqual(failed["payload"], successful["payload"])
            self.assertEqual(failed["last_success_at"], successful["last_success_at"])
        source = self.update(source, url=self.fixture_url + "/null")
        detail = self.poll(source["id"])[1]
        self.assertEqual(detail["status"], "success")
        self.assertIsNone(detail["payload"])
        self.assertTrue(detail["last_success_at"])
        self.assertIsNone(detail["error"])

    def test_timer_pause_and_manual_while_paused(self):
        source = self.create("/scheduled", enabled=True, interval_seconds=1)
        path = f"/api/sources/{source['id']}"
        deadline = time.monotonic() + 8
        while time.monotonic() < deadline:
            detail = self.request(path, token=self.root())[1]
            if detail["last_success_at"]:
                break
            time.sleep(0.1)
        else:
            self.fail("Scheduler did not fetch the source")
        source = self.update(source, enabled=False)
        self.assertIsNone(source["next_poll_at"])
        before = self.request(path, token=self.root())[1]["payload"]
        time.sleep(1.5)
        self.assertEqual(self.request(path, token=self.root())[1]["payload"], before)
        after = self.poll(source["id"])[1]
        self.assertGreater(after["payload"]["value"], before["value"])
        self.assertIsNone(after["next_poll_at"])

    def test_no_overlap_or_settings_change_during_poll(self):
        source = self.create("/slow")
        FixtureHandler.slow_started.clear()
        token = self.root()
        with ThreadPoolExecutor(max_workers=1) as pool:
            future = pool.submit(self.poll, source["id"], token)
            self.assertTrue(FixtureHandler.slow_started.wait(3))
            self.assertEqual(self.poll(source["id"], token)[0], 409)
            path = f"/api/sources/{source['id']}"
            self.assertEqual(self.request(path, token=token, method="DELETE")[0], 409)
            self.assertEqual(self.request(path, {"name": "Changed", "url": self.fixture_url + "/ok"}, token=token, method="PUT")[0], 409)
            self.assertEqual(future.result()[1]["status"], "success")

    def test_permissions_validation_and_deletion(self):
        token = self.root()
        source = self.create()
        path = f"/api/sources/{source['id']}"
        self.assertEqual(self.request("/api/sources")[0], 401)
        _, role, _ = self.request("/api/roles", {"name": "Source reader", "permissions": ["sources.view"]}, token=token)
        _, user, _ = self.request("/api/users", {"email": "source-reader@example.com", "password": "test-password", "role": role["id"]}, token=token)
        reader = self.login(user["email"])[1]["access_token"]
        self.assertEqual(self.request(path, token=reader)[0], 200)
        self.assertNotIn("url", self.request(path, token=reader)[1])
        self.assertEqual(self.request(path + "/settings", token=reader)[0], 403)
        self.assertEqual(self.poll(source["id"], reader)[0], 403)
        self.assertEqual(self.request(path, token=reader, method="DELETE")[0], 403)
        self.assertEqual(self.request(path, {"name": "Changed", "url": self.fixture_url}, token=reader, method="PUT")[0], 403)
        for data in [{"name": " ", "url": self.fixture_url}, {"name": "Bad", "url": "file:///etc/passwd"},
                     {"name": "Bad", "url": "http://user:password@example.com"},
                     {"name": "Bad", "url": self.fixture_url, "auth_type": "bearer"},
                     {"name": "Bad", "url": self.fixture_url, "interval_seconds": 0}]:
            self.assertEqual(self.request("/api/sources", data, token=token)[0], 422)
        self.assertEqual(self.request(path, token=token, method="DELETE")[0], 204)
        self.assertEqual(self.request(path, token=token)[0], 404)

    def test_calendar_poll_switch_and_cleanup(self):
        from contextlib import closing
        from datetime import datetime, timezone
        import sqlite3
        source = self.create("/calendar", enabled=True, schedule_mode="calendar", schedule_time="09:15", weekdays=[0,1,2,3,4,5,6])
        self.assertEqual(source["schedule_mode"], "calendar")
        self.assertEqual(source["schedule_time"], "09:15")
        with closing(sqlite3.connect(self.db)) as connection, connection:
            connection.execute("UPDATE source SET next_poll_at='2000-01-01' WHERE id=?", (source["id"],))
        deadline = time.monotonic() + 8
        while time.monotonic() < deadline:
            detail = self.request(f"/api/sources/{source['id']}", token=self.root())[1]
            if detail["last_success_at"]:
                break
            time.sleep(0.1)
        else:
            self.fail("Calendar poll did not run")
        self.assertEqual(detail["payload"]["path"], "/calendar")
        self.assertEqual(datetime.fromisoformat(detail["next_poll_at"]).hour, 6)
        self.assertGreater(datetime.fromisoformat(detail["next_poll_at"]), datetime.now(timezone.utc).replace(tzinfo=None))
        source = self.update(source, enabled=False, schedule_mode="calendar", schedule_time="09:15", weekdays=[0,1,2,3,4,5,6])
        self.assertIsNone(source["next_poll_at"])
        self.assertEqual(self.poll(source["id"])[1]["schedule_mode"], "calendar")
        source = self.update(source, enabled=False, schedule_mode="interval")
        self.assertEqual(source["schedule_mode"], "interval")
        with closing(sqlite3.connect(self.db)) as connection:
            self.assertEqual(connection.execute("SELECT count(*) FROM sourceschedule WHERE source_id=?", (source["id"],)).fetchone()[0], 0)
        source = self.update(source, enabled=False, schedule_mode="calendar", schedule_time="12:00", weekdays=[0])
        self.assertEqual(self.request(f"/api/sources/{source['id']}", token=self.root(), method="DELETE")[0], 204)
        with closing(sqlite3.connect(self.db)) as connection:
            self.assertEqual(connection.execute("SELECT count(*) FROM sourceschedule WHERE source_id=?", (source["id"],)).fetchone()[0], 0)
