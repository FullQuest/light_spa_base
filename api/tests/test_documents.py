import io
import json
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen
from docx import Document as WordDocument
from pypdf import PdfWriter
from pypdf.generic import NameObject, DictionaryObject, DecodedStreamObject
from test_auth import ApiTestCase


def pdf_fixture(blank=False):
    writer = PdfWriter()
    page = writer.add_blank_page(width=600, height=800)
    if not blank:
        font = DictionaryObject({NameObject("/Type"): NameObject("/Font"),
                                 NameObject("/Subtype"): NameObject("/Type1"),
                                 NameObject("/BaseFont"): NameObject("/Helvetica")})
        page[NameObject("/Resources")] = DictionaryObject({NameObject("/Font"): DictionaryObject({NameObject("/F1"): font})})
        stream = DecodedStreamObject()
        stream.set_data(b"BT /F1 12 Tf 72 720 Td (Hello PDF) Tj ET")
        page[NameObject("/Contents")] = writer._add_object(stream)
        writer.add_blank_page(width=600, height=800)
    result = io.BytesIO()
    writer.write(result)
    return result.getvalue()


class DocumentTests(ApiTestCase):
    def root_token(self):
        return self.login("admin1", "12345678")[1]["access_token"]

    def upload(self, name, content, token, access=None):
        boundary = "document-test-boundary"
        body = (f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="{name}"\r\n'
                'Content-Type: application/octet-stream\r\n\r\n').encode() + content + f"\r\n--{boundary}--\r\n".encode()
        if access:
            fields = b""
            for key, value in access.items():
                for item in (value if isinstance(value, list) else [value]):
                    fields += f'--{boundary}\r\nContent-Disposition: form-data; name="{key}"\r\n\r\n{item}\r\n'.encode()
            body = fields + body
        headers = {"Content-Type": f"multipart/form-data; boundary={boundary}"}
        if token:
            headers["Authorization"] = f"Bearer {token}"
        try:
            response = urlopen(Request(self.base + "/api/documents", body, headers), timeout=20)
        except HTTPError as error:
            response = error
        with response:
            return response.status, json.load(response)

    def original(self, document, token):
        request = Request(self.base + f"/api/documents/{document['id']}/original",
                          headers={"Authorization": f"Bearer {token}"})
        with urlopen(request, timeout=5) as response:
            return response.read(), response.headers

    def test_text_formats_originals_and_deletion(self):
        token = self.root_token()
        for name, body in [("Русский.txt", "Привет, завод".encode()), ("note.md", b"# Heading"),
                           ("legacy.txt", "Привет".encode("cp1251")), ("utf16.txt", "Текст".encode("utf-16"))]:
            status, document = self.upload(name, body, token)
            self.assertEqual(status, 201)
            self.assertEqual(document["status"], "ready")
            self.assertTrue(document["text"])
            self.assertEqual(self.original(document, token)[0], body)
            path = Path(self.temp.name) / "documents" / f"{document['id']}.{document['format']}"
            self.assertTrue(path.exists())
            _, detail, _ = self.request(f"/api/documents/{document['id']}", token=token)
            self.assertEqual(detail["text"], document["text"])
            self.assertEqual(self.request(f"/api/documents/{document['id']}", token=token, method="DELETE")[0], 204)
            self.assertFalse(path.exists())
            self.assertEqual(self.request(f"/api/documents/{document['id']}", token=token)[0], 404)

    def test_csv_docx_and_pdf_extraction(self):
        token = self.root_token()
        csv = 'Название;Код\r\n"Цех; один";0012\r\nВторой;\r\n'.encode()
        _, document = self.upload("table.csv", csv, token)
        self.assertEqual(document["tables"][0]["rows"], [["Название", "Код"], ["Цех; один", "0012"], ["Второй", ""]])
        self.assertEqual(self.original(document, token)[0], csv)
        word = WordDocument()
        word.add_paragraph("До таблицы")
        table = word.add_table(rows=1, cols=2)
        table.cell(0, 0).text, table.cell(0, 1).text = "Цех", "0012"
        word.add_paragraph("После таблицы")
        data = io.BytesIO()
        word.save(data)
        _, document = self.upload("report.docx", data.getvalue(), token)
        self.assertEqual(document["status"], "ready")
        self.assertEqual(document["tables"][0]["rows"], [["Цех", "0012"]])
        self.assertLess(document["text"].index("До таблицы"), document["text"].index("Цех"))
        self.assertLess(document["text"].index("Цех"), document["text"].index("После таблицы"))
        self.assertEqual(self.original(document, token)[0], data.getvalue())
        _, document = self.upload("report.pdf", pdf_fixture(), token)
        self.assertEqual(document["status"], "ready")
        self.assertIn("Hello PDF", document["text"])
        self.assertTrue(any("Страница 2" in warning for warning in document["warnings"]))

    def test_failed_extraction_keeps_original_and_empty_text_warns(self):
        token = self.root_token()
        for name, body in [("broken.pdf", b"broken"), ("broken.docx", b"broken"), ("scan.pdf", pdf_fixture(blank=True))]:
            status, document = self.upload(name, body, token)
            self.assertEqual(status, 201)
            self.assertEqual(document["status"], "failed")
            self.assertTrue(document["error"])
            self.assertEqual(self.original(document, token)[0], body)
            if name == "scan.pdf":
                self.assertIn("OCR", document["error"])
        _, document = self.upload("empty.txt", b"", token)
        self.assertEqual(document["status"], "ready")
        self.assertTrue(document["warnings"])
        self.assertEqual(self.upload("unsupported.exe", b"x", token)[0], 415)
        _, document = self.upload("../../safe.txt", b"safe", token)
        self.assertEqual(document["original_name"], "safe.txt")
        self.assertEqual(self.upload("large.txt", b"x" * (20 * 1024 * 1024 + 1), token)[0], 413)
        _, documents, _ = self.request("/api/documents", token=token)
        self.assertTrue(documents)
        self.assertNotIn("text", documents[0])
        self.assertNotIn("tables", documents[0])
        self.assertFalse(any(d["original_name"] in ("unsupported.exe", "large.txt") for d in documents))

    def test_permissions_apply_to_metadata_original_and_mutations(self):
        token = self.root_token()
        _, document = self.upload("private.txt", b"private", token)
        _, account, _ = self.register("reader@example.com")
        reader = self.login("reader@example.com")[1]["access_token"]
        for path in ["/api/documents", f"/api/documents/{document['id']}", f"/api/documents/{document['id']}/original"]:
            self.assertEqual(self.request(path)[0], 401)
            self.assertEqual(self.request(path, token=reader)[0], 403)
        _, role, _ = self.request("/api/roles", {"name": "Reader", "permissions": ["documents.view"]}, token=token)
        self.request(f"/api/users/{account['id']}", {"role": role["id"], "is_active": True}, token=token, method="PATCH")
        self.assertEqual(self.request("/api/documents", token=reader)[0], 200)
        self.assertEqual(self.original(document, reader)[0], b"private")
        self.assertEqual(self.upload("denied.txt", b"x", reader)[0], 403)
        self.assertEqual(self.request(f"/api/documents/{document['id']}", token=reader, method="DELETE")[0], 403)
        self.request(f"/api/roles/{role['id']}", {"name": "Reader", "permissions": []}, token=token, method="PATCH")
        self.assertEqual(self.request(f"/api/documents/{document['id']}/original", token=reader)[0], 403)

    def actor(self, name, permissions):
        root = self.root_token()
        _, role, _ = self.request("/api/roles", {"name": name, "permissions": permissions}, token=root)
        _, user, _ = self.request("/api/users", {"email": name + "@example.com", "password": "test-password", "role": role["id"]}, token=root)
        return user, self.login(user["email"])[1]["access_token"], role

    def test_document_access_modes_and_owner_boundaries(self):
        owner, owner_token, _ = self.actor("acl-owner", ["documents.view", "documents.manage"])
        reader, reader_token, reader_role = self.actor("acl-reader", ["documents.view"])
        outsider, outsider_token, _ = self.actor("acl-outsider", ["documents.view", "documents.manage"])
        root = self.root_token()
        status, doc = self.upload("acl.txt", b"private content", owner_token, {"access_mode": "private"})
        self.assertEqual(status, 201)
        path = f"/api/documents/{doc['id']}"
        def change(data, token=owner_token):
            return self.request(path + "/access", data, token=token, method="PATCH")
        def visible(token, expected):
            for suffix in ["", "/original", "/original?download=true"]:
                if expected == 200 and suffix:
                    self.assertEqual(self.original(doc, token)[0], b"private content")
                else:
                    self.assertEqual(self.request(path + suffix, token=token)[0], expected)
            listed = self.request("/api/documents", token=token)[1]
            self.assertEqual(any(item["id"] == doc["id"] for item in listed), expected == 200)
        visible(owner_token, 200)
        visible(root, 200)
        visible(reader_token, 404)
        visible(outsider_token, 404)
        self.assertEqual(change({"access_mode": "all"}, outsider_token)[0], 404)
        self.assertEqual(change({"access_mode": "users", "allowed_user_ids": [reader["id"]]})[0], 200)
        visible(reader_token, 200)
        visible(outsider_token, 404)
        self.assertEqual(change({"access_mode": "all"}, reader_token)[0], 403)
        result = change({"access_mode": "roles", "allowed_role_ids": [reader_role["id"]]})
        self.assertEqual(result[0], 200)
        self.assertEqual(result[1]["allowed_user_ids"], [])
        visible(reader_token, 200)
        self.request(f"/api/users/{reader['id']}", {"role": outsider["role"], "is_active": True}, token=root, method="PATCH")
        visible(reader_token, 404)
        self.assertEqual(change({"access_mode": "all"})[0], 200)
        visible(outsider_token, 200)
        self.assertEqual(self.request(path, token=outsider_token, method="DELETE")[0], 403)
        self.assertEqual(change({"access_mode": "private"}, root)[0], 200)
        visible(owner_token, 200)
        for data in [{"access_mode": "bad"}, {"access_mode": "users"}, {"access_mode": "roles"},
                     {"access_mode": "users", "allowed_user_ids": [999999]},
                     {"access_mode": "roles", "allowed_role_ids": ["missing"]}]:
            self.assertEqual(change(data)[0], 422)
        self.assertEqual(self.upload("invalid-acl.txt", b"x", owner_token, {"access_mode": "users"})[0], 422)
        self.assertEqual(self.request(path, token=owner_token, method="DELETE")[0], 204)

    def test_visible_authors_filters_and_sorting(self):
        from datetime import datetime, timezone, timedelta
        owner, owner_token, _ = self.actor("filter-owner", ["documents.view", "documents.manage"])
        reader, reader_token, _ = self.actor("filter-reader", ["documents.view", "documents.manage"])
        hidden_owner, hidden_token, _ = self.actor("filter-hidden", ["documents.view", "documents.manage"])
        _, first = self.upload("filter-Бета.txt", b"one", owner_token)
        _, second = self.upload("filter-Альфа.csv", b"a,b\n1,2", reader_token)
        _, failed = self.upload("filter-Битый.pdf", b"broken", owner_token)
        _, hidden = self.upload("filter-hidden.txt", b"hidden", hidden_token, {"access_mode": "private"})
        def ids(query, token=reader_token):
            from urllib.parse import urlencode
            status, items, _ = self.request("/api/documents?" + urlencode({"q": "filter-", **query}), token=token)
            self.assertEqual(status, 200)
            return [item["id"] for item in items]
        self.assertEqual(set(ids({})), {first["id"], second["id"], failed["id"]})
        self.assertEqual(ids({"author_id": reader["id"]}), [second["id"]])
        self.assertEqual(ids({"mine": "true"}), [second["id"]])
        self.assertEqual(ids({"format": "csv"}), [second["id"]])
        self.assertEqual(ids({"status": "failed"}), [failed["id"]])
        self.assertEqual(ids({"q": "АЛЬФА"}), [second["id"]])
        today = datetime.now(timezone.utc).date()
        self.assertEqual(set(ids({"date_from": today, "date_to": today})), {first["id"], second["id"], failed["id"]})
        self.assertEqual(ids({"date_from": today + timedelta(days=1)}), [])
        self.assertEqual(ids({"date_to": today - timedelta(days=1)}), [])
        self.assertEqual(ids({"sort": "name"})[0], second["id"])
        self.assertEqual(ids({"sort": "oldest"})[0], first["id"])
        self.assertEqual(ids({"sort": "newest"})[0], failed["id"])
        self.assertEqual(self.request("/api/documents?date_from=2030-01-02&date_to=2030-01-01", token=reader_token)[0], 422)
        _, authors, _ = self.request("/api/documents/authors", token=reader_token)
        self.assertNotIn(hidden_owner["id"], [item["id"] for item in authors])
        self.assertIn(owner["id"], [item["id"] for item in authors])
        _, detail, _ = self.request(f"/api/documents/{first['id']}", token=reader_token)
        self.assertEqual(detail["uploaded_by_name"], owner["email"])
