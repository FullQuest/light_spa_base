"""Запуск в контейнере API: python -m unittest discover -s tests -v.

Тесты запускают отдельный процесс API с временной SQLite-базой.
Рабочая база приложения и её аккаунты не изменяются.
"""
import json
from concurrent.futures import ThreadPoolExecutor
import os
from pathlib import Path
import socket
import sqlite3
import subprocess
import sys
import tempfile
import time
import unittest
import jwt
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen


class ApiTestCase(unittest.TestCase):
    registration_enabled = "true"

    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory()
        cls.addClassCleanup(cls.temp.cleanup)
        cls.db = Path(cls.temp.name) / "test.sqlite3"
        with socket.socket() as sock:
            sock.bind(("127.0.0.1", 0))
            port = sock.getsockname()[1]
        cls.base = f"http://127.0.0.1:{port}"
        env = {**os.environ, "DATABASE_URL": f"sqlite:///{cls.db.as_posix()}",
               "SECRET_KEY": "isolated-auth-test-key-at-least-32-bytes",
               "ADMIN_LOGIN": "admin1", "ADMIN_PASSWORD": "12345678",
               "REGISTRATION_ENABLED": cls.registration_enabled}
        cls.process = subprocess.Popen(
            [sys.executable, "-m", "uvicorn", "main:app", "--host", "127.0.0.1", "--port", str(port)],
            cwd=Path(__file__).resolve().parents[1], env=env,
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        )
        cls.addClassCleanup(cls.stop_server)
        for _ in range(100):
            try:
                with urlopen(cls.base + "/openapi.json", timeout=1):
                    return
            except (URLError, TimeoutError):
                if cls.process.poll() is not None:
                    raise RuntimeError("Test API failed to start")
                time.sleep(0.1)
        raise RuntimeError("Test API startup timed out")

    @classmethod
    def stop_server(cls):
        cls.process.terminate()
        try:
            cls.process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            cls.process.kill()
            cls.process.wait()

    def request(self, path, data=None, *, form=False, token=None, method=None):
        headers = {}
        body = None
        if data is not None:
            body = (urlencode(data) if form else json.dumps(data)).encode()
            headers["Content-Type"] = "application/x-www-form-urlencoded" if form else "application/json"
        if token:
            headers["Authorization"] = f"Bearer {token}"
        try:
            response = urlopen(Request(self.base + path, body, headers, method=method), timeout=5)
        except HTTPError as error:
            response = error
        with response:
            return response.status, (None if response.status == 204 else json.load(response)), response.headers

    def register(self, email):
        return self.request("/api/auth/register", {"email": email, "password": "test-password"})

    def login(self, email, password="test-password"):
        return self.request("/api/auth/login", {"username": email, "password": password}, form=True)

