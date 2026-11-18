"""SQLite storage: ``<data>/hq-social.sqlite3`` (spec.hq-social-backend#iface.service.001, Storage).

One connection serves every thread behind a lock, in autocommit mode with explicit transactions. The schema
is versioned with ``PRAGMA user_version`` and only moves forward by additive migrations; a store written by
a newer service is refused rather than guessed at.
"""

from __future__ import annotations

import json
import os
import sqlite3
import threading
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from pathlib import Path
from typing import Any

from . import timebox
from .errors import ConflictError
from .validation import DEFAULT_BRAND_ID, DEFAULT_BRAND_NAME, MESSAGES, UNSET, DraftInput

RUN_STATUSES = ('queued', 'running', 'succeeded', 'failed', 'interrupted')
ACTIVE_STATUSES = ('queued', 'running')
RUN_LIST_LIMIT = 200


class StoreError(Exception):
    """The data directory cannot be used (for example, it was written by a newer service)."""


def _v1(db: sqlite3.Connection) -> None:
    db.execute('CREATE TABLE brands (id TEXT PRIMARY KEY, name TEXT NOT NULL, project_id TEXT)')
    db.execute('''CREATE TABLE content (
        id TEXT PRIMARY KEY, title TEXT NOT NULL, body TEXT NOT NULL, brand_id TEXT NOT NULL,
        channel TEXT NOT NULL, planned_date TEXT NOT NULL, planning_slot TEXT,
        links TEXT NOT NULL DEFAULT '[]', archived INTEGER NOT NULL, version INTEGER NOT NULL,
        updated_at TEXT NOT NULL)''')
    db.execute('CREATE INDEX content_updated ON content (updated_at)')
    db.execute(f'''CREATE TABLE runs (
        id TEXT PRIMARY KEY, tool TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ({', '.join(repr(s) for s in RUN_STATUSES)})),
        is_example INTEGER NOT NULL, created_at TEXT NOT NULL, finished_at TEXT, error TEXT)''')
    db.execute('CREATE INDEX runs_created ON runs (created_at)')
    db.execute('CREATE INDEX runs_status ON runs (status)')


#: Forward-only, additive. Index N upgrades user_version N to N + 1.
MIGRATIONS: tuple[Callable[[sqlite3.Connection], None], ...] = (_v1,)


def _dumps(value: Any) -> str:
    return json.dumps(value, ensure_ascii=True, separators=(',', ':'), allow_nan=False)


def _draft(row: sqlite3.Row) -> dict[str, Any]:
    return {
        'id': row['id'], 'title': row['title'], 'body': row['body'], 'brand_id': row['brand_id'],
        'channel': row['channel'], 'planned_date': row['planned_date'],
        'planning_slot': json.loads(row['planning_slot']) if row['planning_slot'] else None,
        'archived': row['archived'], 'version': row['version'], 'updated_at': row['updated_at'],
        'links': json.loads(row['links']),
    }


def _run(row: sqlite3.Row) -> dict[str, Any]:
    return {key: row[key] for key in ('id', 'tool', 'status', 'is_example', 'created_at', 'finished_at', 'error')}


