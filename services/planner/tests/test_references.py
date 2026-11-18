"""HQ references retain provenance through every existing persistence boundary."""
import json
from copy import deepcopy
from unittest.mock import patch

from support import ROOT, StoreTestCase
from planning.store import StoreError
from planning.validation import ValidationError, normalize_fields

VECTORS = json.loads((ROOT / "contract/reference-vectors.json").read_text())
REF = VECTORS["cases"][0]["expected"][0]


class HQReferences(StoreTestCase):
    def test_fixture_cancellation_cleans_interrupted_store(self):
        for phase in ("setup", "test"):
            with self.subTest(phase=phase):
                class Interrupted(StoreTestCase):
                    def setUp(self):
                        super().setUp()
                        if phase == "setup":
                            raise KeyboardInterrupt("intended cancellation")

                    def runTest(self):
                        raise KeyboardInterrupt("intended cancellation")

                interrupted = Interrupted()
                try:
                    with self.assertRaisesRegex(KeyboardInterrupt, "intended cancellation"):
                        interrupted.run()
                    self.assertFalse(interrupted.db_path.parent.exists())
                    self.assertTrue(self.db_path.exists())
                finally:
                    interrupted.doCleanups()

    def test_shared_reference_vectors(self):
        for case in VECTORS["cases"]:
            with self.subTest(case=case["id"]), patch("planning.validation.new_id", return_value=VECTORS["generated_entry_id"]):
                if "errors" in case:
                    with self.assertRaises(ValidationError) as caught:
                        normalize_fields({"references": case["input"]}, creating=False)
                    self.assertEqual(caught.exception.errors, case["errors"])
                else:
                    self.assertEqual(normalize_fields({"references": case["input"]}, creating=False),
                                     {"references": case["expected"]})

    def test_roundtrip_patch_reopen_without_schema_change(self):
        schema = self.store._conn.execute("SELECT sql FROM sqlite_master ORDER BY name").fetchall()
        ref = deepcopy(REF)
        ref["target"].update(sourceRevision="7", workspaceId="workspace-example")
        item = self.create(references=[ref])
        _, result, _ = self.store.update_item(item["id"], item["revision"], {"title": "Changed"})
        self.assertEqual(result["item"]["references"], [ref])
        self.reopen()
        self.assertEqual(self.store.get_item(item["id"])["references"], [ref])
        self.assertEqual(self.store.snapshot()["items"][0]["references"], [ref])
        self.assertEqual(self.store._conn.execute("SELECT sql FROM sqlite_master ORDER BY name").fetchall(), schema)
        self.assertEqual(self.store._conn.execute("SELECT value FROM meta WHERE key='schema_version'").fetchone()[0], "1")
        for data in (self.store.snapshot(), self.store.api_version()):
            self.assertIn("hq-references-v1", data["features"])

    def test_export_import_and_backup_restore(self):
        item = self.create(references=[REF])
        exported = self.store.export()
        self.assertEqual((exported["format"], exported["version"]), ("jones-planning-export", 1))
        self.assertIn("Example design", self.store.export_markdown())
        empty = {**exported, "items": [], "history": []}
        _, result, _ = self.store.import_data(empty, "replace", "replace")
        self.assertEqual(self.store.snapshot()["items"], [])
        self.store.restore_backup(result["backup"], "replace")
        self.assertEqual(self.store.get_item(item["id"])["references"], [REF])
        self.store.import_data(exported, "replace", "replace")
        self.assertEqual(self.store.get_item(item["id"])["references"], [REF])

    def test_import_rejects_malformed_hq_reference_without_writing(self):
        self.create(references=[REF])
        exported = self.store.export()
        before = (self.store.version(), self.store.snapshot()["items"])
        for name, change in (("target-extra", lambda ref: ref["target"].update(extra=True)),
                             ("hq-url", lambda ref: ref.update(url="https://example.com/")),
                             ("route-scheme", lambda ref: ref["target"]["returnDestination"].update(destination="https:x"))):
            bad = deepcopy(exported)
            change(bad["items"][0]["references"][0])
            for mode in ("merge", "replace"):
                with self.subTest(case=name, mode=mode), self.assertRaises(StoreError) as caught:
                    self.store.import_data(bad, mode, "replace")
                self.assertEqual((caught.exception.status, caught.exception.code), (422, "invalid_import"))
                self.assertEqual((self.store.version(), self.store.snapshot()["items"]), before)

    def test_bad_batch_is_atomic_and_valid_batch_replays(self):
        bad = {**REF, "url": "https://example.com"}
        with self.assertRaises(ValidationError):
            self.store.create_batch({"items": [{"title": "Valid", "references": [REF]},
                                                {"title": "Invalid", "references": [bad]}]})
        self.assertEqual(self.store.version(), 0)
        body = {"items": [{"title": "Valid", "references": [REF]}]}
        first = self.store.create_batch(body, "contract-batch", "exact-bytes")
        again = self.store.create_batch(body, "contract-batch", "exact-bytes")
        self.assertEqual(first[:2], again[:2])
        self.assertTrue(again[2])
        self.assertEqual(len(self.store.snapshot()["items"]), 1)
