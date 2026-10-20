"""SQLite-backed authoritative planning store.

Concurrency and durability contract:
- Every mutation runs in one ``BEGIN IMMEDIATE`` transaction under a process
  lock, with ``synchronous=FULL``, so an acknowledged change survives restart.
- Items carry a ``revision``; a mutation must name the revision it was based
  on and is rejected with 409 when stale. Board order (``position``) is
  owned by the store and renumbered inside the same transaction as a move.
- A mutation may carry a client ``request_id``. Replaying the same id with
  the same body returns the recorded response instead of applying twice, so a
  retained response can be recovered; a different body under a known id is
  rejected. Unknown outcomes use replay_request to check the eviction floor
  before any resend, under this single-process store lock.
- Replacement imports write a full backup file before the transaction starts
  and abort if the backup cannot be written.
"""

from __future__ import annotations

import datetime as _dt
import json
import os
import re
import sqlite3
import threading
from pathlib import Path

from . import examples as _examples
from .dates import describe as describe_date
from .dates import new_id, with_derived
from .validation import (
    DEFAULT_SETTINGS,
    EDITABLE_FIELDS,
    STATUSES,
    ValidationError,
    is_item_id,
    is_timestamp,
    normalize_batch,
    normalize_fields,
    normalize_settings,
)

SCHEMA_VERSION = 1
EXPORT_FORMAT = "jones-planning-export"
EXPORT_VERSION = 1
MAX_IMPORT_ITEMS = 5_000
MAX_HISTORY_PER_ITEM = 200
MAX_REMEMBERED_REQUESTS = 2_000
POSITION_STEP = 1024
HISTORY_ACTIONS = ("created", "updated", "moved", "reordered", "archived", "restored",
                   "reviewed", "imported")
BACKUP_RE = re.compile(r"^backup-\d{8}T\d{6}Z(-\d{1,3})?\.json$")
MAX_BACKUP_BYTES = 50 * 1024 * 1024
_ENUM_FIELDS = ("title", "kind", "status", "motivation", "horizon", "priority", "area")
_JSON_FIELDS = {"next_steps": "next_steps", "references": "refs", "dates": "dates"}


class StoreError(Exception):
    """An expected request failure with an HTTP-like status and stable code."""

    def __init__(self, status: int, code: str, message: str, **extra):
        super().__init__(message)
        self.status = status
        self.code = code
        self.message = message
        self.extra = extra

    def payload(self) -> dict:
        return {"error": self.code, "message": self.message, **self.extra}


def utc_now() -> str:
    now = _dt.datetime.now(_dt.timezone.utc)
    return now.strftime("%Y-%m-%dT%H:%M:%S.") + f"{now.microsecond // 1000:03d}Z"


_SCHEMA = """
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS items (
    id TEXT PRIMARY KEY,
    revision INTEGER NOT NULL,
    title TEXT NOT NULL,
    kind TEXT NOT NULL,
    status TEXT NOT NULL,
    motivation TEXT,
    horizon TEXT,
    priority TEXT,
    area TEXT,
    notes TEXT NOT NULL DEFAULT '',
    next_steps TEXT NOT NULL DEFAULT '[]',
    refs TEXT NOT NULL DEFAULT '[]',
    dates TEXT NOT NULL DEFAULT '[]',
    position INTEGER NOT NULL,
    is_example INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    archived_at TEXT,
    reviewed_at TEXT
);
CREATE INDEX IF NOT EXISTS items_status_position ON items (status, position);
CREATE TABLE IF NOT EXISTS history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    item_id TEXT NOT NULL,
    at TEXT NOT NULL,
    action TEXT NOT NULL,
    detail TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS history_item ON history (item_id, id);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS requests (
    request_id TEXT PRIMARY KEY,
    fingerprint TEXT NOT NULL,
    status INTEGER NOT NULL,
    response TEXT NOT NULL,
    created_at TEXT NOT NULL
);
"""

_ORDER = "ORDER BY position, created_at, id"


