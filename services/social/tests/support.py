"""Shared test scaffolding.

Scratch lives under /tmp, one ``tempfile.mkdtemp(prefix='hq-social-')`` per test, and each exact directory
is removed by a cleanup that runs on success, failure and error. Nothing is written inside the repository.
Servers bind 127.0.0.1 on a free port; no other network is used.
"""

from __future__ import annotations

import http.client
import json
import os
import shutil
import socket
import sqlite3
import sys
import tempfile
import threading
import time
import unittest
from contextlib import contextmanager
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from social_service.server import create_server  # noqa: E402
from social_service.service import SocialService  # noqa: E402

FAKE_WORKER = [sys.executable, str(Path(__file__).resolve().with_name('fake_worker.py'))]
FINISHED_STATUSES = ('succeeded', 'failed', 'interrupted')


def make_scratch() -> Path:
    return Path(tempfile.mkdtemp(prefix='hq-social-', dir='/tmp' if os.path.isdir('/tmp') else None))


@contextmanager
def raw_db(path):
    """A direct SQLite connection for arranging or inspecting state; commits on success and always closes."""
    db = sqlite3.connect(path)
    try:
        with db:
            yield db
    finally:
        db.close()


class ScratchTestCase(unittest.TestCase):
    def setUp(self) -> None:
        super().setUp()
        self.scratch = make_scratch()
        self.addCleanup(shutil.rmtree, self.scratch, True)

    def new_directory(self, name: str = 'data') -> Path:
        path = self.scratch / name
        path.mkdir()
        return path


class Reply:
    def __init__(self, status: int, headers: dict[str, str], body: bytes):
        self.status = status
        self.headers = headers
        self.body = body

    @property
    def json(self) -> Any:
        return json.loads(self.body)

    @property
    def error(self) -> str | None:
        data = self.json
        return data.get('error') if isinstance(data, dict) else None


def read_reply(connection: http.client.HTTPConnection) -> Reply:
    response = connection.getresponse()
    body = response.read()
    return Reply(response.status, {key.lower(): value for key, value in response.getheaders()}, body)


class Harness:
    """A service and its loopback server in this process, with a small HTTP client."""

    def __init__(self, data_dir: Path, *, extra_hosts: tuple[str, ...] = (), **options: Any):
        options.setdefault('worker_command', FAKE_WORKER)
        self.service = SocialService(data_dir, **options)
        self.server = create_server(self.service, '127.0.0.1', 0, extra_hosts)
        self.port = self.server.server_address[1]
        self.thread = threading.Thread(target=self.server.serve_forever, kwargs={'poll_interval': 0.05}, daemon=True)
        self.thread.start()
        self._stopped = False

    @property
    def token(self) -> str:
        return self.service.token

    def stop(self) -> None:
        if self._stopped:
            return
        self._stopped = True
        self.server.shutdown()
        self.server.server_close()
        self.service.close()

    def connection(self) -> http.client.HTTPConnection:
        return http.client.HTTPConnection('127.0.0.1', self.port, timeout=20)

    def request(self, method: str, path: str, body: Any = None, *, headers: dict[str, str] | None = None,
                token: str | None | bool = True, raw: bytes | None = None, connection: http.client.HTTPConnection | None = None) -> Reply:
        sent = {'Accept': 'application/json', **(headers or {})}
        payload = raw
        if payload is None and body is not None:
            payload = json.dumps(body).encode('utf-8')
        if payload is not None:
            sent.setdefault('Content-Type', 'application/json')
        if token is True and method == 'POST':
            sent.setdefault('X-Workspace-Token', self.token)
        elif isinstance(token, str):
            sent['X-Workspace-Token'] = token
        owned = connection is None
        connection = connection or self.connection()
        try:
            connection.request(method, path, body=payload, headers=sent)
            return read_reply(connection)
        finally:
            if owned:
                connection.close()

    def get(self, path: str, **kwargs: Any) -> Reply:
        return self.request('GET', path, **kwargs)

    def post(self, path: str, body: Any = None, **kwargs: Any) -> Reply:
        return self.request('POST', path, body, **kwargs)

    def save(self, **fields: Any) -> dict[str, Any]:
        fields.setdefault('title', 'Draft')
        reply = self.post('/api/content', fields)
        assert reply.status in (200, 201), reply.body
        return reply.json

    def wait_run(self, run_id: str, timeout: float = 20.0) -> dict[str, Any]:
        deadline = time.monotonic() + timeout
        while True:
            record = self.get(f'/api/runs/{run_id}').json
            if record['status'] in FINISHED_STATUSES:
                return record
            if time.monotonic() > deadline:
                raise AssertionError(f'Run {run_id} still {record["status"]} after {timeout} s')
            time.sleep(0.02)

    def submit(self, tool: str = 'x-studio', data: dict[str, Any] | None = None, is_example: bool | None = None) -> Reply:
        body: dict[str, Any] = {'tool': tool, 'input': data if data is not None else {}}
        if is_example is not None:
            body['is_example'] = is_example
        return self.post('/api/runs', body)


class ServiceTestCase(ScratchTestCase):
    """A fresh service per test, using the fake worker unless ``service_options`` says otherwise."""

    service_options: dict[str, Any] = {}

    def setUp(self) -> None:
        super().setUp()
        self.data = self.new_directory()
        self.start_service()

    def start_service(self, **options: Any) -> Harness:
        merged = {**self.service_options, **options}
        self.harness = Harness(self.data, **merged)
        self.addCleanup(self.harness.stop)
        return self.harness

    def restart(self, **options: Any) -> Harness:
        self.harness.stop()
        return self.start_service(**options)

    @property
    def service(self) -> SocialService:
        return self.harness.service

    def get(self, path: str, **kwargs: Any) -> Reply:
        return self.harness.get(path, **kwargs)

    def post(self, path: str, body: Any = None, **kwargs: Any) -> Reply:
        return self.harness.post(path, body, **kwargs)


def raw_exchange(port: int, request: bytes, *, timeout: float = 10.0) -> tuple[int, dict[str, str], bytes]:
    """Send literal bytes and read one response to its end. For requests http.client will not build."""
    with socket.create_connection(('127.0.0.1', port), timeout=timeout) as connection:
        connection.sendall(request)
        data = b''
        while b'\r\n\r\n' not in data:
            chunk = connection.recv(65536)
            if not chunk:
                break
            data += chunk
        head, _, rest = data.partition(b'\r\n\r\n')
        lines = head.decode('latin-1').split('\r\n')
        status = int(lines[0].split()[1])
        headers = {}
        for line in lines[1:]:
            name, _, value = line.partition(':')
            headers[name.strip().lower()] = value.strip()
        remaining = int(headers.get('content-length', '0')) - len(rest)
        while remaining > 0:
            chunk = connection.recv(65536)
            if not chunk:
                break
            rest += chunk
            remaining -= len(chunk)
        return status, headers, rest
