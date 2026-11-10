"""Store behaviour: validation, typed dates, ordering, revisions, idempotency,
archive, persistence, export/import/restore and example data."""

from __future__ import annotations

import json
import os
import sqlite3
import stat
import unittest
from unittest.mock import patch

from support import StoreTestCase

from planning.store import StoreError
from planning.validation import ValidationError


class CreateAndValidate(StoreTestCase):
    def test_new_store_is_empty_without_examples(self):
        snap = self.store.snapshot()
        self.assertEqual(snap["items"], [])
        self.assertEqual(snap["settings"]["default_tz"], "America/New_York")

    def test_title_only_capture_gets_safe_defaults(self):
        item = self.create(title="  Learn   piano ")
        self.assertEqual(item["title"], "Learn piano")
        self.assertEqual((item["status"], item["kind"], item["revision"]), ("inbox", "idea", 1))
        self.assertIsNone(item["motivation"])
        self.assertEqual(item["dates"], [])
        self.assertFalse(item["is_example"])

    def test_rejects_bad_fields_without_writing(self):
        bad = [
            {"title": ""},
            {"title": "x", "status": "launched"},
            {"title": "x", "motivation": "must"},
            {"title": "x", "unknown": 1},
            {"title": "a\x07b"},
            {"title": "x", "references": [{"label": "bad", "url": "javascript:alert(1)"}]},
            {"title": "x", "references": [{"label": "bad", "url": "file:///etc/passwd"}]},
            {"title": "x", "notes": "y" * 20001},
            {"title": "x", "next_steps": [{"text": ""}]},
        ]
        for fields in bad:
            with self.subTest(fields=str(fields)[:60]):
                with self.assertRaises(ValidationError):
                    self.store.create_item(fields)
        self.assertEqual(self.store.snapshot()["items"], [])

    def test_reference_label_defaults_to_url(self):
        item = self.create(references=[{"kind": "doc", "url": "https://example.com/a"}])
        self.assertEqual(item["references"][0]["label"], "https://example.com/a")


class BatchCreate(StoreTestCase):
    def test_order_history_and_one_transaction(self):
        self.create(title="old", status="next")
        before = self.store.version()
        statements = []
        self.store._conn.set_trace_callback(statements.append)
        status, result, replayed = self.store.create_batch({"items": [
            {"title": "A", "status": "next"}, {"title": "B"}, {"title": "C", "status": "next"}]},
            "batch-0001", "bytes")
        self.store._conn.set_trace_callback(None)
        self.assertEqual((status, replayed, result["state_version"]), (201, False, before + 1))
        self.assertEqual([i["title"] for i in result["items"]], ["A", "B", "C"])
        self.assertEqual(self.column("next"), ["A", "C", "old"])
        self.assertEqual(statements.count("BEGIN IMMEDIATE"), 1)
        self.assertEqual(statements.count("COMMIT"), 1)
        for item in result["items"]:
            self.assertEqual([h["action"] for h in self.store.history(item["id"])], ["created"])
        self.reopen()
        self.assertEqual(self.column("next"), ["A", "C", "old"])

    def test_aggregate_validation_before_transaction_and_dry_run_no_effect(self):
        before = self.store._conn.total_changes
        with patch.object(self.store, "_mutate", side_effect=AssertionError("must not transact")):
            with self.assertRaises(ValidationError) as caught:
                self.store.create_batch({"items": [{"title": ""}, {"title": "X", "status": "bad"},
                    {"title": "D", "dates": [{"kind": "target", "precision": "day", "value": "bad"}]}]})
            self.assertEqual({e["field"] for e in caught.exception.errors},
                             {"items[0].title", "items[1].status", "items[2].dates.value"})
            status, result, replayed = self.store.create_batch(
                {"items": [{"title": "Valid"}], "dry_run": True}, "batch-0001", "dry")
        self.assertEqual((status, result, replayed),
                         (200, {"valid": True, "count": 1, "dry_run": True, "state_version": 0}, False))
        self.assertEqual(self.store._conn.total_changes, before)
        self.assertEqual(self.store.version(), 0)
        self.assertEqual(self.store._conn.execute("SELECT COUNT(*) FROM requests").fetchone()[0], 0)
        self.assertEqual(self.store.create_batch({"items": [{"title": "Valid"}]}, "batch-0001", "commit")[0], 201)

    def test_insert_failure_rolls_back_everything(self):
        before = self.store.version()
        original = self.store._log
        count = 0
        def fail_second(*args):
            nonlocal count
            count += 1
            if count == 2:
                raise RuntimeError("synthetic insert failure")
            return original(*args)
        with patch.object(self.store, "_log", side_effect=fail_second):
            with self.assertRaisesRegex(RuntimeError, "synthetic"):
                self.store.create_batch({"items": [{"title": "A"}, {"title": "B"}]}, "batch-0001", "bytes")
        self.assertEqual(self.store.version(), before)
        for table in ("items", "history", "requests"):
            self.assertEqual(self.store._conn.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0], 0)


