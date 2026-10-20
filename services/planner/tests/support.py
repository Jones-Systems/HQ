"""Shared test scaffolding.

Scratch lives under ``tests/.scratch/`` inside the website directory (not
/tmp). Each test gets its own ``TemporaryDirectory`` there, removed on
success, failure or cancellation by test cleanup; the shared
``.scratch`` parent is removed afterwards only if empty. SIGTERM is mapped to
the same ``KeyboardInterrupt`` unwinding as SIGINT so cleanups still run.
"""

from __future__ import annotations

import signal
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SCRATCH = ROOT / "tests" / ".scratch"
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))


def _terminate(signum, frame):
    raise KeyboardInterrupt(f"signal {signum}")


# Default SIGTERM kills Python without running cleanups and leaks scratch.
# Leave any handler a runner already installed in place.
try:
    if signal.getsignal(signal.SIGTERM) is signal.SIG_DFL:
        signal.signal(signal.SIGTERM, _terminate)
except ValueError:
    pass  # imported off the main thread; signals cannot be handled here


class StoreTestCase(unittest.TestCase):
    def setUp(self):
        SCRATCH.mkdir(exist_ok=True)
        self._tmp = tempfile.TemporaryDirectory(dir=SCRATCH, prefix="store-")
        self.addCleanup(self._cleanup)
        from planning.store import Store

        self.db_path = Path(self._tmp.name) / "planning.sqlite3"
        self.store = Store(self.db_path)

    def _cleanup(self):
        try:
            store = getattr(self, "store", None)  # absent if Store() raised in setUp
            if store is not None:
                store.close()
        finally:
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
