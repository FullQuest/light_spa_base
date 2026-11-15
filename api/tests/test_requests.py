from urllib.parse import urlencode
from test_auth import ApiTestCase


class RequestTests(ApiTestCase):
    def root(self):
        return self.login("admin1", "12345678")[1]["access_token"]

    def actor(self, name, permissions):
        token = self.root()
        role = self.request("/api/roles", {"name": name, "permissions": permissions}, token=token)[1]
        user = self.request("/api/users", {"email": name + "@example.com", "password": "test-password", "role": role["id"]}, token=token)[1]
        return user, self.login(user["email"])[1]["access_token"]

    def test_crud_validation_and_author_preservation(self):
        token = self.root()
        assignee, _ = self.actor("requests-assignee", ["requests.view"])
        status, item, _ = self.request("/api/requests", {"title": "  Проверить станок  ", "description": "Первая строка\nВторая строка", "assignee_id": assignee["id"], "author_id": assignee["id"]}, token=token)
        self.assertEqual(status, 201)
        self.assertEqual(item["title"], "Проверить станок")
        self.assertNotEqual(item["author_id"], assignee["id"])
        self.assertEqual(item["assignee_name"], assignee["email"])
        path = f"/api/requests/{item['id']}"
        self.assertEqual(self.request(path, token=token)[1]["description"], item["description"])
        for data in [{"title": " "}, {"title": "x" * 201}, {"title": "Valid", "status": "invalid"}, {"title": "Valid", "assignee_id": 999999}]:
            self.assertEqual(self.request("/api/requests", data, token=token)[0], 422)
            self.assertEqual(self.request(path, data, token=token, method="PUT")[0], 422)
        status, updated, _ = self.request(path, {"title": "Исправлено", "description": "Готово", "status": "done", "assignee_id": None, "author_id": assignee["id"]}, token=token, method="PUT")
        self.assertEqual(status, 200)
        self.assertEqual(updated["author_id"], item["author_id"])
        self.assertEqual(updated["created_at"], item["created_at"])
        self.assertGreaterEqual(updated["updated_at"], item["updated_at"])
        self.assertIsNone(updated["assignee_name"])
        self.assertEqual(self.request(path, token=token, method="DELETE")[0], 204)
        self.assertEqual(self.request(path, token=token)[0], 404)
        self.assertEqual(self.request(path, {"title": "Missing"}, token=token, method="PUT")[0], 404)

    def test_search_filters_and_mine(self):
        token = self.root()
        manager, manager_token = self.actor("requests-manager", ["requests.view", "requests.manage"])
        first = self.request("/api/requests", {"title": "filter Первый", "description": "Специальная фраза", "assignee_id": manager["id"]}, token=token)[1]
        second = self.request("/api/requests", {"title": "filter Второй", "status": "in_progress"}, token=manager_token)[1]
        def ids(**params):
            status, items, _ = self.request("/api/requests?" + urlencode({"q": "filter", **params}), token=manager_token)
            self.assertEqual(status, 200)
            return [item["id"] for item in items]
        self.assertEqual(ids(), [second["id"], first["id"]])
        self.assertEqual(ids(q="СПЕЦИАЛЬНАЯ"), [first["id"]])
        self.assertEqual(ids(status="new"), [first["id"]])
        self.assertEqual(ids(assignee_id=manager["id"]), [first["id"]])
        self.assertEqual(ids(mine="true"), [second["id"]])
        self.assertEqual(ids(mine="true", status="new"), [])
        self.assertEqual(self.request(f"/api/requests/{first['id']}", {"title": "Другой управляющий", "status": "done"}, token=manager_token, method="PUT")[0], 200)

    def test_permissions_and_assignee_directory(self):
        token = self.root()
        item = self.request("/api/requests", {"title": "Readonly check"}, token=token)[1]
        path = f"/api/requests/{item['id']}"
        user, reader = self.actor("requests-reader", ["requests.view"])
        _, denied = self.actor("requests-denied", [])
        _, manage_only = self.actor("requests-manage-only", ["requests.manage"])
        for url in ["/api/requests", path, "/api/requests/assignees"]:
            self.assertEqual(self.request(url)[0], 401)
            self.assertEqual(self.request(url, token=reader)[0], 200)
            self.assertEqual(self.request(url, token=denied)[0], 403)
        for actor in [reader, denied, manage_only]:
            self.assertEqual(self.request("/api/requests", {"title": "Forbidden"}, token=actor)[0], 403)
            self.assertEqual(self.request(path, {"title": "Forbidden"}, token=actor, method="PUT")[0], 403)
            self.assertEqual(self.request(path, token=actor, method="DELETE")[0], 403)
        directory = self.request("/api/requests/assignees", token=reader)[1]
        self.assertTrue(any(person["id"] == user["id"] for person in directory))
        self.assertTrue(all(set(person) == {"id", "name", "is_active"} for person in directory))
