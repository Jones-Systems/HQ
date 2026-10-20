"""Loopback HTTP server for the planning hub.

Security boundary (keep in sync with README "Security"):
- Binds only to loopback addresses; persistent private hosting is a separate,
  explicitly authorized step (for example a private proxy in front of loopback).
- Requests must name an allowed Host (DNS-rebinding guard).
- Mutations require ``Content-Type: application/json``, the custom
  ``X-Planning-Request: 1`` header (forces a CORS preflight that is never
  granted), a same-origin ``Origin`` when present, and a bounded body.
- Static files are served only from ``public/`` with an extension allow-list;
  the SQLite file and backups live outside it and are never served.
"""

from __future__ import annotations

import base64
import binascii
import hashlib
import ipaddress
import json
import re
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit

from .store import Store, StoreError
from .validation import ValidationError

PUBLIC_DIR = (Path(__file__).resolve().parent.parent / "public").resolve()
MAX_BODY = 256 * 1024
REPLAY_MAX_BODY = 352 * 1024
MAX_IMPORT_BODY = 8 * 1024 * 1024
STATIC_TYPES = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".svg": "image/svg+xml",
    ".webmanifest": "application/manifest+json",
}
SECURITY_HEADERS = {
    "Content-Security-Policy": (
        "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; "
        "connect-src 'self'; font-src 'self'; manifest-src 'self'; base-uri 'none'; "
        "form-action 'none'; frame-ancestors 'none'; object-src 'none'"
    ),
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "X-Frame-Options": "DENY",
    "Cross-Origin-Opener-Policy": "same-origin",
    "Cross-Origin-Resource-Policy": "same-origin",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
}
_ITEM_RE = re.compile(r"^/api/items/([A-Za-z0-9_-]{6,40})(/[a-z]+)?$")
_REQUEST_ID_RE = re.compile(r"^[A-Za-z0-9-]{8,64}$")


class Response:
    def __init__(self, status: int, body: bytes = b"", content_type: str = "application/json",
                 headers: dict | None = None):
        self.status = status
        self.body = body
        self.headers = {"Content-Type": content_type, **(headers or {})}


def json_response(status: int, payload, headers: dict | None = None) -> Response:
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    return Response(status, body, "application/json; charset=utf-8",
                    {"Cache-Control": "no-store", **(headers or {})})


def error(status: int, code: str, message: str, **extra) -> Response:
    return json_response(status, {"error": code, "message": message, **extra})


def is_loopback_host(host: str) -> bool:
    if host == "localhost":
        return True
    try:
        return ipaddress.ip_address(host).is_loopback
    except ValueError:
        return False