class RetentionReplay(StoreTestCase):
    def floor(self):
        return self.store.api_version()["request_retention"]["evicted_through_version"]

    def test_missing_resend_replay_and_changed_fingerprint(self):
        apply = lambda: self.store.create_item({"title": "Once"}, "request-01", "bytes")
        self.assertEqual(self.store.replay_request("request-01", "bytes", 0, "lookup", apply)[1],
                         {"outcome": "not_applied"})
        first = self.store.replay_request("request-01", "bytes", 0, "resend", apply)
        self.assertEqual(first[1]["outcome"], "applied_now")
        again = self.store.replay_request("request-01", "bytes", 0, "resend", apply)
        self.assertEqual((again[1]["outcome"], again[2]), ("replayed", True))
        self.assertEqual(first[1]["response"], again[1]["response"])
        self.assertEqual((len(self.store.snapshot()["items"]), self.store.version()), (1, 1))
        with self.assertRaises(StoreError) as caught:
            self.store.replay_request("request-01", "changed", 0, "resend", apply)
        self.assertEqual((caught.exception.status, caught.exception.code), (422, "request_id_reused"))

    def test_eviction_floor_and_indeterminate_do_not_write(self):
        with patch("planning.store.MAX_REMEMBERED_REQUESTS", 3):
            for i in range(6):
                self.store.create_item({"title": str(i)}, f"request-{i}", str(i))
            self.assertEqual(self.floor(), 3)
            before = self.store._conn.total_changes
            with self.assertRaises(StoreError) as caught:
                self.store.replay_request("request-0", "0", 0, "resend", lambda: self.fail("unsafe apply"))
            self.assertEqual((caught.exception.status, caught.exception.code), (409, "replay_indeterminate"))
            self.assertEqual(self.store._conn.total_changes, before)
            self.assertEqual(self.store.version(), 6)
            self.assertEqual(len(self.store.snapshot()["items"]), 6)
            self.assertEqual(self.store.replay_request("new-request", "new", 3, "lookup", None)[1],
                             {"outcome": "not_applied"})
            self.reopen()
            self.assertEqual(self.floor(), 3)

    def test_newest_request_is_retained_when_the_clock_steps_back(self):
        stamps = iter(f"2026-01-01T00:00:{59 - i:02d}.000Z" for i in range(100))
        with patch("planning.store.MAX_REMEMBERED_REQUESTS", 3), \
                patch("planning.store.utc_now", lambda: next(stamps)):
            for i in range(4):
                self.store.create_item({"title": str(i)}, f"request-{i}", str(i))
            _, _, replayed = self.store.create_item({"title": "3"}, "request-3", "3")
        self.assertTrue(replayed)
        self.assertEqual(len(self.store.snapshot()["items"]), 4)
        self.assertEqual(self.floor(), 1)

    def test_upgrade_initialization_and_import_preserve_floor(self):
        with patch("planning.store.MAX_REMEMBERED_REQUESTS", 3):
            self.create()
            self.store._conn.execute("DELETE FROM meta WHERE key='request_evicted_through_version'")
            self.reopen()
            self.assertEqual(self.floor(), 0)
            for i in range(3):
                self.store.create_item({"title": str(i)}, f"request-{i}", str(i))
            self.store._conn.execute("DELETE FROM meta WHERE key='request_evicted_through_version'")
            self.reopen()
            self.assertEqual(self.floor(), 4)
            before = self.store.version()
            _, imported, _ = self.store.import_data(self.store.export(), "replace", "replace")
            self.assertEqual(self.floor(), 4)
            self.assertEqual(self.store._conn.execute("SELECT COUNT(*) FROM requests").fetchone()[0], 3)
            self.store.restore_backup(imported["backup"], "replace")
            self.assertEqual(self.floor(), 4)
            self.assertEqual(self.store.version(), before + 2)

    def test_invalid_or_missing_baseline_and_failed_apply(self):
        for version in (-1, True, 1, "0"):
            with self.subTest(version=version), self.assertRaises(StoreError) as caught:
                self.store.replay_request("request-01", "bytes", version, "resend", None)
            self.assertEqual(caught.exception.status, 400)
        with self.assertRaises(StoreError) as caught:
            self.store.replay_request("request-01", "bytes", None, "resend", None)
        self.assertEqual(caught.exception.code, "replay_indeterminate")
        with self.assertRaises(ValidationError):
            self.store.replay_request("request-01", "bytes", 0, "resend",
                                     lambda: self.store.create_item({"title": ""}, "request-01", "bytes"))
        self.assertEqual(self.store.version(), 0)


