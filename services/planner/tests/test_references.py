"""HQ references retain provenance through every existing persistence boundary."""
import json
from copy import deepcopy
from unittest.mock import patch

from support import ROOT, StoreTestCase
from planning.validation import ValidationError, normalize_fields

VECTORS = json.loads((ROOT / "contract/reference-vectors.json").read_text())
REF = VECTORS["cases"][0]["expected"][0]


def wiki_ref(**target):
    ref = deepcopy(REF)
    ref["id"] = "wiki001"
    ref["label"] = ref["target"]["title"] = "Example wiki page"
    ref["target"].update(domain="wiki", kind="page", entityId="page-example",
                         returnDestination={"domain": "wiki", "destination": "page/example"})
    ref["target"].update(target)
    return ref


class HQReferences(StoreTestCase):
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

    def test_wiki_target_roundtrips_create_patch_state_and_export_import(self):
        wiki = wiki_ref(sourceRevision="3", workspaceId="workspace-example")
        created = self.create(title="Created", references=[wiki])
        self.assertEqual(created["references"], [wiki])
        plain = self.create(title="Patched")
        _, result, _ = self.store.update_item(plain["id"], plain["revision"], {"references": [wiki]})
        self.assertEqual(result["item"]["references"], [wiki])
        for item_id in (created["id"], plain["id"]):
            self.assertEqual(self.store.get_item(item_id)["references"], [wiki])
        expected = {created["id"]: [wiki], plain["id"]: [wiki]}
        self.assertEqual({i["id"]: i["references"] for i in self.store.snapshot()["items"]}, expected)
        exported = self.store.export()
        self.assertEqual((exported["format"], exported["version"]), ("jones-planning-export", 1))
        self.assertEqual({i["id"]: i["references"] for i in exported["items"]}, expected)
        self.store.import_data({**exported, "items": [], "history": []}, "replace", "replace")
        self.assertEqual(self.store.snapshot()["items"], [])
        self.store.import_data(exported, "replace", "replace")
        self.reopen()
        for item_id in (created["id"], plain["id"]):
            self.assertEqual(self.store.get_item(item_id)["references"], [wiki])

    def test_wiki_return_destination_on_any_target_domain(self):
        wiki_to_design = wiki_ref(returnDestination={"domain": "design", "destination": "artifact/example"})
        design_to_wiki = deepcopy(REF)
        design_to_wiki.update(id="design001")
        design_to_wiki["target"]["returnDestination"] = {"domain": "wiki", "destination": "page/example"}
        item = self.create(references=[wiki_to_design, design_to_wiki])
        self.assertEqual(item["references"], [wiki_to_design, design_to_wiki])
        self.assertEqual(self.store.get_item(item["id"])["references"], [wiki_to_design, design_to_wiki])

    def test_same_kind_and_entity_in_wiki_and_work_are_distinct_targets(self):
        work = wiki_ref(domain="work", returnDestination={"domain": "work", "destination": "page/example"})
        work["id"] = "work001"
        item = self.create(references=[wiki_ref(), work])
        self.assertEqual([r["target"]["domain"] for r in item["references"]], ["wiki", "work"])
        with self.assertRaises(ValidationError) as caught:
            self.create(references=[wiki_ref(), {**wiki_ref(), "id": "wiki002"}])
        self.assertEqual(caught.exception.errors[0]["message"], "Reference 2 duplicates another HQ link.")

    def test_unknown_domains_stay_rejected_beside_wiki(self):
        invalid = "Reference 1 has an invalid HQ target."
        for domain in ("planner", "Wiki", "wikis", "inspiration", ""):
            for bad in (wiki_ref(domain=domain),
                        wiki_ref(returnDestination={"domain": domain, "destination": "page/example"})):
                with self.subTest(domain=domain), self.assertRaises(ValidationError) as caught:
                    self.create(references=[bad])
                self.assertEqual(caught.exception.errors, [{"field": "references", "message": invalid}])
        self.assertEqual(self.store.snapshot()["items"], [])

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