class PlanningApp:
    """Transport-independent request handling, so tests need no socket."""

    def __init__(self, store: Store, *, port: int, extra_hosts: tuple[str, ...] = ()):
        self.store = store
        self.allowed_hosts = {f"127.0.0.1:{port}", f"localhost:{port}", f"[::1]:{port}"}
        self.allowed_hosts.update(h.lower() for h in extra_hosts)

    # The handler passes lower-cased header names.
    def handle(self, method: str, raw_path: str, headers: dict, body: bytes) -> Response:
        host = headers.get("host", "").lower()
        if host not in self.allowed_hosts:
            return error(421, "bad_host", "Unrecognized Host header.")
        path = urlsplit(raw_path).path
        try:
            if path.startswith("/api/"):
                return self._api(method, path, headers, body)
            if method not in ("GET", "HEAD"):
                return error(405, "method_not_allowed", "Method not allowed.")
            return self._static(path)
        except StoreError as exc:
            return json_response(exc.status, exc.payload())
        except ValidationError as exc:
            return error(400, "invalid", "Some fields are invalid.", errors=exc.errors)

    # ------------------------------------------------------------------ static

    def _static(self, path: str) -> Response:
        if path in ("", "/"):
            path = "/index.html"
        parts = [p for p in path.split("/") if p]
        if not parts or any(p.startswith(".") or "\\" in p or "\x00" in p for p in parts):
            return error(404, "not_found", "Not found.")
        try:
            target = PUBLIC_DIR.joinpath(*parts).resolve()
            if PUBLIC_DIR not in target.parents or not target.is_file():
                return error(404, "not_found", "Not found.")
            content_type = STATIC_TYPES.get(target.suffix)
            if content_type is None:
                return error(404, "not_found", "Not found.")
            data = target.read_bytes()
        except OSError:  # for example a name too long for the filesystem
            return error(404, "not_found", "Not found.")
        return Response(200, data, content_type, {"Cache-Control": "no-cache"})

    # --------------------------------------------------------------------- api

    def _api(self, method: str, path: str, headers: dict, body: bytes) -> Response:
        if method == "GET":
            return self._api_get(path)
        if method not in ("POST", "PATCH", "PUT"):
            return error(405, "method_not_allowed", "Method not allowed.")
        refusal = self._check_mutation(headers, body, path)
        if refusal:
            return refusal
        try:
            payload = json.loads(body.decode("utf-8")) if body else {}
        except (UnicodeDecodeError, ValueError, RecursionError):
            return error(400, "bad_json", "Body must be valid JSON.")
        if not isinstance(payload, dict):
            return error(400, "bad_json", "Body must be a JSON object.")
        if path == "/api/requests/replay" and "x-request-id" in headers:
            return error(400, "bad_request_id", "Put the original request ID in the replay body.")
        request_id = headers.get("x-request-id") or None
        if request_id is not None and not _REQUEST_ID_RE.match(request_id):
            return error(400, "bad_request_id", "Malformed X-Request-Id.")
        fingerprint = hashlib.sha256(f"{method} {path}\n".encode() + body).hexdigest()
        ctx = {"request_id": request_id, "fingerprint": fingerprint}
        result = self._dispatch(method, path, payload, ctx)
        if isinstance(result, Response):
            return result
        status, data, replayed = result
        return json_response(status, data, {"X-Replayed": "1"} if replayed else None)

    def _dispatch(self, method: str, path: str, p: dict, ctx: dict):
        s = self.store
        if method == "POST" and path == "/api/requests/replay":
            return self._replay_request(p)
        if method == "POST" and path == "/api/items":
            return s.create_item(p.get("fields"), **ctx)
        if method == "POST" and path == "/api/items/batch":
            return s.create_batch(p, **ctx)
        match = _ITEM_RE.match(path)
        if match:
            item_id, action = match.group(1), match.group(2)
            if method == "PATCH" and action is None:
                return s.update_item(item_id, p.get("revision"), p.get("patch"), **ctx)
            if method == "POST" and action == "/move":
                return s.move_item(item_id, p.get("revision"), p.get("status"), after_id=p.get("after_id"),
                                   before_id=p.get("before_id"), place=p.get("place", "bottom"), **ctx)
            if method == "POST" and action in ("/archive", "/restore"):
                return s.set_archived(item_id, p.get("revision"), action == "/archive", **ctx)
            if method == "POST" and action == "/reviewed":
                return s.mark_reviewed(item_id, p.get("revision"), **ctx)
        if method == "PUT" and path == "/api/settings":
            return s.update_settings(p.get("settings"), **ctx)
        if method == "POST" and path == "/api/import/preview":
            return 200, s.preview_import(p.get("data")), False
        if method == "POST" and path == "/api/import":
            return s.import_data(p.get("data"), p.get("mode"), p.get("confirm"), **ctx)
        if method == "POST" and path == "/api/backups/restore":
            return s.restore_backup(p.get("name"), p.get("confirm"), **ctx)
        if method == "POST" and path == "/api/examples":
            return s.load_examples(**ctx)
        if method == "POST" and path == "/api/examples/remove":
            return s.remove_examples(**ctx)
        return error(404, "not_found", "Unknown endpoint.")

    def _replay_request(self, p: dict):
        allowed = {"mode", "request_id", "method", "path", "body_b64", "sent_after_version"}
        if set(p) - allowed or not (allowed - {"sent_after_version"}) <= set(p):
            raise StoreError(400, "invalid", "Malformed replay envelope.")
        request_id = p["request_id"]
        if not isinstance(request_id, str) or not _REQUEST_ID_RE.fullmatch(request_id):
            raise StoreError(400, "invalid", "Malformed replay request ID.")
        method, path = p["method"], p["path"]
        if not isinstance(method, str) or not isinstance(path, str):
            raise StoreError(400, "not_replayable", "Unsupported replay target.")
        match = _ITEM_RE.fullmatch(path)
        replayable = ((method, path) in (("POST", "/api/items"), ("POST", "/api/items/batch"),
                                        ("PUT", "/api/settings")) or
                      (match and ((method == "PATCH" and match.group(2) is None) or
                                  (method == "POST" and match.group(2) in
                                   ("/move", "/archive", "/restore", "/reviewed")))))
        if not replayable:
            raise StoreError(400, "not_replayable", "Unsupported replay target.")
        try:
            if not isinstance(p["body_b64"], str):
                raise ValueError()
            body = base64.b64decode(p["body_b64"], validate=True)
        except (ValueError, binascii.Error):
            raise StoreError(400, "invalid", "body_b64 must be valid base64.") from None
        if len(body) > MAX_BODY:
            raise StoreError(413, "too_large", "Original request body is too large.")
        try:
            payload = json.loads(body.decode("utf-8"))
        except (ValueError, UnicodeDecodeError, RecursionError):
            raise StoreError(400, "bad_json", "Original body must be valid JSON.") from None
        if not isinstance(payload, dict):
            raise StoreError(400, "bad_json", "Original body must be a JSON object.")
        fingerprint = hashlib.sha256(f"{method} {path}\n".encode() + body).hexdigest()
        return self.store.replay_request(
            request_id, fingerprint, p.get("sent_after_version"), p["mode"],
            lambda: self._dispatch(method, path, payload,
                                   {"request_id": request_id, "fingerprint": fingerprint}))

    def _api_get(self, path: str) -> Response:
        s = self.store
        if path == "/api/state":
            return json_response(200, s.snapshot())
        if path == "/api/version":
            return json_response(200, s.api_version())
        if path == "/api/backups":
            return json_response(200, {"backups": s.list_backups()})
        if path == "/api/export":
            return json_response(200, s.export(), {
                "Content-Disposition": 'attachment; filename="planning-export.json"'})
        if path == "/api/export.md":
            return Response(200, s.export_markdown().encode("utf-8"), "text/markdown; charset=utf-8", {
                "Cache-Control": "no-store",
                "Content-Disposition": 'attachment; filename="planning-export.md"'})
        match = _ITEM_RE.match(path)
        if match and match.group(2) == "/history":
            s.get_item(match.group(1))
            return json_response(200, {"history": s.history(match.group(1))})
        if match and match.group(2) is None:
            return json_response(200, {"item": s.get_item(match.group(1))})
        return error(404, "not_found", "Unknown endpoint.")

    def _check_mutation(self, headers: dict, body: bytes, path: str) -> Response | None:
        content_type = headers.get("content-type", "").split(";")[0].strip().lower()
        if content_type != "application/json":
            return error(415, "unsupported_media_type", "Send application/json.")
        if headers.get("x-planning-request") != "1":
            return error(403, "forbidden", "Missing X-Planning-Request header.")
        origin = headers.get("origin")
        if origin is not None:
            parts = urlsplit(origin)
            if parts.scheme not in ("http", "https") or parts.netloc.lower() != headers.get("host", "").lower():
                return error(403, "forbidden", "Cross-origin changes are not accepted.")
        fetch_site = headers.get("sec-fetch-site")
        if fetch_site is not None and fetch_site not in ("same-origin", "none"):
            return error(403, "forbidden", "Cross-site changes are not accepted.")
        limit = MAX_IMPORT_BODY if path in ("/api/import", "/api/import/preview") else MAX_BODY
        if path == "/api/requests/replay":
            limit = REPLAY_MAX_BODY
        if len(body) > limit:
            return error(413, "too_large", "Request body is too large.")
        return None


