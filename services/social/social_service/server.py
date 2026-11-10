"""Loopback HTTP server for the HQ Social service (spec.hq-social-backend#iface.service.001).

Guards run on every request in this order: Host, Origin, Sec-Fetch-Site. A POST then needs the per-process
workspace token, ``Content-Type: application/json``, no ``Transfer-Encoding``, a ``Content-Length`` of
1-2,000,000 bytes and a JSON object body. Every error is exactly ``{"error": "<text>"}``. There is no web UI.
"""

from __future__ import annotations

import hmac
import ipaddress
import json
import re
import socket
import sys
from collections.abc import Callable
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer as BaseThreadingHTTPServer
from socketserver import TCPServer
from typing import Any
from urllib.parse import urlsplit

from .errors import ApiError, ForbiddenError, MethodNotAllowedError, NotFoundError, ValidationError
from .service import SocialService
from .validation import MAX_BODY_BYTES, MESSAGES

SERVER_ERROR = 'The service could not complete this request. Your existing data is preserved.'
TOKEN_REFUSED = 'Reload the workspace before saving'
ALLOW = 'GET, POST'
SECURITY_HEADERS = {
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
}
_SAMPLE_ROUTE = re.compile('/api/sample/([^/]*)')
_RUN_ROUTE = re.compile('/api/runs/([^/]*)')
_DIGITS = re.compile('[0-9]+')
DRAIN_CHUNK = 64 * 1024
HTTP_ERRORS = {408: 'Request timed out', 414: 'Request target too long', 431: 'Request headers too large',
               505: 'HTTP version not supported'}


class ThreadingHTTPServer(BaseThreadingHTTPServer):
    daemon_threads = True

    def handle_error(self, request: Any, client_address: Any) -> None:
        # Clients that reset, vanish or time out are routine on a long-running service; anything else is a bug.
        if isinstance(sys.exc_info()[1], (ConnectionError, TimeoutError)):
            return
        super().handle_error(request, client_address)

    def server_bind(self) -> None:
        # Reverse DNS can stall loopback startup; only the bound address is needed.
        TCPServer.server_bind(self)
        self.server_name, self.server_port = self.server_address[:2]


class ThreadingHTTPServerV6(ThreadingHTTPServer):
    address_family = socket.AF_INET6


def is_loopback_host(host: str) -> bool:
    if host.lower() == 'localhost':
        return True
    try:
        return ipaddress.ip_address(host).is_loopback
    except ValueError:
        return False


def display_host(host: str) -> str:
    return f'[{host}]' if ':' in host else host


class Response:
    def __init__(self, status: int, payload: Any, headers: dict[str, str] | None = None):
        self.status = status
        self.body = dumps(payload)
        self.headers = {'Content-Type': 'application/json; charset=utf-8', **SECURITY_HEADERS, **(headers or {})}


def dumps(payload: Any) -> bytes:
    """UTF-8 JSON. Text a client sent as a lone surrogate escape falls back to ASCII escapes."""
    try:
        return json.dumps(payload, ensure_ascii=False, separators=(',', ':'), allow_nan=False).encode('utf-8')
    except UnicodeEncodeError:
        return json.dumps(payload, ensure_ascii=True, separators=(',', ':'), allow_nan=False).encode('ascii')


def error_response(error: ApiError) -> Response:
    headers = {'Allow': ALLOW} if error.status == 405 else None
    return Response(error.status, {'error': error.message}, headers)


def parse_content_length(value: str | None) -> int | None:
    """The declared length, or None when it is absent or not a plain non-negative integer."""
    if value is None or _DIGITS.fullmatch(value.strip()) is None:
        return None
    digits = value.strip()
    return int(digits) if len(digits) <= 12 else 10 ** 12


def _reject_constant(constant: str) -> Any:
    raise ValueError(constant)


