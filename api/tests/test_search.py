import json
from urllib.parse import urlencode
from urllib.request import Request, urlopen
from test_auth import ApiTestCase


class SearchTests(ApiTestCase):
    def root_token(self):
        return self.login("admin1", "12345678")[1]["access_token"]

    def upload(self, name, text, token, mode="all"):
        boundary = "search-test-boundary"
        body = (f'--{boundary}\r\nContent-Disposition: form-data; name="access_mode"\r\n\r\n{mode}\r\n'
                f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="{name}"\r\n'
                'Content-Type: application/octet-stream\r\n\r\n').encode() + text.encode() + f"\r\n--{boundary}--\r\n".encode()
        with urlopen(Request(self.base + "/api/documents", body, {
            "Authorization": f"Bearer {token}", "Content-Type": f"multipart/form-data; boundary={boundary}",
        }), timeout=10) as response:
            return json.load(response)

    def search(self, query, token):
        return self.request("/api/search?" + urlencode({"q": query}), token=token)

    def test_search_title_body_tables_ranking_and_snippets(self):
        token = self.root_token()
        title = self.upload("охрана труда.txt", "Памятка для работников.", token)
        body = self.upload("памятка.txt", "вступление " * 100 + "ОХРАНА сотрудников: правила труда.", token)
        table = self.upload("таблица.csv", "Раздел;Тема\nБезопасность;охрана труда", token)
        excluded = self.upload("неполное.txt", "охрана", token)
        status, results, _ = self.search("  ОХРАНА    труда ", token)
        self.assertEqual(status, 200)
        self.assertEqual(results[0]["id"], title["id"])
        self.assertEqual({item["id"] for item in results}, {title["id"], body["id"], table["id"]})
        fragment = next(item["snippet"] for item in results if item["id"] == body["id"])
        self.assertIn("ОХРАНА", fragment)
        self.assertTrue(fragment.startswith("…"))
        self.assertLessEqual(len(fragment), 282)
        self.assertTrue(all("text" not in item and "allowed_user_ids" not in item for item in results))
        self.assertNotIn(excluded["id"], {item["id"] for item in results})
        for query in ["", "   ", "несуществующийпоисковыйзапрос"]:
            self.assertEqual(self.search(query, token)[1], [])
        self.assertEqual(self.search("x" * 201, token)[0], 422)
        failed = self.upload("ошибка-чтения.pdf", "not a PDF", token)
        results = self.search("ошибка-чтения", token)[1]
        self.assertEqual(results[0]["id"], failed["id"])
        self.assertEqual(results[0]["status"], "failed")
        self.assertEqual(results[0]["snippet"], "")

    def test_literal_special_characters_are_not_patterns(self):
        token = self.root_token()
        doc = self.upload("literal.txt", "Метки [x] a+b (.) \\ %_ и <script>alert(1)</script>", token)
        for query in ["[x]", "a+b", "(.)", "\\", "%_", "<script>"]:
            status, results, _ = self.search(query, token)
            self.assertEqual(status, 200)
            self.assertEqual([item["id"] for item in results], [doc["id"]])
            self.assertIn(query, results[0]["snippet"])

    def test_permissions_and_live_document_access(self):
        root = self.root_token()
        _, role, _ = self.request("/api/roles", {"name": "Search reader", "permissions": ["documents.view"]}, token=root)
        _, other_role, _ = self.request("/api/roles", {"name": "Other search reader", "permissions": ["documents.view"]}, token=root)
        _, user, _ = self.request("/api/users", {"email": "search-reader@example.com", "password": "test-password", "role": role["id"]}, token=root)
        reader = self.login(user["email"])[1]["access_token"]
        public = self.upload("public.txt", "restrictedkey public", root)
        private = self.upload("secret-title.txt", "restrictedkey confidential", root, "private")
        self.assertEqual(self.search("restrictedkey", None)[0], 401)
        self.assertEqual([r["id"] for r in self.search("restrictedkey", reader)[1]], [public["id"]])
        self.assertEqual(self.search("secret-title", reader)[1], [])
        self.assertEqual(len(self.search("restrictedkey", root)[1]), 2)
        path = f"/api/documents/{private['id']}/access"
        def access(data):
            self.assertEqual(self.request(path, data, token=root, method="PATCH")[0], 200)
        access({"access_mode": "users", "allowed_user_ids": [user["id"]]})
        self.assertEqual(len(self.search("restrictedkey", reader)[1]), 2)
        access({"access_mode": "roles", "allowed_role_ids": [role["id"]]})
        self.assertEqual(len(self.search("restrictedkey", reader)[1]), 2)
        self.request(f"/api/users/{user['id']}", {"role": other_role["id"], "is_active": True}, token=root, method="PATCH")
        self.assertEqual([r["id"] for r in self.search("restrictedkey", reader)[1]], [public["id"]])
        access({"access_mode": "all"})
        self.assertEqual(len(self.search("restrictedkey", reader)[1]), 2)
        access({"access_mode": "private"})
        self.assertEqual(len(self.search("restrictedkey", reader)[1]), 1)
        self.request(f"/api/roles/{other_role['id']}", {"name": "Other search reader", "permissions": []}, token=root, method="PATCH")
        self.assertEqual(self.search("restrictedkey", reader)[0], 403)