class TypedDates(StoreTestCase):
    def dates(self, *entries):
        return self.create(dates=list(entries))["dates"]

    def test_each_precision_keeps_its_meaning(self):
        got = self.dates(
            {"kind": "deadline", "precision": "day", "value": "2026-11-14"},
            {"kind": "target", "precision": "week", "value": "2026-W53"},
            {"kind": "target", "precision": "month", "value": "2026-11"},
            {"kind": "start", "precision": "quarter", "value": "2027-Q2"},
            {"kind": "target", "precision": "year", "value": "2029"},
        )
        self.assertEqual([d["value"] for d in got], ["2026-11-14", "2026-W53", "2026-11", "2027-Q2", "2029"])
        self.assertTrue(all(d["time"] is None and d["tz"] is None for d in got))

    def test_invalid_dates_rejected(self):
        bad = [
            {"kind": "target", "precision": "day", "value": "2026-02-30"},
            {"kind": "target", "precision": "week", "value": "2025-W53"},
            {"kind": "target", "precision": "month", "value": "2026-13"},
            {"kind": "target", "precision": "quarter", "value": "2026-Q5"},
            {"kind": "due", "precision": "day", "value": "2026-01-01"},
            {"kind": "event", "precision": "month", "value": "2026-11", "time": "09:00", "tz": "UTC"},
            {"kind": "event", "precision": "day", "value": "2026-11-14", "time": "09:00"},
            {"kind": "event", "precision": "day", "value": "2026-11-14", "time": "09:00", "tz": "Mars/Base"},
            {"kind": "event", "precision": "day", "value": "2026-11-14", "time": "10:00", "end_time": "09:00", "tz": "UTC"},
            # 02:30 does not exist when New York springs forward.
            {"kind": "event", "precision": "day", "value": "2027-03-14", "time": "02:30", "tz": "America/New_York"},
        ]
        for entry in bad:
            with self.subTest(entry=entry):
                with self.assertRaises(ValidationError):
                    self.store.create_item({"title": "x", "dates": [entry]})

    def test_timed_event_derives_instant_and_zone_abbreviation(self):
        winter, summer = self.dates(
            {"kind": "event", "precision": "day", "value": "2026-11-14", "time": "09:30", "end_time": "10:15",
             "tz": "America/New_York"},
            {"kind": "event", "precision": "day", "value": "2026-07-01", "time": "09:30", "tz": "America/New_York"},
        )
        self.assertEqual((winter["instant"], winter["tz_abbr"], winter["end_instant"]),
                         ("2026-11-14T14:30:00Z", "EST", "2026-11-14T15:15:00Z"))
        self.assertEqual((summer["instant"], summer["tz_abbr"]), ("2026-07-01T13:30:00Z", "EDT"))

    def test_zone_without_time_is_dropped(self):
        (entry,) = self.dates({"kind": "target", "precision": "day", "value": "2026-11-14", "tz": "UTC"})
        self.assertIsNone(entry["tz"])

    def test_reschedule_preserves_kind_time_zone_note_and_id(self):
        item = self.create(dates=[{"kind": "event", "precision": "day", "value": "2026-11-14", "time": "09:30",
                                   "tz": "America/New_York", "note": "dentist"}])
        entry = {k: v for k, v in item["dates"][0].items() if k not in ("instant", "end_instant", "tz_abbr")}
        moved = dict(entry, value="2026-11-16")
        _, payload, _ = self.store.update_item(item["id"], item["revision"], {"dates": [moved]})
        (after,) = payload["item"]["dates"]
        self.assertEqual({k: after[k] for k in ("id", "kind", "time", "tz", "note", "value")},
                         {"id": entry["id"], "kind": "event", "time": "09:30", "tz": "America/New_York",
                          "note": "dentist", "value": "2026-11-16"})
        history = self.store.history(item["id"])
        self.assertIn("→", history[0]["detail"]["dates"][0])