def decode_object(body: bytes) -> dict[str, Any]:
    try:
        payload = json.loads(body.decode('utf-8'), parse_constant=_reject_constant)
    except (UnicodeDecodeError, ValueError, RecursionError):
        raise ValidationError(MESSAGES['json_object']) from None
    if not isinstance(payload, dict):
        raise ValidationError(MESSAGES['json_object'])
    return payload


class SocialApp:
    """Transport-independent request handling, so guards and routes can be tested without a socket."""

    def __init__(self, service: SocialService, *, host: str, port: int, extra_hosts: tuple[str, ...] = ()):
        self.service = service
        self._token = service.token.encode('utf-8')
        self.allowed_hosts = {f'{display_host(host)}:{port}'.lower(), f'127.0.0.1:{port}',
                              f'localhost:{port}', f'[::1]:{port}'}
        self.allowed_hosts.update(item.lower() for item in extra_hosts)

    # The handler passes lower-cased header names; repeated headers are already joined with ', '.
    def handle(self, method: str, target: str, headers: dict[str, str],
               read_body: Callable[[int], bytes]) -> Response:
        try:
            self._check_request(headers)
            if method not in ('GET', 'POST'):
                raise MethodNotAllowedError('Method not allowed')
            try:
                path = urlsplit(target).path
            except ValueError:
                raise NotFoundError('Route not found') from None
            if method == 'GET':
                return self._get(path)
            data = self._read_object(headers, read_body)
            return self._post(path, data)
        except ApiError as error:
            return error_response(error)

    # ------------------------------------------------------------------ guards

    def _check_request(self, headers: dict[str, str]) -> None:
        if headers.get('host', '').lower() not in self.allowed_hosts:
            raise ForbiddenError('Unrecognized host')
        origin = headers.get('origin')
        if origin is not None and not self._origin_allowed(origin):
            raise ForbiddenError('Cross-origin request refused')
        if headers.get('sec-fetch-site', '').strip().lower() == 'cross-site':
            raise ForbiddenError('Cross-site request refused')

    def _origin_allowed(self, origin: str) -> bool:
        lowered = origin.strip().lower()
        return any(lowered.startswith(scheme) and lowered[len(scheme):] in self.allowed_hosts
                   for scheme in ('http://', 'https://'))

    def _read_object(self, headers: dict[str, str], read_body: Callable[[int], bytes]) -> dict[str, Any]:
        supplied = headers.get('x-workspace-token', '').encode('utf-8', 'replace')
        if not hmac.compare_digest(supplied, self._token):
            raise ForbiddenError(TOKEN_REFUSED)
        if headers.get('content-type', '').split(';')[0].strip().lower() != 'application/json':
            raise ValidationError(MESSAGES['json_required'])
        if 'transfer-encoding' in headers:
            raise ValidationError(MESSAGES['transfer_encoding'])
        length = parse_content_length(headers.get('content-length'))
        if length is None or not 1 <= length <= MAX_BODY_BYTES:
            raise ValidationError(MESSAGES['body_size'])
        body = read_body(length)
        if len(body) != length:
            raise ValidationError(MESSAGES['json_object'])
        return decode_object(body)

    # ------------------------------------------------------------------ routes

    def _get(self, path: str) -> Response:
        if path == '/api/workspace':
            return Response(*self.service.workspace())
        sample = _SAMPLE_ROUTE.fullmatch(path)
        if sample:
            return Response(*self.service.sample(sample.group(1)))
        run = _RUN_ROUTE.fullmatch(path)
        if run:
            return Response(*self.service.get_run(run.group(1)))
        raise NotFoundError('Route not found')

    def _post(self, path: str, data: dict[str, Any]) -> Response:
        if path == '/api/content':
            return Response(*self.service.save_content(data))
        if path == '/api/brands':
            return Response(*self.service.add_brand(data))
        if path == '/api/runs':
            return Response(*self.service.submit_run(data))
        raise NotFoundError('Route not found')