class AuthTests(ApiTestCase):
    def test_public_registration_config(self):
        status, config, _ = self.request("/api/auth/config")
        self.assertEqual(status, 200)
        self.assertEqual(config, {"registration_enabled": True})

    def test_registration_login_and_profile(self):
        status, user, _ = self.register("flow@example.com")
        self.assertEqual(status, 200)
        self.assertNotIn("hashed_password", user)
        status, token, _ = self.login("flow@example.com")
        self.assertEqual(status, 200)
        status, profile, _ = self.request("/api/auth/me", token=token["access_token"])
        self.assertEqual(status, 200)
        self.assertEqual(profile["id"], user["id"])
        self.assertEqual(self.register("flow@example.com")[0], 409)

    def test_wrong_credentials_and_inactive_account(self):
        self.register("inactive@example.com")
        for email, password in [("missing@example.com", "test-password"), ("inactive@example.com", "wrong")]:
            status, result, headers = self.login(email, password)
            self.assertEqual(status, 401)
            self.assertEqual(headers["WWW-Authenticate"], "Bearer")
            self.assertNotIn("access_token", result)
        _, token, _ = self.login("inactive@example.com")
        with sqlite3.connect(self.db) as connection:
            connection.execute('UPDATE user SET is_active = 0 WHERE email = ?', ("inactive@example.com",))
        self.assertEqual(self.login("inactive@example.com")[0], 401)
        self.assertEqual(self.request("/api/auth/me", token=token["access_token"])[0], 401)

    def test_validation_and_missing_token(self):
        for email, password in [("broken", "test-password"), ("valid@example.com", "short"),
                                ("valid@example.com", "x" * 129)]:
            self.assertEqual(self.request("/api/auth/register", {"email": email, "password": password})[0], 422)
        self.assertEqual(self.request("/api/auth/me")[0], 401)
        self.assertEqual(self.request("/api/auth/me", token="invalid")[0], 401)

    def test_email_whitespace_and_openapi(self):
        self.assertEqual(self.register("  spaces@example.com  ")[0], 200)
        self.assertEqual(self.login(" spaces@example.com ")[0], 200)
        _, schema, _ = self.request("/openapi.json")
        self.assertIn("/api/auth/login", schema["paths"])
        self.assertEqual(schema["components"]["securitySchemes"]["OAuth2PasswordBearer"]["flows"]["password"]["tokenUrl"], "/api/auth/login")

    def test_concurrent_registration(self):
        with ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(self.register, ["race@example.com"] * 2))
        self.assertEqual(sorted(result[0] for result in results), [200, 409])

    def test_invalid_subject_and_disabled_module(self):
        token = jwt.encode({"sub": None}, "isolated-auth-test-key-at-least-32-bytes", algorithm="HS256")
        self.assertEqual(self.request("/api/auth/me", token=token)[0], 401)
        self.assertEqual(self.request("/api/tasks")[0], 404)

    def test_roles_and_administration(self):
        _, admin_token, _ = self.login("admin1", "12345678")
        admin_token = admin_token["access_token"]
        _, admin, _ = self.request("/api/auth/me", token=admin_token)
        self.assertEqual(admin["role"], "superadmin")
        _, employee, _ = self.request("/api/auth/register", {
            "email": "roles@example.com", "password": "test-password", "role": "superadmin",
        })
        self.assertEqual(employee["role"], "user")
        _, employee_token, _ = self.login(employee["email"])
        employee_token = employee_token["access_token"]

        def change(user_id, role, active=True, token=admin_token):
            return self.request(f"/api/users/{user_id}", {"role": role, "is_active": active},
                                token=token, method="PATCH")

        self.assertEqual(self.request("/api/users")[0], 401)
        self.assertEqual(self.request("/api/users", token=employee_token)[0], 403)
        self.assertEqual(change(employee["id"], "superadmin", token=employee_token)[0], 403)
        self.assertEqual(change(employee["id"], "unknown")[0], 422)
        self.assertEqual(change(999999, "user")[0], 404)
        self.assertEqual(change(admin["id"], "user")[0], 403)
        self.assertEqual(change(admin["id"], "superadmin", False)[0], 403)
        self.assertEqual(change(employee["id"], "admin")[0], 200)
        self.assertEqual(self.request("/api/users", token=employee_token)[0], 403)
        self.assertEqual(change(employee["id"], "superadmin")[0], 200)
        status, users, _ = self.request("/api/users", token=employee_token)
        self.assertEqual(status, 200)
        self.assertTrue(all("hashed_password" not in item for item in users))
        # Уже выданный токен теряет права сразу после понижения роли или блокировки.
        self.assertEqual(change(employee["id"], "user")[0], 200)
        self.assertEqual(self.request("/api/users", token=employee_token)[0], 403)
        self.assertEqual(change(employee["id"], "user", False)[0], 200)
        self.assertEqual(self.request("/api/auth/me", token=employee_token)[0], 401)
        self.assertEqual(self.login(employee["email"])[0], 401)
        self.assertEqual(change(employee["id"], "user", True)[0], 200)
        self.assertEqual(self.login(employee["email"])[0], 200)

    def test_admin_creates_accounts(self):
        _, token, _ = self.login("admin1", "12345678")
        token = token["access_token"]
        for role in ["user", "admin", "superadmin"]:
            data = {"email": f"created-{role}@example.com", "password": "test-password",
                    "full_name": "Created account", "role": role, "is_active": True}
            status, account, _ = self.request("/api/users", data, token=token)
            self.assertEqual(status, 201)
            self.assertEqual(account["role"], role)
            self.assertNotIn("hashed_password", account)
            self.assertNotIn("password", account)
            self.assertEqual(self.login(data["email"])[0], 200)
            self.assertEqual(self.request("/api/users", data, token=token)[0], 409)
        _, employee_token, _ = self.login("created-user@example.com")
        self.assertEqual(self.request("/api/users", data, token=employee_token["access_token"])[0], 403)
        _, other_admin_token, _ = self.login("created-admin@example.com")
        self.assertEqual(self.request("/api/users", data, token=other_admin_token["access_token"])[0], 403)
        self.assertEqual(self.request("/api/users", data)[0], 401)
        for field, value in [("email", "broken"), ("password", "short"), ("role", "invalid")]:
            self.assertEqual(self.request("/api/users", {**data, field: value}, token=token)[0], 422)
        data = {"email": "created-inactive@example.com", "password": "test-password", "is_active": False}
        status, account, _ = self.request("/api/users", data, token=token)
        self.assertEqual(status, 201)
        self.assertEqual(account["role"], "user")
        self.assertFalse(account["is_active"])
        self.assertEqual(self.login(data["email"])[0], 401)


    def test_custom_roles_and_live_permissions(self):
        _, result, _ = self.login("admin1", "12345678")
        root = result["access_token"]
        def write(path, data, method="POST", token=root):
            return self.request(path, data, method=method, token=token)
        status, role, _ = write("/api/roles", {"name": "Operator", "permissions": []})
        self.assertEqual(status, 201)
        role_id = role["id"]
        status, account, _ = write("/api/users", {
            "email": "operator@example.com", "password": "test-password", "role": role_id})
        self.assertEqual(status, 201)
        _, result, _ = self.login(account["email"])
        token = result["access_token"]
        self.assertEqual(self.request("/api/users", token=token)[0], 403)
        self.assertEqual(write(f"/api/roles/{role_id}", {"name": "Operator", "permissions": ["users.manage"]}, "PATCH")[0], 200)
        self.assertEqual(self.request("/api/users", token=token)[0], 200)
        _, me, _ = self.request("/api/auth/me", token=token)
        self.assertEqual(me["permissions"], ["users.manage"])
        self.assertEqual(me["role_name"], "Operator")
        self.assertEqual(write("/api/roles", {"name": "Forbidden"}, token=token)[0], 403)
        self.assertEqual(write("/api/users", {"email": "escalate@example.com", "password": "test-password", "role": "superadmin"}, token=token)[0], 403)
        self.assertEqual(write(f"/api/users/{account['id']}", {"role": "superadmin", "is_active": True}, "PATCH", token)[0], 403)
        _, root_user, _ = self.request("/api/auth/me", token=root)
        self.assertEqual(write(f"/api/users/{root_user['id']}", {"role": role_id, "is_active": True}, "PATCH", token)[0], 403)
        self.assertEqual(write(f"/api/roles/{role_id}", None, "DELETE")[0], 409)
        self.assertEqual(write(f"/api/roles/{role_id}", {"name": "Operator", "permissions": []}, "PATCH")[0], 200)
        self.assertEqual(self.request("/api/users", token=token)[0], 403)
        self.assertEqual(write(f"/api/users/{account['id']}", {"role": "user", "is_active": True}, "PATCH")[0], 200)
        self.assertEqual(write(f"/api/roles/{role_id}", None, "DELETE")[0], 204)
        self.assertEqual(write(f"/api/users/{account['id']}", {"role": role_id, "is_active": True}, "PATCH")[0], 422)

    def test_system_roles_and_permission_validation(self):
        _, result, _ = self.login("admin1", "12345678")
        token = result["access_token"]
        for role in ["user", "superadmin"]:
            self.assertEqual(self.request(f"/api/roles/{role}", token=token, method="DELETE")[0], 403)
        self.assertEqual(self.request("/api/roles/superadmin", {"name": "Changed", "permissions": []}, token=token, method="PATCH")[0], 403)
        for data in [{"name": "   "}, {"name": "Unknown", "permissions": ["unknown"]}]:
            self.assertEqual(self.request("/api/roles", data, token=token)[0], 422)
        self.assertEqual(self.request("/api/roles")[0], 401)
        self.assertEqual(self.request("/api/roles/user", {"name": "Employee", "permissions": []}, token=token, method="PATCH")[0], 200)

class RegistrationDisabledTests(ApiTestCase):
    registration_enabled = "false"

    def test_registration_disabled_but_admin_can_create_accounts(self):
        status, config, _ = self.request("/api/auth/config")
        self.assertEqual(status, 200)
        self.assertEqual(config, {"registration_enabled": False})
        self.assertEqual(self.register("blocked@example.com")[0], 403)
        with sqlite3.connect(self.db) as connection:
            self.assertEqual(connection.execute("SELECT count(*) FROM user WHERE email='blocked@example.com'").fetchone()[0], 0)
        status, result, _ = self.login("admin1", "12345678")
        self.assertEqual(status, 200)
        status, account, _ = self.request("/api/users", {
            "email": "invited@example.com", "password": "test-password",
        }, token=result["access_token"])
        self.assertEqual(status, 201)
        self.assertEqual(account["role"], "user")
        self.assertEqual(self.login("invited@example.com")[0], 200)


if __name__ == "__main__":
    unittest.main()