def make_handler(app: PlanningApp):
    class Handler(BaseHTTPRequestHandler):
        server_version = "Planning"
        sys_version = ""
        protocol_version = "HTTP/1.1"

        def _serve(self, method: str) -> None:
            headers = {k.lower(): v for k, v in self.headers.items()}
            if "transfer-encoding" in headers:
                self._send(error(411, "length_required", "Chunked bodies are not accepted."), method, close=True)
                return
            try:
                length = int(headers.get("content-length", "0") or "0")
            except ValueError:
                length = -1
            limit = MAX_IMPORT_BODY if self.path.startswith("/api/import") else MAX_BODY
            if urlsplit(self.path).path == "/api/requests/replay":
                limit = REPLAY_MAX_BODY
            if length < 0 or length > limit:
                self._send(error(413, "too_large", "Request body is too large."), method, close=True)
                return
            body = self.rfile.read(length) if length else b""
            try:
                response = app.handle(method, self.path, headers, body)
            except Exception:  # noqa: BLE001 - never leak internals to the client
                self.log_error("Unhandled error for %s %s", method, urlsplit(self.path).path)
                response = error(500, "server_error", "The server hit an unexpected error.")
            self._send(response, method)

        def _send(self, response: Response, method: str, close: bool = False) -> None:
            self.send_response(response.status)
            for key, value in {**SECURITY_HEADERS, **response.headers}.items():
                self.send_header(key, value)
            self.send_header("Content-Length", str(len(response.body)))
            if close:
                self.send_header("Connection", "close")
                self.close_connection = True
            self.end_headers()
            if method != "HEAD":
                self.wfile.write(response.body)

        def do_GET(self):  # noqa: N802
            self._serve("GET")

        def do_HEAD(self):  # noqa: N802
            self._serve("HEAD")

        def do_POST(self):  # noqa: N802
            self._serve("POST")

        def do_PATCH(self):  # noqa: N802
            self._serve("PATCH")

        def do_PUT(self):  # noqa: N802
            self._serve("PUT")

        def do_DELETE(self):  # noqa: N802
            self._serve("DELETE")

    return Handler

