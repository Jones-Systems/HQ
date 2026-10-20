"""Shared test scaffolding.

Scratch lives under ``tests/.scratch/`` inside the website directory (not
/tmp). Each test gets its own ``TemporaryDirectory`` there, removed on
success, failure or cancellation by the context manager; the shared
``.scratch`` parent is removed afterwards only if empty.
"""

from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SCRATCH = ROOT / "tests" / ".scratch"
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))


class StoreTestCase(unittest.TestCase):
    def setUp(self):
        SCRATCH.mkdir(exist_ok=True)
        self._tmp = tempfile.TemporaryDirectory(dir=SCRATCH, prefix="store-")
        self.addCleanup(self._cleanup)
        from planning.store import Store

        self.db_path = Path(self._tmp.name) / "planning.sqlite3"
        self.store = Store(self.db_path)

    def _cleanup(self):
        self.store.close()
        self._tmp.cleanup()
        try:
            SCRATCH.rmdir()
        except OSError:
            pass  # another test still owns a directory there, or it is already gone

    def reopen(self):
        from planning.store import Store

        self.store.close()
        self.store = Store(self.db_path)
        return self.store

    def create(self, **fields):
        fields.setdefault("title", "Item")
        status, payload, _ = self.store.create_item(fields)
        self.assertEqual(status, 201)
        return payload["item"]

    def column(self, status):
        return [i["title"] for i in self.store.snapshot()["items"] if i["status"] == status]
