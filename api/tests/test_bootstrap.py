from contextlib import closing
import os
from pathlib import Path
import sqlite3
import subprocess
import sys
import tempfile
import unittest


class BootstrapTests(unittest.TestCase):
    def initialize(self, database, **config):
        env = {**os.environ, "DATABASE_URL": f"sqlite:///{database.as_posix()}",
               "SECRET_KEY": "isolated-bootstrap-test-key-at-least-32-bytes",
               "ADMIN_LOGIN": "admin1", "ADMIN_PASSWORD": "12345678", **config}
        subprocess.run(
            [sys.executable, "-c", "import main"],
            cwd=Path(__file__).resolve().parents[1], env=env, check=True, capture_output=True,
        )

    def test_initial_superadmin_and_restart(self):
        with tempfile.TemporaryDirectory() as folder:
            database = Path(folder) / "test.sqlite3"
            self.initialize(database)
            with closing(sqlite3.connect(database)) as connection, connection:
                role, password = connection.execute("SELECT role, hashed_password FROM user WHERE email='admin1'").fetchone()
                self.assertEqual(role, "superadmin")
                self.assertTrue(password.startswith("$argon2"))
                connection.execute("UPDATE user SET role='user', is_active=0, hashed_password='changed' WHERE email='admin1'")
            self.initialize(database)
            with closing(sqlite3.connect(database)) as connection, connection:
                self.assertEqual(connection.execute("SELECT role, is_active, hashed_password FROM user WHERE email='admin1'").fetchone(),
                                 ("user", 0, "changed"))
                self.assertEqual(connection.execute("SELECT count(*) FROM user").fetchone()[0], 1)

    def test_bootstrap_can_be_disabled(self):
        with tempfile.TemporaryDirectory() as folder:
            database = Path(folder) / "empty.sqlite3"
            self.initialize(database, ADMIN_LOGIN="", ADMIN_PASSWORD="")
            with closing(sqlite3.connect(database)) as connection, connection:
                self.assertEqual(connection.execute("SELECT count(*) FROM user").fetchone()[0], 0)

    def test_role_permissions_survive_restart(self):
        with tempfile.TemporaryDirectory() as folder:
            database = Path(folder) / "roles.sqlite3"
            self.initialize(database)
            with closing(sqlite3.connect(database)) as connection, connection:
                connection.execute("UPDATE role SET name='Custom employee', permissions=? WHERE id='user'", ('["users.manage"]',))
                connection.execute("INSERT INTO role (id, name, permissions) VALUES ('custom', 'Custom role', '[]')")
            self.initialize(database)
            with closing(sqlite3.connect(database)) as connection, connection:
                self.assertEqual(connection.execute("SELECT name, permissions FROM role WHERE id='user'").fetchone(),
                                 ('Custom employee', '["users.manage"]'))
                self.assertEqual(connection.execute("SELECT count(*) FROM role WHERE id='custom'").fetchone()[0], 1)

    def test_deleted_optional_role_stays_deleted_after_restart(self):
        with tempfile.TemporaryDirectory() as folder:
            database = Path(folder) / "deleted-role.sqlite3"
            self.initialize(database)
            with closing(sqlite3.connect(database)) as connection, connection:
                self.assertIsNotNone(connection.execute("SELECT id FROM role WHERE id='admin'").fetchone())
                connection.execute("DELETE FROM role WHERE id='admin'")
            self.initialize(database)
            with closing(sqlite3.connect(database)) as connection, connection:
                self.assertIsNone(connection.execute("SELECT id FROM role WHERE id='admin'").fetchone())
                self.assertEqual(connection.execute("SELECT count(*) FROM role WHERE id IN ('user','superadmin')").fetchone()[0], 2)