class RevisionsAndIdempotency(StoreTestCase):
    def test_stale_revision_is_rejected_with_current_item(self):
        item = self.create(title="A")
        self.store.update_item(item["id"], 1, {"notes": "first"})
        with self.assertRaises(StoreError) as caught:
            self.store.update_item(item["id"], 1, {"notes": "second"})
        self.assertEqual(caught.exception.status, 409)
        self.assertEqual(caught.exception.extra["current"]["notes"], "first")

    def test_noop_update_keeps_revision(self):
        item = self.create(title="A", horizon="soon")
        _, payload, _ = self.store.update_item(item["id"], 1, {"horizon": "soon"})
        self.assertEqual((payload["item"]["revision"], payload["changed"]), (1, []))

    def test_resending_unchanged_timed_dates_keeps_revision(self):
        item = self.create(dates=[{"kind": "event", "precision": "day", "value": "2026-11-14",
                                   "time": "09:30", "tz": "America/New_York"}])
        dates = [{k: v for k, v in d.items() if k not in ("instant", "end_instant", "tz_abbr")}
                 for d in item["dates"]]
        _, payload, _ = self.store.update_item(item["id"], 1, {"dates": dates})
        self.assertEqual((payload["item"]["revision"], payload["changed"]), (1, []))
        self.assertEqual(payload["item"]["dates"], item["dates"])
        self.assertEqual([h["action"] for h in self.store.history(item["id"])], ["created"])

    def test_missing_or_bool_revision_rejected(self):
        item = self.create()
        for revision in (None, True, "1"):
            with self.subTest(revision=revision), self.assertRaises(StoreError):
                self.store.update_item(item["id"], revision, {"title": "B"})

    def test_replayed_request_is_applied_once(self):
        first = self.store.create_item({"title": "Once"}, request_id="req-abcdef12", fingerprint="fp1")
        again = self.store.create_item({"title": "Once"}, request_id="req-abcdef12", fingerprint="fp1")
        self.assertEqual(first[1]["item"]["id"], again[1]["item"]["id"])
        self.assertTrue(again[2])
        self.assertEqual(len(self.store.snapshot()["items"]), 1)
        with self.assertRaises(StoreError) as caught:
            self.store.create_item({"title": "Other"}, request_id="req-abcdef12", fingerprint="fp2")
        self.assertEqual(caught.exception.status, 422)

    def test_auto_rolled_back_failure_keeps_original_error(self):
        conn = self.store._conn
        conn.create_function("halt", 0, lambda: (conn.interrupt(), 1)[1])

        def apply(cur):
            cur.execute("UPDATE meta SET value=value WHERE halt()")
            return 200, {}

        with self.assertRaisesRegex(sqlite3.OperationalError, "interrupted"):
            self.store._mutate("req-halted01", "f", apply)
        self.assertFalse(conn.in_transaction)
        self.assertEqual(self.store.version(), 0)
        self.create()
        self.assertEqual(self.store.version(), 1)

    def test_failed_mutation_is_not_remembered(self):
        item = self.create()
        with self.assertRaises(StoreError):
            self.store.update_item(item["id"], 99, {"title": "B"}, request_id="req-retry001", fingerprint="f")
        _, payload, replayed = self.store.update_item(item["id"], 1, {"title": "B"}, request_id="req-retry001", fingerprint="f")
        self.assertFalse(replayed)
        self.assertEqual(payload["item"]["title"], "B")

    def test_state_version_advances_per_mutation(self):
        v0 = self.store.version()
        self.create()
        self.assertEqual(self.store.version(), v0 + 1)