def make_handler(app: SocialApp) -> type[BaseHTTPRequestHandler]:
    class Handler(BaseHTTPRequestHandler):
        server_version = 'HQSocial'
        sys_version = ''
        protocol_version = 'HTTP/1.1'
        timeout = 30

        def _headers(self) -> dict[str, str]:
            headers: dict[str, str] = {}
            for name, value in self.headers.items():
                key = name.lower()
                headers[key] = f'{headers[key]}, {value}' if key in headers else value
            return headers

        def _serve(self, method: str) -> None:
            headers = self._headers()
            consumed = False

            def read_body(length: int) -> bytes:
                nonlocal consumed
                consumed = True
                return self.rfile.read(length)

            try:
                response = app.handle(method, self.path, headers, read_body)
            except Exception:  # noqa: BLE001 - never leak internals to the client
                sys.stderr.write(f"Unhandled error for {method} {self.path.split('?')[0][:200]}\n")
                response = Response(500, {'error': SERVER_ERROR})
            close = not consumed and self._discard_unread(headers)
            self._send(response, method, close=close)

        def _discard_unread(self, headers: dict[str, str]) -> bool:
            """Drop a request body the guards refused so a kept-alive connection stays in step.

            Returns True when the connection must close instead: chunked, malformed or oversized bodies.
            """
            if 'transfer-encoding' in headers:
                return True
            if 'content-length' not in headers:
                return False
            length = parse_content_length(headers['content-length'])
            if length is None or length > MAX_BODY_BYTES:
                return True
            while length > 0:
                chunk = self.rfile.read(min(length, DRAIN_CHUNK))
                if not chunk:
                    return True
                length -= len(chunk)
            return False

        def _send(self, response: Response, method: str, close: bool = False) -> None:
            self.send_response(response.status)
            for key, value in response.headers.items():
                self.send_header(key, value)
            self.send_header('Content-Length', str(len(response.body)))
            if close:
                self.send_header('Connection', 'close')
                self.close_connection = True
            self.end_headers()
            if method != 'HEAD':
                self.wfile.write(response.body)

        def send_error(self, code: int, message: str | None = None, explain: str | None = None) -> None:
            # Errors raised by http.server itself (bad request line, unknown method) keep the envelope.
            if self.request_version == 'HTTP/0.9':
                self.request_version = 'HTTP/1.1'  # http.server answers an unparsed request without a status line
            if code == 501:
                error: ApiError = MethodNotAllowedError('Method not allowed')
            else:
                error = ApiError(HTTP_ERRORS.get(code, 'Bad request'))
                error.status = code
            self._send(error_response(error), self.command or 'GET', close=True)

        def log_message(self, format: str, *args: Any) -> None:  # noqa: A002
            return None

        def do_GET(self) -> None:  # noqa: N802
            self._serve('GET')

        def do_POST(self) -> None:  # noqa: N802
            self._serve('POST')

        def do_HEAD(self) -> None:  # noqa: N802
            self._serve('HEAD')

        def do_PUT(self) -> None:  # noqa: N802
            self._serve('PUT')

        def do_PATCH(self) -> None:  # noqa: N802
            self._serve('PATCH')

        def do_DELETE(self) -> None:  # noqa: N802
            self._serve('DELETE')

        def do_OPTIONS(self) -> None:  # noqa: N802
            self._serve('OPTIONS')

    return Handler


def create_server(service: SocialService, host: str, port: int, extra_hosts: tuple[str, ...] = ()) -> ThreadingHTTPServer:
    """Bind a loopback server for ``service``. ``port`` 0 picks a free port; read it from ``server_address``."""
    server_class = ThreadingHTTPServerV6 if ':' in host else ThreadingHTTPServer
    server = server_class((host, port), BaseHTTPRequestHandler)
    app = SocialApp(service, host=host, port=server.server_address[1], extra_hosts=extra_hosts)
    server.RequestHandlerClass = make_handler(app)  # type: ignore[assignment]
    return server
