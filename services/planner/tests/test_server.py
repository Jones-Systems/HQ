"""HTTP boundary checks through the transport-independent PlanningApp (no
socket or server process is started)."""

from __future__ import annotations

import base64
import io
import json
import unittest

from support import StoreTestCase

from planning.server import MAX_BODY, REPLAY_MAX_BODY, PlanningApp, is_loopback_host, make_handler

PORT = 8765
HOST = f"127.0.0.1:{PORT}"


class AppTestCase(StoreTestCase):
    def setUp(self):
        super().setUp()
        self.app = PlanningApp(self.store, port=PORT)
        self.counter = 0

    def call(self, method, path, body=None, headers=None, raw=None):
        h = {"host": HOST}
        if method != "GET":
            h.update({"content-type": "application/json", "x-planning-request": "1"})
        h.update(headers or {})
        data = raw if raw is not None else (json.dumps(body).encode() if body is not None else b"")
        resp = self.app.handle(method, path, {k.lower(): v for k, v in h.items() if v is not None}, data)
        try:
            payload = json.loads(resp.body) if resp.headers["Content-Type"].startswith("application/json") else resp.body
        except ValueError:
            payload = resp.body
        return resp, payload


class StaticFiles(AppTestCase):
    def test_index_and_assets_served_with_types(self):
        resp, body = self.call("GET", "/")
        self.assertEqual(resp.status, 200)
        self.assertTrue(resp.headers["Content-Type"].startswith("text/html"))
        self.assertIn(b"/js/app.js", body)
        resp, _ = self.call("GET", "/js/app.js")
        self.assertTrue(resp.headers["Content-Type"].startswith("text/javascript"))

    def test_traversal_hidden_and_source_paths_are_not_served(self):
        for path in ("/../planning/store.py", "/css/../../planning/store.py", "/%2e%2e/planning/store.py",
                     "/.hidden", "/planning.sqlite3", "/planning/server.py", "/js/../../tests/test_store.py",
                     "/js\\..\\..\\planning\\store.py", "/nope.txt"):
            with self.subTest(path=path):
                resp, _ = self.call("GET", path)
                self.assertEqual(resp.status, 404)

    def test_unknown_host_refused(self):
        resp, _ = self.call("GET", "/", headers={"host": "evil.example:8765"})
        self.assertEqual(resp.status, 421)
        app = PlanningApp(self.store, port=PORT, extra_hosts=("planning.tailnet.example",))
        resp = app.handle("GET", "/api/version", {"host": "planning.tailnet.example"}, b"")
        self.assertEqual(resp.status, 200)

    def test_loopback_detection(self):
        self.assertTrue(all(map(is_loopback_host, ["127.0.0.1", "::1", "localhost", "127.0.0.2"])))
        self.assertFalse(any(map(is_loopback_host, ["0.0.0.0", "192.168.1.5", "example.com", "::"])))