class Store:
    def __init__(self, path: Path):
        self.path = Path(path)
        self._lock = threading.RLock()
        if not self.path.exists():
            os.close(os.open(self.path, os.O_RDWR | os.O_CREAT, 0o600))
        self._db = sqlite3.connect(self.path, check_same_thread=False, isolation_level=None)
        self._db.row_factory = sqlite3.Row
        try:
            self._db.execute('PRAGMA busy_timeout = 5000')
            self._db.execute('PRAGMA journal_mode = WAL')
            self._db.execute('PRAGMA synchronous = FULL')
            self._migrate()
            with self._transaction():
                self._db.execute('INSERT OR IGNORE INTO brands (id, name, project_id) VALUES (?, ?, NULL)',
                                 (DEFAULT_BRAND_ID, DEFAULT_BRAND_NAME))
        except sqlite3.Error as exc:
            self._db.close()
            raise StoreError(f'The data directory could not be opened: {exc}') from exc
        except StoreError:
            self._db.close()
            raise

    @contextmanager
    def _transaction(self) -> Iterator[sqlite3.Connection]:
        with self._lock:
            self._db.execute('BEGIN IMMEDIATE')
            try:
                yield self._db
            except BaseException:
                self._db.execute('ROLLBACK')
                raise
            self._db.execute('COMMIT')

    def _migrate(self) -> None:
        version = self._db.execute('PRAGMA user_version').fetchone()[0]
        if version > len(MIGRATIONS):
            raise StoreError(f'This data directory uses schema {version}, newer than this service supports '
                             f'({len(MIGRATIONS)}). Upgrade the service; it will not downgrade data.')
        for index in range(version, len(MIGRATIONS)):
            with self._transaction():
                MIGRATIONS[index](self._db)
                self._db.execute(f'PRAGMA user_version = {index + 1}')

    @property
    def schema_version(self) -> int:
        with self._lock:
            return self._db.execute('PRAGMA user_version').fetchone()[0]

    def close(self) -> None:
        with self._lock:
            self._db.close()

    # ------------------------------------------------------------------ brands

    def brands(self) -> list[dict[str, Any]]:
        with self._lock:
            rows = self._db.execute(
                'SELECT id, name FROM brands ORDER BY name COLLATE NOCASE, name, id').fetchall()
        return [{'id': row['id'], 'name': row['name']} for row in rows]

    def brand_ids(self) -> set[str]:
        with self._lock:
            return {row['id'] for row in self._db.execute('SELECT id FROM brands')}

    def add_brand(self, brand_id: str, name: str) -> dict[str, Any]:
        with self._transaction():
            self._db.execute('INSERT INTO brands (id, name, project_id) VALUES (?, ?, NULL)', (brand_id, name))
        return {'id': brand_id, 'name': name}

    # ------------------------------------------------------------------ drafts

    def drafts(self) -> list[dict[str, Any]]:
        with self._lock:
            rows = self._db.execute('SELECT * FROM content ORDER BY updated_at DESC, rowid DESC').fetchall()
        return [_draft(row) for row in rows]

    def get_draft(self, draft_id: str) -> dict[str, Any] | None:
        with self._lock:
            row = self._db.execute('SELECT * FROM content WHERE id = ?', (draft_id,)).fetchone()
        return _draft(row) if row else None

    def save_draft(self, draft: DraftInput, *, new_id: Callable[[], str], now: str, timezones: bool) -> dict[str, Any]:
        """Create (no target) or update (id and version must both match). Returns the stored draft."""
        with self._transaction() as db:
            if draft.target is None:
                identifier = new_id()
                db.execute(
                    'INSERT INTO content (id, title, body, brand_id, channel, planned_date, planning_slot, links,'
                    ' archived, version, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)',
                    (identifier, draft.title, draft.body, draft.brand_id, draft.channel, draft.planned_date,
                     None if draft.slot is UNSET or draft.slot is None else _dumps(draft.slot),
                     _dumps([] if draft.links is UNSET else draft.links), draft.archived, now))
            else:
                identifier, version = draft.target
                stored = db.execute('SELECT * FROM content WHERE id = ?', (identifier,)).fetchone()
                if stored is None or stored['version'] != version:
                    raise ConflictError(MESSAGES['conflict'])
                if draft.slot is UNSET:
                    previous = json.loads(stored['planning_slot']) if stored['planning_slot'] else None
                    slot = timebox.revalidate_stored(previous, draft.planned_date, stored['planned_date'],
                                                     timezones=timezones)
                else:
                    slot = draft.slot
                links = stored['links'] if draft.links is UNSET else _dumps(draft.links)
                changed = db.execute(
                    'UPDATE content SET title = ?, body = ?, brand_id = ?, channel = ?, planned_date = ?,'
                    ' planning_slot = ?, links = ?, archived = ?, version = version + 1, updated_at = ?'
                    ' WHERE id = ? AND version = ?',
                    (draft.title, draft.body, draft.brand_id, draft.channel, draft.planned_date,
                     None if slot is None else _dumps(slot), links, draft.archived, now, identifier, version))
                if changed.rowcount != 1:
                    raise ConflictError(MESSAGES['conflict'])
            row = db.execute('SELECT * FROM content WHERE id = ?', (identifier,)).fetchone()
        return _draft(row)

    # -------------------------------------------------------------------- runs

    def recent_runs(self, limit: int = RUN_LIST_LIMIT) -> list[dict[str, Any]]:
        with self._lock:
            rows = self._db.execute(
                'SELECT * FROM runs ORDER BY created_at DESC, rowid DESC LIMIT ?', (limit,)).fetchall()
        return [_run(row) for row in rows]

    def get_run(self, run_id: str) -> dict[str, Any] | None:
        with self._lock:
            row = self._db.execute('SELECT * FROM runs WHERE id = ?', (run_id,)).fetchone()
        return _run(row) if row else None

    def active_run_count(self) -> int:
        with self._lock:
            return self._db.execute(
                "SELECT COUNT(*) FROM runs WHERE status IN ('queued', 'running')").fetchone()[0]

    def insert_run(self, run_id: str, tool: str, is_example: bool, created_at: str) -> dict[str, Any]:
        with self._transaction():
            self._db.execute(
                "INSERT INTO runs (id, tool, status, is_example, created_at, finished_at, error)"
                " VALUES (?, ?, 'queued', ?, ?, NULL, NULL)", (run_id, tool, 1 if is_example else 0, created_at))
        return {'id': run_id, 'tool': tool, 'status': 'queued', 'is_example': 1 if is_example else 0,
                'created_at': created_at, 'finished_at': None, 'error': None}

    def mark_running(self, run_id: str) -> None:
        with self._transaction():
            self._db.execute("UPDATE runs SET status = 'running' WHERE id = ? AND status = 'queued'", (run_id,))

    def finish_run(self, run_id: str, status: str, error: str | None, finished_at: str) -> None:
        with self._transaction():
            self._db.execute(
                "UPDATE runs SET status = ?, error = ?, finished_at = ?"
                " WHERE id = ? AND status IN ('queued', 'running')", (status, error, finished_at, run_id))

    def interrupt_active(self, finished_at: str) -> int:
        """Mark every queued or running run interrupted. Nothing is retried."""
        with self._transaction():
            cursor = self._db.execute(
                "UPDATE runs SET status = 'interrupted', error = ?, finished_at = ?"
                " WHERE status IN ('queued', 'running')", (MESSAGES['interrupted'], finished_at))
        return cursor.rowcount