class Store:
    def __init__(self, path: str | os.PathLike):
        self.path = Path(path)
        self.backup_dir = self.path.parent / f"{self.path.stem}-backups"
        self._lock = threading.RLock()
        self._conn = sqlite3.connect(str(self.path), isolation_level=None, check_same_thread=False)
        self._conn.row_factory = sqlite3.Row
        self._conn.execute("PRAGMA journal_mode=WAL")
        self._conn.execute("PRAGMA synchronous=FULL")
        self._conn.execute("PRAGMA busy_timeout=5000")
        with self._lock:
            self._conn.executescript(_SCHEMA)
            row = self._conn.execute("SELECT value FROM meta WHERE key='schema_version'").fetchone()
            if row is None:
                self._conn.execute("INSERT INTO meta VALUES ('schema_version', ?)", (str(SCHEMA_VERSION),))
                self._conn.execute("INSERT OR IGNORE INTO meta VALUES ('state_version', '0')")
            elif int(row["value"]) != SCHEMA_VERSION:
                raise RuntimeError(f"Unsupported planning store schema {row['value']}.")
            count = self._conn.execute("SELECT COUNT(*) FROM requests").fetchone()[0]
            floor = 0 if count < MAX_REMEMBERED_REQUESTS else self._version(self._conn)
            self._conn.execute("INSERT OR IGNORE INTO meta VALUES ('request_evicted_through_version', ?)",
                               (str(floor),))

    def close(self) -> None:
        with self._lock:
            self._conn.close()

    # ------------------------------------------------------------------ reads

    def version(self) -> int:
        with self._lock:
            return self._version(self._conn)

    def api_version(self) -> dict:
        with self._lock:
            return {"state_version": self._version(self._conn), **self._capabilities(self._conn)}

    def _capabilities(self, conn) -> dict:
        floor = int(conn.execute(
            "SELECT value FROM meta WHERE key='request_evicted_through_version'").fetchone()[0])
        return {"api": 2, "features": ["items.batch_create", "requests.replay"],
                "request_retention": {"max": MAX_REMEMBERED_REQUESTS, "evicted_through_version": floor}}

    def snapshot(self) -> dict:
        with self._lock:
            rows = self._conn.execute(f"SELECT * FROM items {_ORDER}").fetchall()
            return {
                "items": [self._row_to_item(r) for r in rows],
                "settings": self._settings(self._conn),
                "state_version": self._version(self._conn),
                "server_time": utc_now(),
                **self._capabilities(self._conn),
            }

    def get_item(self, item_id: str) -> dict:
        with self._lock:
            row = self._conn.execute("SELECT * FROM items WHERE id=?", (item_id,)).fetchone()
            if row is None:
                raise StoreError(404, "not_found", "That item does not exist.")
            return self._row_to_item(row)

    def history(self, item_id: str, limit: int = 100) -> list[dict]:
        with self._lock:
            rows = self._conn.execute(
                "SELECT at, action, detail FROM history WHERE item_id=? ORDER BY id DESC LIMIT ?",
                (item_id, limit),
            ).fetchall()
        return [{"at": r["at"], "action": r["action"], "detail": json.loads(r["detail"])} for r in rows]

    # -------------------------------------------------------------- mutations

    def create_item(self, fields: object, request_id: str | None = None, fingerprint: str = "") -> tuple:
        values = normalize_fields(fields, creating=True)

        def apply(cur):
            return 201, {"item": self._insert_item(cur, values)}

        return self._mutate(request_id, fingerprint, apply)

    def create_batch(self, body: object, request_id: str | None = None, fingerprint: str = "") -> tuple:
        values, dry_run = normalize_batch(body)
        if dry_run:
            return 200, {"valid": True, "count": len(values), "dry_run": True, "state_version": self.version()}, False

        def apply(cur):
            # Insert from the end so each status retains input order at its top.
            items = [self._insert_item(cur, fields) for fields in reversed(values)]
            return 201, {"items": list(reversed(items))}

        return self._mutate(request_id, fingerprint, apply)

    def _insert_item(self, cur, values: dict) -> dict:
        now = utc_now()
        item_id = new_id()
        position = self._edge_position(cur, values["status"], top=True)
        cur.execute(
            """INSERT INTO items (id, revision, title, kind, status, motivation, horizon,
               priority, area, notes, next_steps, refs, dates, position, is_example,
               created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,0,?,?)""",
            (item_id, 1, values["title"], values["kind"], values["status"], values["motivation"],
             values["horizon"], values["priority"], values["area"], values["notes"],
             json.dumps(values["next_steps"]), json.dumps(values["references"]),
             json.dumps(values["dates"]), position, now, now),
        )
        self._log(cur, item_id, "created", {"fields": [], "changes": {"status": [None, values["status"]]}})
        return self._load(cur, item_id)

    def update_item(self, item_id: str, revision: object, patch: object,
                    request_id: str | None = None, fingerprint: str = "") -> tuple:
        values = normalize_fields(patch, creating=False)

        def apply(cur):
            current = self._guard(cur, item_id, revision)
            changes, fields = {}, []
            for key, new in values.items():
                old = current[key]
                if old != new:
                    fields.append(key)
                    if key in _ENUM_FIELDS:
                        changes[key] = [old, new]
            if not fields:
                return 200, {"item": current, "changed": []}
            sets, params = [], []
            for key in fields:
                column = _JSON_FIELDS.get(key, key)
                value = values[key]
                sets.append(f"{column}=?")
                params.append(json.dumps(value) if key in _JSON_FIELDS else value)
            if "status" in fields:
                sets.append("position=?")
                params.append(self._edge_position(cur, values["status"], top=True))
            now = utc_now()
            sets += ["revision=revision+1", "updated_at=?"]
            params += [now, item_id]
            cur.execute(f"UPDATE items SET {', '.join(sets)} WHERE id=?", params)
            detail = {"fields": fields, "changes": changes}
            if "dates" in fields:
                detail["dates"] = _date_changes(current["dates"], values["dates"])
            self._log(cur, item_id, "updated", detail)
            return 200, {"item": self._load(cur, item_id), "changed": fields}

        return self._mutate(request_id, fingerprint, apply)

    def move_item(self, item_id: str, revision: object, status: object, *, after_id=None,
                  before_id=None, place: object = "bottom", request_id: str | None = None,
                  fingerprint: str = "") -> tuple:
        """Place an item in ``status`` immediately after/before an anchor or at an edge.

        Anchors refer to the complete stored order of the target status, so a
        drop computed from a filtered view lands next to the visible neighbour
        it was dropped beside while hidden items keep their relative order.
        """
        if status not in STATUSES:
            raise StoreError(400, "invalid", "Unknown status.", errors=[{"field": "status", "message": "Unknown status."}])
        if after_id is not None and before_id is not None:
            raise StoreError(400, "invalid", "Give either after_id or before_id, not both.")
        if place not in ("top", "bottom"):
            raise StoreError(400, "invalid", "place must be top or bottom.")

        def apply(cur):
            current = self._guard(cur, item_id, revision)
            ids = [r["id"] for r in cur.execute(
                f"SELECT id FROM items WHERE status=? AND id<>? {_ORDER}", (status, item_id))]
            anchor = after_id if after_id is not None else before_id
            if anchor is not None:
                if anchor not in ids:
                    raise StoreError(409, "order_conflict",
                                     "The board changed since it was loaded. Refresh and try again.")
                index = ids.index(anchor) + (1 if after_id is not None else 0)
            else:
                index = 0 if place == "top" else len(ids)
            old_ids = [r["id"] for r in cur.execute(
                f"SELECT id FROM items WHERE status=? {_ORDER}", (current["status"],))]
            ids.insert(index, item_id)
            for i, other in enumerate(ids):
                cur.execute("UPDATE items SET position=? WHERE id=?", ((i + 1) * POSITION_STEP, other))
            if status == current["status"] and old_ids == ids:
                return 200, {"item": self._load(cur, item_id), "changed": []}
            now = utc_now()
            cur.execute("UPDATE items SET status=?, revision=revision+1, updated_at=? WHERE id=?",
                        (status, now, item_id))
            if status != current["status"]:
                self._log(cur, item_id, "moved", {"fields": ["status"],
                                                   "changes": {"status": [current["status"], status]}})
            else:
                self._log(cur, item_id, "reordered", {"fields": ["position"], "changes": {}})
            return 200, {"item": self._load(cur, item_id), "changed": ["status", "position"]}

        return self._mutate(request_id, fingerprint, apply)

    def set_archived(self, item_id: str, revision: object, archived: bool,
                     request_id: str | None = None, fingerprint: str = "") -> tuple:
        def apply(cur):
            current = self._guard(cur, item_id, revision)
            if bool(current["archived_at"]) == archived:
                return 200, {"item": current, "changed": []}
            now = utc_now()
            cur.execute("UPDATE items SET archived_at=?, revision=revision+1, updated_at=? WHERE id=?",
                        (now if archived else None, now, item_id))
            self._log(cur, item_id, "archived" if archived else "restored", {"fields": ["archived"], "changes": {}})
            return 200, {"item": self._load(cur, item_id), "changed": ["archived"]}

        return self._mutate(request_id, fingerprint, apply)

    def mark_reviewed(self, item_id: str, revision: object, request_id: str | None = None,
                      fingerprint: str = "") -> tuple:
        def apply(cur):
            self._guard(cur, item_id, revision)
            now = utc_now()
            cur.execute("UPDATE items SET reviewed_at=?, revision=revision+1 WHERE id=?", (now, item_id))
            self._log(cur, item_id, "reviewed", {"fields": [], "changes": {}})
            return 200, {"item": self._load(cur, item_id), "changed": ["reviewed_at"]}

        return self._mutate(request_id, fingerprint, apply)

    def update_settings(self, raw: object, request_id: str | None = None, fingerprint: str = "") -> tuple:
        def apply(cur):
            merged = normalize_settings(raw, self._settings(cur))
            for key, value in merged.items():
                cur.execute("INSERT OR REPLACE INTO settings VALUES (?, ?)", (key, json.dumps(value)))
            return 200, {"settings": merged}

        return self._mutate(request_id, fingerprint, apply)

    def load_examples(self, request_id: str | None = None, fingerprint: str = "") -> tuple:
        def apply(cur):
            if cur.execute("SELECT 1 FROM items WHERE is_example=1 LIMIT 1").fetchone():
                raise StoreError(409, "examples_present", "Example items are already loaded.")
            now = utc_now()
            today = _dt.date.today()
            created = 0
            for raw in _examples.build(today):
                values = normalize_fields(raw, creating=True)
                item_id = new_id()
                position = self._edge_position(cur, values["status"], top=False)
                cur.execute(
                    """INSERT INTO items (id, revision, title, kind, status, motivation, horizon,
                       priority, area, notes, next_steps, refs, dates, position, is_example,
                       created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,?,?)""",
                    (item_id, 1, values["title"], values["kind"], values["status"], values["motivation"],
                     values["horizon"], values["priority"], values["area"], values["notes"],
                     json.dumps(values["next_steps"]), json.dumps(values["references"]),
                     json.dumps(values["dates"]), position, now, now),
                )
                self._log(cur, item_id, "created", {"fields": [], "changes": {}, "example": True})
                created += 1
            return 201, {"created": created}

        return self._mutate(request_id, fingerprint, apply)

    def remove_examples(self, request_id: str | None = None, fingerprint: str = "") -> tuple:
        def apply(cur):
            ids = [r["id"] for r in cur.execute("SELECT id FROM items WHERE is_example=1")]
            for item_id in ids:
                cur.execute("DELETE FROM history WHERE item_id=?", (item_id,))
            cur.execute("DELETE FROM items WHERE is_example=1")
            return 200, {"removed": len(ids)}

        return self._mutate(request_id, fingerprint, apply)

    # ------------------------------------------------------- export / import

    def export(self) -> dict:
        with self._lock:
            rows = self._conn.execute(f"SELECT * FROM items {_ORDER}").fetchall()
            history = self._conn.execute("SELECT item_id, at, action, detail FROM history ORDER BY id").fetchall()
            return {
                "format": EXPORT_FORMAT,
                "version": EXPORT_VERSION,
                "exported_at": utc_now(),
                "state_version": self._version(self._conn),
                "settings": self._settings(self._conn),
                "items": [self._row_to_item(r, derived=False) for r in rows],
                "history": [{"item_id": h["item_id"], "at": h["at"], "action": h["action"],
                             "detail": json.loads(h["detail"])} for h in history],
            }

    def export_markdown(self) -> str:
        data = self.export()
        labels = {"on_hold": "On hold"}
        lines = ["# Planning export", "", f"Exported {data['exported_at']}. Archived items are listed last.", ""]
        live = [i for i in data["items"] if not i["archived_at"]]
        archived = [i for i in data["items"] if i["archived_at"]]
        for status in STATUSES:
            group = [i for i in live if i["status"] == status]
            if not group:
                continue
            lines += [f"## {labels.get(status, status.capitalize())} ({len(group)})", ""]
            for item in group:
                lines += _markdown_item(item)
        if archived:
            lines += [f"## Archived ({len(archived)})", ""]
            for item in archived:
                lines += _markdown_item(item)
        return "\n".join(lines).rstrip() + "\n"

    def preview_import(self, data: object) -> dict:
        items, _history, settings = self._validate_import(data)
        with self._lock:
            existing = {r["id"] for r in self._conn.execute("SELECT id FROM items")}
            current_count = len(existing)
        incoming = {i["id"] for i in items}
        return {
            "valid": True,
            "incoming": len(items),
            "incoming_archived": sum(1 for i in items if i["archived_at"]),
            "current": current_count,
            "new_ids": len(incoming - existing),
            "existing_ids": len(incoming & existing),
            "has_settings": settings is not None,
        }

    def import_data(self, data: object, mode: object, confirm: object = None,
                    request_id: str | None = None, fingerprint: str = "") -> tuple:
        if mode not in ("merge", "replace"):
            raise StoreError(400, "invalid", "mode must be merge or replace.")
        if mode == "replace" and confirm != "replace":
            raise StoreError(400, "confirmation_required",
                             "Replacing all items requires explicit confirmation.")
        items, history, settings = self._validate_import(data)
        with self._lock:
            replay = self._replay(self._conn, request_id, fingerprint)
            if replay is not None:
                return replay
            backup = self._write_backup() if mode == "replace" else None

            def apply(cur):
                if mode == "replace":
                    cur.execute("DELETE FROM history")
                    cur.execute("DELETE FROM items")
                    to_insert = items
                    if settings is not None:
                        cur.execute("DELETE FROM settings")
                        for key, value in settings.items():
                            cur.execute("INSERT INTO settings VALUES (?, ?)", (key, json.dumps(value)))
                else:
                    existing = {r["id"] for r in cur.execute("SELECT id FROM items")}
                    to_insert = [i for i in items if i["id"] not in existing]
                    edges = {}
                    for item in to_insert:
                        if item["status"] not in edges:
                            edges[item["status"]] = self._edge_position(cur, item["status"], top=False)
                        else:
                            edges[item["status"]] += POSITION_STEP
                        item["position"] = edges[item["status"]]
                inserted = {i["id"] for i in to_insert}
                for item in to_insert:
                    self._insert_full(cur, item)
                for entry in history:
                    if entry["item_id"] in inserted:
                        cur.execute("INSERT INTO history (item_id, at, action, detail) VALUES (?,?,?,?)",
                                    (entry["item_id"], entry["at"], entry["action"], json.dumps(entry["detail"])))
                return 200, {"mode": mode, "imported": len(to_insert),
                             "skipped": len(items) - len(to_insert), "backup": backup}

            return self._mutate(request_id, fingerprint, apply)

    def list_backups(self) -> list[dict]:
        if not self.backup_dir.is_dir():
            return []
        out = []
        for entry in sorted(self.backup_dir.iterdir(), reverse=True):
            if BACKUP_RE.match(entry.name) and entry.is_file():
                out.append({"name": entry.name, "bytes": entry.stat().st_size})
        return out[:50]

    def restore_backup(self, name: object, confirm: object, request_id: str | None = None,
                       fingerprint: str = "") -> tuple:
        if not isinstance(name, str) or not BACKUP_RE.match(name):
            raise StoreError(400, "invalid", "Unknown backup name.")
        path = self.backup_dir / name
        if not path.is_file() or path.stat().st_size > MAX_BACKUP_BYTES:
            raise StoreError(404, "not_found", "That backup does not exist.")
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            raise StoreError(422, "invalid_backup", "That backup could not be read.") from None
        return self.import_data(data, "replace", confirm, request_id, fingerprint)

    # --------------------------------------------------------------- helpers

    def _mutate(self, request_id, fingerprint, apply) -> tuple:
        """Run ``apply`` atomically; returns (status, payload, replayed)."""
        with self._lock:
            replay = self._replay(self._conn, request_id, fingerprint)
            if replay is not None:
                return replay
            cur = self._conn.cursor()
            cur.execute("BEGIN IMMEDIATE")
            try:
                status, payload = apply(cur)
                cur.execute("UPDATE meta SET value=CAST(value AS INTEGER)+1 WHERE key='state_version'")
                payload["state_version"] = self._version(cur)
                if request_id:
                    cur.execute("INSERT INTO requests VALUES (?,?,?,?,?)",
                                (request_id, fingerprint, status, json.dumps(payload), utc_now()))
                    evicted = cur.execute(
                        """SELECT MAX(CAST(json_extract(response, '$.state_version') AS INTEGER))
                           FROM requests WHERE request_id NOT IN
                           (SELECT request_id FROM requests ORDER BY created_at DESC, rowid DESC LIMIT ?)""",
                        (MAX_REMEMBERED_REQUESTS,)).fetchone()[0]
                    if evicted is not None:
                        cur.execute("""UPDATE meta SET value=MAX(CAST(value AS INTEGER), ?)
                                       WHERE key='request_evicted_through_version'""", (evicted,))
                    cur.execute(
                        """DELETE FROM requests WHERE request_id NOT IN
                           (SELECT request_id FROM requests ORDER BY created_at DESC, rowid DESC LIMIT ?)""",
                        (MAX_REMEMBERED_REQUESTS,))
                cur.execute("COMMIT")
            except BaseException:
                cur.execute("ROLLBACK")
                raise
            return status, payload, False

    def replay_request(self, request_id, fingerprint, sent_after_version, mode, apply) -> tuple:
        # This lock also covers normal mutations and stays held through resend.
        with self._lock:
            if (sent_after_version is not None and
                    (not isinstance(sent_after_version, int) or isinstance(sent_after_version, bool)
                     or not 0 <= sent_after_version <= self._version(self._conn))):
                raise StoreError(400, "invalid", "sent_after_version must name a nonnegative observed version.")
            if mode not in ("lookup", "resend"):
                raise StoreError(400, "invalid", "mode must be lookup or resend.")
            replay = self._replay(self._conn, request_id, fingerprint)
            if replay is not None:
                status, response, _ = replay
                return 200, {"outcome": "replayed", "status": status, "response": response}, True
            floor = self._capabilities(self._conn)["request_retention"]["evicted_through_version"]
            if sent_after_version is None or floor > sent_after_version:
                raise StoreError(409, "replay_indeterminate", "Read back before attempting another change.",
                                 sent_after_version=sent_after_version, evicted_through_version=floor)
            if mode == "lookup":
                return 200, {"outcome": "not_applied"}, False
            status, response, replayed = apply()
            return 200, {"outcome": "replayed" if replayed else "applied_now",
                         "status": status, "response": response}, replayed

    def _replay(self, conn, request_id, fingerprint):
        if not request_id:
            return None
        row = conn.execute("SELECT fingerprint, status, response FROM requests WHERE request_id=?",
                           (request_id,)).fetchone()
        if row is None:
            return None
        if row["fingerprint"] != fingerprint:
            raise StoreError(422, "request_id_reused", "This request id was already used for a different change.")
        return row["status"], json.loads(row["response"]), True

    def _guard(self, cur, item_id: str, revision: object) -> dict:
        if not isinstance(revision, int) or isinstance(revision, bool):
            raise StoreError(400, "invalid", "A numeric base revision is required.")
        row = cur.execute("SELECT * FROM items WHERE id=?", (item_id,)).fetchone()
        if row is None:
            raise StoreError(404, "not_found", "That item does not exist.")
        current = self._row_to_item(row)
        if row["revision"] != revision:
            raise StoreError(409, "revision_conflict",
                             "This item changed since you loaded it.", current=current)
        return current

    def _load(self, cur, item_id: str) -> dict:
        return self._row_to_item(cur.execute("SELECT * FROM items WHERE id=?", (item_id,)).fetchone())

    def _edge_position(self, cur, status: str, *, top: bool) -> int:
        fn = "MIN" if top else "MAX"
        row = cur.execute(f"SELECT {fn}(position) AS p FROM items WHERE status=?", (status,)).fetchone()
        if row["p"] is None:
            return POSITION_STEP
        return row["p"] - POSITION_STEP if top else row["p"] + POSITION_STEP

    def _log(self, cur, item_id: str, action: str, detail: dict) -> None:
        cur.execute("INSERT INTO history (item_id, at, action, detail) VALUES (?,?,?,?)",
                    (item_id, utc_now(), action, json.dumps(detail)))
        cur.execute(
            """DELETE FROM history WHERE item_id=? AND id NOT IN
               (SELECT id FROM history WHERE item_id=? ORDER BY id DESC LIMIT ?)""",
            (item_id, item_id, MAX_HISTORY_PER_ITEM))

    @staticmethod
    def _version(conn) -> int:
        return int(conn.execute("SELECT value FROM meta WHERE key='state_version'").fetchone()[0])

    @staticmethod
    def _settings(conn) -> dict:
        out = dict(DEFAULT_SETTINGS)
        for row in conn.execute("SELECT key, value FROM settings"):
            if row[0] in out:
                out[row[0]] = json.loads(row[1])
        return out

    @staticmethod
    def _row_to_item(row, derived: bool = True) -> dict:
        dates = json.loads(row["dates"])
        return {
            "id": row["id"],
            "revision": row["revision"],
            "title": row["title"],
            "kind": row["kind"],
            "status": row["status"],
            "motivation": row["motivation"],
            "horizon": row["horizon"],
            "priority": row["priority"],
            "area": row["area"],
            "notes": row["notes"],
            "next_steps": json.loads(row["next_steps"]),
            "references": json.loads(row["refs"]),
            "dates": [with_derived(d) for d in dates] if derived else dates,
            "position": row["position"],
            "is_example": bool(row["is_example"]),
            "created_at": row["created_at"],
            "updated_at": row["updated_at"],
            "archived_at": row["archived_at"],
            "reviewed_at": row["reviewed_at"],
        }

    def _insert_full(self, cur, item: dict) -> None:
        cur.execute(
            """INSERT INTO items (id, revision, title, kind, status, motivation, horizon, priority,
               area, notes, next_steps, refs, dates, position, is_example, created_at, updated_at,
               archived_at, reviewed_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (item["id"], item["revision"], item["title"], item["kind"], item["status"],
             item["motivation"], item["horizon"], item["priority"], item["area"], item["notes"],
             json.dumps(item["next_steps"]), json.dumps(item["references"]), json.dumps(item["dates"]),
             item["position"], int(item["is_example"]), item["created_at"], item["updated_at"],
             item["archived_at"], item["reviewed_at"]),
        )

    def _validate_import(self, data: object) -> tuple[list, list, dict | None]:
        """Validate a whole export before anything is written."""
        if not isinstance(data, dict):
            raise StoreError(422, "invalid_import", "The file is not a planning export.")
        if data.get("format") != EXPORT_FORMAT or data.get("version") != EXPORT_VERSION:
            raise StoreError(422, "invalid_import",
                             f"Expected a {EXPORT_FORMAT} version {EXPORT_VERSION} file.")
        raw_items = data.get("items")
        if not isinstance(raw_items, list):
            raise StoreError(422, "invalid_import", "The export has no item list.")
        if len(raw_items) > MAX_IMPORT_ITEMS:
            raise StoreError(422, "invalid_import", f"Imports are limited to {MAX_IMPORT_ITEMS} items.")
        problems, items, seen = [], [], set()
        meta_keys = {"id", "revision", "position", "is_example", "created_at", "updated_at",
                     "archived_at", "reviewed_at"}
        for index, raw in enumerate(raw_items):
            label = f"Item {index + 1}"
            if not isinstance(raw, dict):
                problems.append(f"{label}: not an object.")
                continue
            unknown = set(raw) - meta_keys - set(EDITABLE_FIELDS)
            if unknown:
                problems.append(f"{label}: unknown field(s) {', '.join(sorted(unknown))}.")
                continue
            try:
                values = normalize_fields({k: raw[k] for k in EDITABLE_FIELDS if k in raw}, creating=True)
            except ValidationError as exc:
                problems.append(f"{label}: {exc}")
                continue
            item_id = raw.get("id")
            if not is_item_id(item_id) or item_id in seen:
                problems.append(f"{label}: missing, malformed or duplicate id.")
                continue
            revision, position = raw.get("revision"), raw.get("position")
            if (not isinstance(revision, int) or isinstance(revision, bool) or revision < 1
                    or not isinstance(position, int) or isinstance(position, bool)
                    or abs(position) > 2**53):
                problems.append(f"{label}: revision/position must be whole numbers.")
                continue
            if not all(is_timestamp(raw.get(k)) for k in ("created_at", "updated_at")):
                problems.append(f"{label}: created_at/updated_at must be UTC timestamps.")
                continue
            if any(raw.get(k) is not None and not is_timestamp(raw.get(k)) for k in ("archived_at", "reviewed_at")):
                problems.append(f"{label}: archived_at/reviewed_at must be UTC timestamps or null.")
                continue
            if not isinstance(raw.get("is_example", False), bool):
                problems.append(f"{label}: is_example must be true or false.")
                continue
            seen.add(item_id)
            values.update(id=item_id, revision=revision, position=position,
                          is_example=raw.get("is_example", False), created_at=raw["created_at"],
                          updated_at=raw["updated_at"], archived_at=raw.get("archived_at"),
                          reviewed_at=raw.get("reviewed_at"))
            items.append(values)
            if len(problems) >= 20:
                break
        history = []
        raw_history = data.get("history", [])
        if not isinstance(raw_history, list):
            problems.append("history must be a list.")
        else:
            for index, entry in enumerate(raw_history):
                if (not isinstance(entry, dict) or entry.get("item_id") not in seen
                        or entry.get("action") not in HISTORY_ACTIONS
                        or not is_timestamp(entry.get("at")) or not isinstance(entry.get("detail"), dict)):
                    problems.append(f"History entry {index + 1} is malformed.")
                    break
                history.append({k: entry[k] for k in ("item_id", "at", "action", "detail")})
        settings = None
        if data.get("settings") is not None:
            try:
                settings = normalize_settings(data["settings"], dict(DEFAULT_SETTINGS))
            except ValidationError as exc:
                problems.append(f"settings: {exc}")
        if problems:
            raise StoreError(422, "invalid_import", "The file failed validation; nothing was changed.",
                             problems=problems[:20])
        return items, history, settings

    def _write_backup(self) -> str:
        data = json.dumps(self.export(), indent=1).encode("utf-8")
        self.backup_dir.mkdir(mode=0o700, exist_ok=True)
        stamp = _dt.datetime.now(_dt.timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        name = f"backup-{stamp}.json"
        suffix = 1
        while (self.backup_dir / name).exists():
            name = f"backup-{stamp}-{suffix}.json"
            suffix += 1
        final = self.backup_dir / name
        temp = self.backup_dir / f".{name}.partial"
        try:
            with open(temp, "wb") as handle:
                handle.write(data)
                handle.flush()
                os.fsync(handle.fileno())
            os.replace(temp, final)
            dir_fd = os.open(self.backup_dir, os.O_RDONLY)
            try:
                os.fsync(dir_fd)
            finally:
                os.close(dir_fd)
        except OSError as exc:
            if temp.exists():
                temp.unlink()
            raise StoreError(500, "backup_failed",
                             "Could not write a safety backup; nothing was replaced.") from exc
        return name


def _date_changes(old: list, new: list) -> list[str]:
    old_by_id = {d["id"]: d for d in old}
    new_by_id = {d["id"]: d for d in new}
    out = []
    for entry in new:
        before = old_by_id.get(entry["id"])
        strip = lambda d: {k: d.get(k) for k in ("kind", "precision", "value", "time", "end_time", "tz", "note")}
        if before is None:
            out.append(f"added {describe_date(entry)}")
        elif strip(before) != strip(entry):
            out.append(f"{describe_date(before)} → {describe_date(entry)}")
    for entry in old:
        if entry["id"] not in new_by_id:
            out.append(f"removed {describe_date(entry)}")
    return out[:10]


def _markdown_item(item: dict) -> list[str]:
    facts = [item["kind"]]
    for key in ("motivation", "horizon", "priority", "area"):
        if item.get(key):
            facts.append(f"{key}: {item[key]}")
    if item["is_example"]:
        facts.append("example item")
    lines = [f"### {item['title']}", "", "- " + " · ".join(facts)]
    for entry in item["dates"]:
        lines.append(f"- {describe_date(entry)}" + (f" — {entry['note']}" if entry.get("note") else ""))
    for step in item["next_steps"]:
        lines.append(f"- [{'x' if step['done'] else ' '}] {step['text']}")
    for ref in item["references"]:
        lines.append(f"- {ref['kind']}: {ref['label']}" + (f" <{ref['url']}>" if ref["url"] else ""))
    if item["notes"].strip():
        lines += ["", item["notes"].strip()]
    lines.append("")
    return lines