class MutationGuards(AppTestCase):
    def test_https_allowed_host_can_create_update_and_read_back(self):
        host = "planning.tailnet.example:8445"
        self.app = PlanningApp(self.store, port=PORT, extra_hosts=(host,))
        headers = {"host": host, "origin": f"https://{host}", "sec-fetch-site": "same-origin"}
        resp, created = self.call("POST", "/api/items", {"fields": {"title": "HTTPS save"}}, headers=headers)
        self.assertEqual(resp.status, 201)
        item = created["item"]
        resp, updated = self.call("PATCH", f"/api/items/{item['id']}",
                                  {"revision": item["revision"], "patch": {"title": "HTTPS edit"}}, headers=headers)
        self.assertEqual(resp.status, 200)
        resp, snapshot = self.call("GET", "/api/state", headers={"host": host})
        self.assertEqual(resp.status, 200)
        self.assertEqual(snapshot["items"][0]["title"], "HTTPS edit")
        self.assertEqual(snapshot["items"][0]["revision"], updated["item"]["revision"])

    def test_https_preserves_host_origin_and_mutation_guards(self):
        host = "planning.tailnet.example:8445"
        self.app = PlanningApp(self.store, port=PORT, extra_hosts=(host,))
        headers = {"host": host, "origin": f"https://{host}", "sec-fetch-site": "same-origin"}
        cases = [
            ({"host": "unapproved.tailnet.example:8445",
              "origin": "https://unapproved.tailnet.example:8445"}, 421),
            ({"origin": "https://other.tailnet.example:8445"}, 403),
            ({"origin": "https://planning.tailnet.example:8446"}, 403),
            ({"origin": "https://planning.tailnet.example"}, 403),
            ({"origin": f"ftp://{host}"}, 403),
            ({"origin": "null"}, 403),
            ({"x-planning-request": None}, 403),
            ({"content-type": "text/plain"}, 415),
            ({"sec-fetch-site": "cross-site"}, 403),
        ]
        for overrides, status in cases:
            with self.subTest(overrides=overrides):
                resp, _ = self.call("POST", "/api/items", {"fields": {"title": "Rejected"}},
                                    headers={**headers, **overrides})
                self.assertEqual(resp.status, status)
        self.assertEqual(self.store.snapshot()["items"], [])

    def test_requires_custom_header_json_and_same_origin(self):
        body = {"fields": {"title": "x"}}
        cases = [
            ({"x-planning-request": None}, 403),
            ({"content-type": "text/plain"}, 415),
            ({"content-type": "application/x-www-form-urlencoded"}, 415),
            ({"origin": "http://evil.example"}, 403),
            ({"origin": "null"}, 403),
            ({"sec-fetch-site": "cross-site"}, 403),
        ]
        for headers, status in cases:
            with self.subTest(headers=headers):
                resp, _ = self.call("POST", "/api/items", body, headers=headers)
                self.assertEqual(resp.status, status)
        self.assertEqual(self.store.snapshot()["items"], [])
        resp, _ = self.call("POST", "/api/items", body, headers={"origin": f"http://{HOST}", "sec-fetch-site": "same-origin"})
        self.assertEqual(resp.status, 201)

    def test_body_limits_and_bad_json(self):
        resp, _ = self.call("POST", "/api/items", raw=b"{" + b" " * MAX_BODY + b"}")
        self.assertEqual(resp.status, 413)
        resp, _ = self.call("POST", "/api/items", raw=b"{not json")
        self.assertEqual(resp.status, 400)
        resp, _ = self.call("POST", "/api/items", raw=b"[1]")
        self.assertEqual(resp.status, 400)

    def test_unsupported_methods(self):
        resp, _ = self.call("DELETE", "/api/items")
        self.assertEqual(resp.status, 405)
        resp, _ = self.call("POST", "/index.html", {})
        self.assertEqual(resp.status, 405)


