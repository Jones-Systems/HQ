"""The workspace behind the HTTP layer: store, run queue, per-process token and advertised features."""

from __future__ import annotations

import secrets
import uuid
from collections.abc import Callable, Sequence
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from . import timebox, tools, validation
from .errors import NotFoundError
from .runner import RUN_TIMEOUT, FINISHED, RunManager
from .store import Store

DATABASE_NAME = 'hq-social.sqlite3'
RUNS_DIRECTORY = 'runs'
FEATURE_TIMEBOX = 'hq-editorial-timebox-v1'
FEATURE_REFERENCES = 'hq-references-v1'


class SocialService:
    """Owns one data directory. Methods return ``(status, payload)`` and raise ``ApiError`` for refusals."""

    def __init__(self, data_dir: Path, *, token: str | None = None, clock: Callable[[], datetime] | None = None,
                 new_id: Callable[[], str] | None = None, timezones: bool | None = None,
                 worker_command: Sequence[str] | None = None, run_timeout: float = RUN_TIMEOUT,
                 start_runs: bool = True):
        self.data_dir = Path(data_dir)
        self.token = token if token is not None else secrets.token_urlsafe(32)
        self._clock = clock or (lambda: datetime.now(timezone.utc))
        self._new_id = new_id or (lambda: uuid.uuid4().hex)
        self.timezones = timebox.timezone_data_available() if timezones is None else timezones
        self.store = Store(self.data_dir / DATABASE_NAME)
        try:
            self.store.interrupt_active(self.now())
            (self.data_dir / RUNS_DIRECTORY).mkdir(mode=0o700, exist_ok=True)
            self.runs = RunManager(self.store, self.data_dir / RUNS_DIRECTORY, clock=self.now, new_id=self._new_id,
                                   worker_command=worker_command, timeout=run_timeout)
            if start_runs:
                self.runs.start()
        except BaseException:
            self.store.close()
            raise

    def now(self) -> str:
        return self._clock().isoformat()

    def close(self) -> None:
        self.runs.stop()
        self.store.close()

    @property
    def features(self) -> list[str]:
        return ([FEATURE_TIMEBOX] if self.timezones else []) + [FEATURE_REFERENCES]

    # ------------------------------------------------------------------ routes

    def workspace(self) -> tuple[int, dict[str, Any]]:
        return 200, {
            'brands': self.store.brands(),
            'content': self.store.drafts(),
            'runs': self.store.recent_runs(),
            'tools': tools.catalog(),
            'features': self.features,
            'csrf': self.token,
        }

    def save_content(self, data: dict[str, Any]) -> tuple[int, dict[str, Any]]:
        draft = validation.check_draft(data, brand_ids=self.store.brand_ids(), timezones=self.timezones)
        saved = self.store.save_draft(draft, new_id=self._new_id, now=self.now(), timezones=self.timezones)
        return (200 if draft.target else 201), saved

    def add_brand(self, data: dict[str, Any]) -> tuple[int, dict[str, Any]]:
        name = validation.check_brand(data)
        return 201, self.store.add_brand(self._new_id(), name)

    def sample(self, tool: str) -> tuple[int, dict[str, Any]]:
        return 200, tools.sample(validation.check_tool(tool))

    def submit_run(self, data: dict[str, Any]) -> tuple[int, dict[str, Any]]:
        return 201, self.runs.submit(validation.check_run(data))

    def get_run(self, run_id: str) -> tuple[int, dict[str, Any]]:
        record = self.store.get_run(validation.check_run_id(run_id))
        if record is None:
            raise NotFoundError('Run not found')
        if record['status'] in FINISHED:
            output = self.runs.output(record['id'])
            if output is not None:
                record['output'] = output
        return 200, record