class Ordering(StoreTestCase):
    def setUp(self):
        super().setUp()
        # New items go to the top, so create in reverse to read A, B, C, D.
        self.ids = {}
        for title in "DCBA":
            self.ids[title] = self.create(title=title, status="next")["id"]

    def move(self, title, status, **anchors):
        item = self.store.get_item(self.ids[title])
        return self.store.move_item(item["id"], item["revision"], status, **anchors)

    def test_new_items_land_on_top(self):
        self.assertEqual(self.column("next"), ["A", "B", "C", "D"])

    def test_reorder_within_column(self):
        self.move("D", "next", after_id=self.ids["A"])
        self.assertEqual(self.column("next"), ["A", "D", "B", "C"])
        self.move("A", "next", place="bottom")
        self.assertEqual(self.column("next"), ["D", "B", "C", "A"])
        self.move("A", "next", before_id=self.ids["D"])
        self.assertEqual(self.column("next"), ["A", "D", "B", "C"])

    def test_move_across_columns_with_anchor(self):
        x = self.create(title="X", status="active")
        _, payload, _ = self.store.move_item(x["id"], x["revision"], "next", after_id=self.ids["B"])
        self.assertEqual(payload["item"]["status"], "next")
        self.assertEqual(payload["item"]["revision"], 2)
        self.assertEqual(self.column("next"), ["A", "B", "X", "C", "D"])
        self.assertEqual(self.store.history(x["id"])[0]["action"], "moved")

    def test_filtered_drop_lands_beside_visible_neighbour(self):
        # A filter hides B and C; the owner drops X between visible A and D.
        x = self.create(title="X", status="inbox")
        self.store.move_item(x["id"], 1, "next", after_id=self.ids["A"])
        self.assertEqual(self.column("next"), ["A", "X", "B", "C", "D"])
        # Dropping at the top of a filtered view anchors before the first visible card.
        y = self.create(title="Y", status="inbox")
        self.store.move_item(y["id"], 1, "next", before_id=self.ids["C"])
        self.assertEqual(self.column("next"), ["A", "X", "B", "Y", "C", "D"])

    def test_stale_anchor_is_an_order_conflict(self):
        other = self.create(title="Z", status="done")
        with self.assertRaises(StoreError) as caught:
            self.move("A", "next", after_id=other["id"])
        self.assertEqual((caught.exception.status, caught.exception.code), (409, "order_conflict"))
        self.assertEqual(self.column("next"), ["A", "B", "C", "D"])

    def test_moving_to_same_place_does_not_bump_revision(self):
        positions = [i["position"] for i in self.store.snapshot()["items"]]
        _, payload, _ = self.move("B", "next", after_id=self.ids["A"])
        self.assertEqual(payload["item"]["revision"], 1)
        self.assertEqual([i["position"] for i in self.store.snapshot()["items"]], positions)

    def test_status_change_through_patch_goes_to_top(self):
        x = self.create(title="X", status="inbox")
        self.store.update_item(x["id"], 1, {"status": "next"})
        self.assertEqual(self.column("next")[0], "X")


class ArchiveAndPersistence(StoreTestCase):
    def test_archive_restore_keeps_status_and_order(self):
        a = self.create(title="A", status="active")
        self.create(title="B", status="active")
        _, payload, _ = self.store.set_archived(a["id"], 1, True)
        self.assertIsNotNone(payload["item"]["archived_at"])
        self.assertEqual(payload["item"]["status"], "active")
        _, payload, _ = self.store.set_archived(a["id"], 2, False)
        self.assertIsNone(payload["item"]["archived_at"])
        self.assertEqual(self.column("active"), ["B", "A"])

    def test_interrupted_first_open_leaves_a_store_that_opens(self):
        from planning.store import Store

        self.store.close()
        self.db_path.unlink()
        opened, meta_inserts = [], []
        real_connect = sqlite3.connect

        def deny_second_meta_insert(action, table, *_):
            if action == sqlite3.SQLITE_INSERT and table == "meta":
                meta_inserts.append(table)
                if len(meta_inserts) == 2:
                    return sqlite3.SQLITE_DENY
            return sqlite3.SQLITE_OK

        def connect(*args, **kwargs):
            conn = real_connect(*args, **kwargs)
            conn.set_authorizer(deny_second_meta_insert)
            opened.append(conn)
            return conn

        with patch.object(sqlite3, "connect", connect), self.assertRaises(sqlite3.DatabaseError):
            Store(self.db_path)
        opened[0].close()
        store = self.reopen()
        self.assertEqual((store.version(), store.snapshot()["items"]), (0, []))

    def test_new_store_and_backup_files_are_private(self):
        def private(path):
            return stat.S_IMODE(os.stat(path).st_mode) & 0o077 == 0

        self.create()
        self.assertTrue(private(self.db_path))
        self.assertTrue(private(f"{self.db_path}-wal"))
        _, payload, _ = self.store.import_data(self.store.export(), "replace", "replace")
        self.assertTrue(private(self.store.backup_dir))
        self.assertTrue(private(self.store.backup_dir / payload["backup"]))

    def test_acknowledged_changes_survive_restart(self):
        item = self.create(title="Durable", notes="keep me")
        self.store.update_item(item["id"], 1, {"horizon": "later"})
        store = self.reopen()
        again = store.get_item(item["id"])
        self.assertEqual((again["notes"], again["horizon"], again["revision"]), ("keep me", "later", 2))