class ApiFlow(AppTestCase):
    def test_create_patch_move_and_read_back(self):
        resp, created = self.call("POST", "/api/items", {"fields": {"title": "<img src=x onerror=alert(1)>"}},
                                  headers={"x-request-id": "req-00000001"})
        self.assertEqual(resp.status, 201)
        item = created["item"]
        # Owner text is stored verbatim; the client renders it as text.
        self.assertEqual(item["title"], "<img src=x onerror=alert(1)>")
        resp, again = self.call("POST", "/api/items", {"fields": {"title": "<img src=x onerror=alert(1)>"}},
                                headers={"x-request-id": "req-00000001"})
        self.assertEqual((resp.status, resp.headers.get("X-Replayed")), (201, "1"))
        self.assertEqual(again["item"]["id"], item["id"])

        resp, patched = self.call("PATCH", f"/api/items/{item['id']}", {"revision": 1, "patch": {"horizon": "now"}})
        self.assertEqual((resp.status, patched["item"]["horizon"]), (200, "now"))
        resp, conflict = self.call("PATCH", f"/api/items/{item['id']}", {"revision": 1, "patch": {"horizon": "soon"}})
        self.assertEqual((resp.status, conflict["error"]), (409, "revision_conflict"))
        self.assertEqual(conflict["current"]["horizon"], "now")

        resp, moved = self.call("POST", f"/api/items/{item['id']}/move", {"revision": 2, "status": "active", "place": "top"})
        self.assertEqual(moved["item"]["status"], "active")
        resp, snap = self.call("GET", "/api/state")
        self.assertEqual(snap["items"][0]["status"], "active")
        self.assertEqual(snap["state_version"], moved["state_version"])
        resp, hist = self.call("GET", f"/api/items/{item['id']}/history")
        self.assertEqual([h["action"] for h in hist["history"]], ["moved", "updated", "created"])

    def test_validation_errors_are_structured(self):
        resp, payload = self.call("POST", "/api/items", {"fields": {"title": ""}})
        self.assertEqual(resp.status, 400)
        self.assertEqual(payload["errors"][0]["field"], "title")

    def test_export_and_guarded_import(self):
        self.call("POST", "/api/items", {"fields": {"title": "Keep"}})
        resp, exported = self.call("GET", "/api/export")
        self.assertIn("attachment", resp.headers["Content-Disposition"])
        resp, payload = self.call("POST", "/api/import", {"mode": "replace", "data": exported})
        self.assertEqual((resp.status, payload["error"]), (400, "confirmation_required"))
        resp, preview = self.call("POST", "/api/import/preview", {"data": exported})
        self.assertEqual(preview["incoming"], 1)
        resp, done = self.call("POST", "/api/import", {"mode": "replace", "data": exported, "confirm": "replace"})
        self.assertEqual(resp.status, 200)
        resp, backups = self.call("GET", "/api/backups")
        self.assertEqual(backups["backups"][0]["name"], done["backup"])
        resp, md = self.call("GET", "/api/export.md")
        self.assertIn(b"### Keep", md)

    def test_unknown_item_and_endpoint(self):
        resp, _ = self.call("GET", "/api/items/abcdef123456")
        self.assertEqual(resp.status, 404)
        resp, _ = self.call("GET", "/api/nothing")
        self.assertEqual(resp.status, 404)


class BatchAndReplayApi(AppTestCase):
    def envelope(self, raw=b'{"fields":{"title":"Once"}}', **overrides):
        return {"mode": "resend", "request_id": "request-0001", "method": "POST", "path": "/api/items",
                "body_b64": base64.b64encode(raw).decode(), "sent_after_version": 0, **overrides}

    def test_capabilities_and_batch_replay_exact_bytes(self):
        for path in ("/api/version", "/api/state"):
            resp, data = self.call("GET", path)
            self.assertEqual(data["api"], 2)
            self.assertEqual(data["features"], ["items.batch_create", "requests.replay"])
            self.assertEqual(data["request_retention"], {"max": 2000, "evicted_through_version": 0})
        raw = b'{"items":[{"title":"A"},{"title":"B"}]}'
        headers = {"x-request-id": "request-0001"}
        resp, first = self.call("POST", "/api/items/batch", raw=raw, headers=headers)
        self.assertEqual(resp.status, 201)
        resp, again = self.call("POST", "/api/items/batch", raw=raw, headers=headers)
        self.assertEqual((resp.status, resp.headers["X-Replayed"], again), (201, "1", first))
        resp, data = self.call("POST", "/api/items/batch", raw=raw + b" ", headers=headers)
        self.assertEqual((resp.status, data["error"]), (422, "request_id_reused"))
        resp, data = self.call("POST", "/api/requests/replay", self.envelope(raw, path="/api/items/batch"))
        self.assertEqual((resp.status, data["outcome"], data["response"]), (200, "replayed", first))

    def test_batch_closed_shape_limits_and_validation(self):
        bad = ({}, {"items": []}, {"items": [{"title": "x"}] * 51},
               {"items": [{"title": "x"}], "extra": 1}, {"items": [{"title": "x"}], "dry_run": 1},
               {"items": [None, {"title": "", "kind": "bad"}]})
        for body in bad:
            with self.subTest(body=str(body)[:80]):
                resp, _ = self.call("POST", "/api/items/batch", body)
                self.assertEqual(resp.status, 400)
        resp, _ = self.call("POST", "/api/items/batch", raw=b" " * (MAX_BODY + 1))
        self.assertEqual(resp.status, 413)
        resp, dry = self.call("POST", "/api/items/batch", {"items": [{"title": "A"}] * 50, "dry_run": True})
        self.assertEqual((resp.status, dry["count"], self.store.version()), (200, 50, 0))
        self.assertEqual(self.store.snapshot()["items"], [])
        resp, result = self.call("POST", "/api/items/batch", {"items": [{"title": str(i)} for i in range(50)]})
        self.assertEqual((resp.status, len(result["items"])), (201, 50))

    def test_replay_resend_then_late_original(self):
        raw = b'{ "fields": {"title": "Once"}}'
        envelope = self.envelope(raw)
        resp, data = self.call("POST", "/api/requests/replay", {**envelope, "mode": "lookup"})
        self.assertEqual(data, {"outcome": "not_applied"})
        resp, data = self.call("POST", "/api/requests/replay", envelope)
        self.assertEqual((resp.status, data["outcome"]), (200, "applied_now"))
        resp, original = self.call("POST", "/api/items", raw=raw, headers={"x-request-id": "request-0001"})
        self.assertEqual((resp.status, resp.headers["X-Replayed"], original), (201, "1", data["response"]))
        self.assertEqual((self.store.version(), len(self.store.snapshot()["items"])), (1, 1))
        resp, data = self.call("POST", "/api/requests/replay", self.envelope(raw + b" "))
        self.assertEqual((resp.status, data["error"]), (422, "request_id_reused"))

    def test_replay_envelope_rejections_and_caps(self):
        cases = [(self.envelope(path="/api/examples"), 400, "not_replayable"),
                 (self.envelope(path="/api/items?x=1"), 400, "not_replayable"),
                 (self.envelope(body_b64="%%%"), 400, "invalid"),
                 (self.envelope(b"[]"), 400, "bad_json"),
                 (self.envelope(b"{bad"), 400, "bad_json"),
                 (self.envelope(extra=True), 400, "invalid"),
                 (self.envelope(sent_after_version=True), 400, "invalid"),
                 (self.envelope(sent_after_version=1), 400, "invalid"),
                 (self.envelope(sent_after_version=None), 409, "replay_indeterminate"),
                 (self.envelope(b" " * (MAX_BODY + 1)), 413, "too_large")]
        for body, status, code in cases:
            with self.subTest(code=code, status=status):
                resp, data = self.call("POST", "/api/requests/replay", body)
                self.assertEqual((resp.status, data["error"]), (status, code))
        resp, data = self.call("POST", "/api/requests/replay", self.envelope(), headers={"x-request-id": "request-0002"})
        self.assertEqual((resp.status, data["error"]), (400, "bad_request_id"))
        resp, _ = self.call("POST", "/api/requests/replay", raw=b" " * (REPLAY_MAX_BODY + 1))
        self.assertEqual(resp.status, 413)
        self.assertEqual(self.store.version(), 0)

    def test_new_routes_preserve_all_mutation_guards(self):
        for path, body in (("/api/items/batch", {"items": [{"title": "A"}]}),
                           ("/api/requests/replay", self.envelope())):
            for headers, expected in (({"host": "evil.example"}, 421), ({"origin": "http://evil.example"}, 403),
                                      ({"x-planning-request": None}, 403), ({"content-type": "text/plain"}, 415),
                                      ({"sec-fetch-site": "cross-site"}, 403)):
                with self.subTest(path=path, headers=headers):
                    resp, _ = self.call("POST", path, body, headers=headers)
                    self.assertEqual(resp.status, expected)
        self.assertEqual(self.store.version(), 0)


class _FakeConnection:
    """Socket stand-in: BaseHTTPRequestHandler reads/writes through makefile()."""

    def __init__(self, raw: bytes):
        self.rfile = io.BytesIO(raw)
        self.wfile = io.BytesIO()

    def makefile(self, mode, *args, **kwargs):
        return self.rfile if "r" in mode else self.wfile

    def sendall(self, data):
        self.wfile.write(data)


class _FakeServer:
    server_name = "test"
    server_port = PORT