class ExportImport(StoreTestCase):
    def seed(self):
        self.create(title="One", motivation="need", dates=[{"kind": "deadline", "precision": "day", "value": "2026-11-14"}],
                    next_steps=[{"text": "step", "done": True}], references=[{"kind": "pr", "label": "PR 1", "url": "https://example.com/pr/1"}])
        two = self.create(title="Two", status="considering")
        self.store.set_archived(two["id"], 1, True)
        self.store.update_settings({"week_start": "mon"})

    def test_round_trip_replace_restores_everything(self):
        self.seed()
        exported = self.store.export()
        self.assertEqual(exported["format"], "jones-planning-export")
        self.assertNotIn("instant", json.dumps(exported["items"]))
        self.create(title="Later addition")
        status, payload, _ = self.store.import_data(json.loads(json.dumps(exported)), "replace", "replace")
        self.assertEqual(status, 200)
        self.assertTrue(payload["backup"].startswith("backup-"))
        after = self.store.export()
        # Surviving ids move one revision forward; everything else is restored exactly.
        self.assertEqual([i["revision"] for i in after["items"]], [i["revision"] + 1 for i in exported["items"]])
        self.assertEqual([dict(i, revision=0) for i in after["items"]],
                         [dict(i, revision=0) for i in exported["items"]])
        self.assertEqual(after["settings"]["week_start"], "mon")
        self.assertEqual(len(after["history"]), len(exported["history"]))
        backup = json.loads((self.store.backup_dir / payload["backup"]).read_text())
        self.assertIn("Later addition", [i["title"] for i in backup["items"]])

    def test_replace_and_restore_never_move_a_revision_backwards(self):
        item = self.create(title="Base")
        exported = self.store.export()
        for revision in (1, 2):
            self.store.update_item(item["id"], revision, {"notes": f"edit {revision}"})
        _, payload, _ = self.store.import_data(exported, "replace", "replace")
        self.assertEqual(self.store.get_item(item["id"])["revision"], 4)
        with self.assertRaises(StoreError) as caught:
            self.store.update_item(item["id"], 1, {"notes": "stale writer"})
        self.assertEqual(caught.exception.code, "revision_conflict")
        self.store.restore_backup(payload["backup"], "replace")
        restored = self.store.get_item(item["id"])
        self.assertEqual((restored["notes"], restored["revision"]), ("edit 2", 5))

    def test_replace_requires_confirmation(self):
        self.seed()
        with self.assertRaises(StoreError) as caught:
            self.store.import_data(self.store.export(), "replace")
        self.assertEqual(caught.exception.code, "confirmation_required")

    def test_invalid_import_changes_nothing(self):
        self.seed()
        before = self.store.export()
        data = json.loads(json.dumps(before))
        data["items"][0]["status"] = "launched"
        data["items"].append({"id": data["items"][1]["id"]})
        with self.assertRaises(StoreError) as caught:
            self.store.import_data(data, "replace", "replace")
        self.assertEqual(caught.exception.status, 422)
        self.assertGreaterEqual(len(caught.exception.extra["problems"]), 1)
        self.assertEqual(self.store.export()["items"], before["items"])
        self.assertEqual(self.store.list_backups(), [])

    def test_malformed_history_id_and_huge_revision_are_rejected_cleanly(self):
        self.seed()
        before = self.store.export()
        bad_history = json.loads(json.dumps(before))
        bad_history["history"][0]["item_id"] = ["not", "hashable"]
        huge_revision = json.loads(json.dumps(before))
        huge_revision["items"][0]["revision"] = 2**64
        for label, data in (("history id", bad_history), ("revision", huge_revision)):
            with self.subTest(label):
                with self.assertRaises(StoreError) as caught:
                    self.store.import_data(data, "replace", "replace")
                self.assertEqual((caught.exception.status, caught.exception.code), (422, "invalid_import"))
        self.assertEqual(self.store.export()["items"], before["items"])
        self.assertEqual(self.store.list_backups(), [])

    def test_imported_history_is_capped_per_item(self):
        from planning.store import MAX_HISTORY_PER_ITEM

        self.seed()
        data = self.store.export()
        item_id = data["items"][0]["id"]
        data["history"] = [{"item_id": item_id, "at": "2026-01-01T00:00:00Z", "action": "updated",
                            "detail": {"n": n}} for n in range(MAX_HISTORY_PER_ITEM + 5)]
        self.store.import_data(data, "replace", "replace")
        kept = self.store.history(item_id, limit=MAX_HISTORY_PER_ITEM + 10)
        self.assertEqual(len(kept), MAX_HISTORY_PER_ITEM)
        self.assertEqual((kept[0]["detail"]["n"], kept[-1]["detail"]["n"]), (MAX_HISTORY_PER_ITEM + 4, 5))

    def test_wrong_format_rejected(self):
        for data in ({}, {"format": "other", "version": 1, "items": []}, [], "x"):
            with self.subTest(data=data), self.assertRaises(StoreError):
                self.store.preview_import(data)

    def test_merge_adds_only_new_ids(self):
        self.seed()
        exported = self.store.export()
        fresh = json.loads(json.dumps(exported["items"][0]))
        fresh["id"] = "abcdef0123456789"
        fresh["title"] = "Imported"
        exported["items"].append(fresh)
        preview = self.store.preview_import(exported)
        self.assertEqual((preview["new_ids"], preview["existing_ids"]), (1, 2))
        _, payload, _ = self.store.import_data(exported, "merge")
        self.assertEqual((payload["imported"], payload["skipped"]), (1, 2))
        self.assertIn("Imported", [i["title"] for i in self.store.snapshot()["items"]])

    def test_restore_backup_and_reject_unsafe_names(self):
        self.seed()
        _, payload, _ = self.store.import_data(self.store.export(), "replace", "replace")
        name = payload["backup"]
        self.create(title="After backup")
        _, restored, _ = self.store.restore_backup(name, "replace")
        titles = [i["title"] for i in self.store.snapshot()["items"]]
        self.assertNotIn("After backup", titles)
        self.assertEqual(len(self.store.list_backups()), 2)
        for unsafe in ("../planning.sqlite3", "backup-x.json", "/etc/passwd", None, name + "\n"):
            with self.subTest(name=unsafe), self.assertRaises(StoreError) as caught:
                self.store.restore_backup(unsafe, "replace")
            self.assertEqual((caught.exception.status, caught.exception.code), (400, "invalid"))
        self.assertTrue(restored["backup"].startswith("backup-"))

    def test_backups_list_newest_first_within_one_second(self):
        self.store.backup_dir.mkdir()
        names = ["backup-20261020T120000Z.json", "backup-20261020T120000Z-1.json",
                 "backup-20261020T120000Z-2.json", "backup-20261020T120000Z-10.json",
                 "backup-20261020T120001Z.json"]
        for name in names:
            (self.store.backup_dir / name).write_text("{}")
        self.assertEqual([b["name"] for b in self.store.list_backups()],
                         [names[4], names[3], names[2], names[1], names[0]])

    def test_markdown_export_is_readable(self):
        self.seed()
        text = self.store.export_markdown()
        self.assertIn("### One", text)
        self.assertIn("- [x] step", text)
        self.assertIn("## Archived (1)", text)


class Examples(StoreTestCase):
    def test_examples_are_opt_in_flagged_and_removable(self):
        own = self.create(title="Mine")
        status, payload, _ = self.store.load_examples()
        self.assertEqual(status, 201)
        items = self.store.snapshot()["items"]
        examples = [i for i in items if i["is_example"]]
        self.assertEqual(len(examples), payload["created"])
        self.assertTrue(all(i["title"].startswith("Example:") for i in examples))
        with self.assertRaises(StoreError):
            self.store.load_examples()
        self.store.remove_examples()
        self.assertEqual([i["id"] for i in self.store.snapshot()["items"]], [own["id"]])


if __name__ == "__main__":
    unittest.main()