class HandlerTransport(AppTestCase):
    """Drives the real request handler in-process; no socket is opened."""

    def raw(self, request: bytes) -> tuple[str, dict, bytes]:
        handler_cls = make_handler(self.app)
        conn = _FakeConnection(request)
        handler_cls.log_message = lambda *a, **k: None
        handler_cls(conn, ("127.0.0.1", 50000), _FakeServer())
        head, _, body = conn.wfile.getvalue().partition(b"\r\n\r\n")
        lines = head.decode().split("\r\n")
        headers = {}
        for line in lines[1:]:
            key, _, value = line.partition(": ")
            headers[key.lower()] = value
        return lines[0], headers, body

    def test_security_headers_and_head(self):
        status, headers, body = self.raw(f"GET / HTTP/1.1\r\nHost: {HOST}\r\nConnection: close\r\n\r\n".encode())
        self.assertIn("200", status)
        self.assertIn("default-src 'self'", headers["content-security-policy"])
        self.assertEqual(headers["x-content-type-options"], "nosniff")
        self.assertEqual(headers["x-frame-options"], "DENY")
        self.assertTrue(body.startswith(b"<!doctype html>"))
        status, headers, body = self.raw(f"HEAD / HTTP/1.1\r\nHost: {HOST}\r\nConnection: close\r\n\r\n".encode())
        self.assertIn("200", status)
        self.assertEqual(body, b"")

    def test_replay_handler_outer_limit(self):
        body = json.dumps({"mode": "lookup", "request_id": "request-0001", "method": "POST", "path": "/api/items",
                           "body_b64": base64.b64encode(b" " * (MAX_BODY - 2) + b"{}").decode(),
                           "sent_after_version": 0}).encode()
        self.assertGreater(len(body), MAX_BODY)
        request = (f"POST /api/requests/replay HTTP/1.1\r\nHost: {HOST}\r\nContent-Type: application/json\r\n"
                   f"X-Planning-Request: 1\r\nContent-Length: {len(body)}\r\nConnection: close\r\n\r\n").encode() + body
        status, _, result = self.raw(request)
        self.assertIn("200", status)
        self.assertEqual(json.loads(result), {"outcome": "not_applied"})
        request = (f"POST /api/requests/replay HTTP/1.1\r\nHost: {HOST}\r\n"
                   f"Content-Length: {REPLAY_MAX_BODY + 1}\r\n\r\n").encode()
        self.assertIn("413", self.raw(request)[0])

    def test_post_round_trip_and_length_guards(self):
        payload = json.dumps({"fields": {"title": "Over the wire"}}).encode()
        request = (f"POST /api/items HTTP/1.1\r\nHost: {HOST}\r\nContent-Type: application/json\r\n"
                   f"X-Planning-Request: 1\r\nContent-Length: {len(payload)}\r\nConnection: close\r\n\r\n").encode() + payload
        status, headers, body = self.raw(request)
        self.assertIn("201", status)
        self.assertEqual(headers["cache-control"], "no-store")
        self.assertEqual(json.loads(body)["item"]["title"], "Over the wire")

        too_big = (f"POST /api/items HTTP/1.1\r\nHost: {HOST}\r\nContent-Type: application/json\r\n"
                   f"X-Planning-Request: 1\r\nContent-Length: {MAX_BODY + 1}\r\n\r\n").encode()
        status, _, _ = self.raw(too_big)
        self.assertIn("413", status)
        chunked = (f"POST /api/items HTTP/1.1\r\nHost: {HOST}\r\nContent-Type: application/json\r\n"
                   f"X-Planning-Request: 1\r\nTransfer-Encoding: chunked\r\n\r\n0\r\n\r\n").encode()
        status, _, _ = self.raw(chunked)
        self.assertIn("411", status)
        self.assertEqual(len(self.store.snapshot()["items"]), 1)


class CliGuards(StoreTestCase):
    """Refusals happen before any socket is bound."""

    def test_refuses_public_dir_and_non_loopback(self):
        import contextlib

        from planning.__main__ import main
        from planning.server import PUBLIC_DIR

        quiet = io.StringIO()
        with contextlib.redirect_stderr(quiet):
            self.assertEqual(main(["--data", str(PUBLIC_DIR / "planning.sqlite3")]), 2)
            self.assertEqual(main(["--data", str(self.db_path), "--host", "0.0.0.0"]), 2)
            self.assertEqual(main(["--data", str(self.db_path.parent / "missing" / "x.sqlite3")]), 2)
        self.assertFalse((PUBLIC_DIR / "planning.sqlite3").exists())


if __name__ == "__main__":
    unittest.main()
