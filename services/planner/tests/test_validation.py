"""Field-validation edge cases: text safety, strict identifiers, and examples."""

from __future__ import annotations

import datetime as _dt
import json
import unittest

from support import StoreTestCase

from planning import examples
from planning.validation import ValidationError, is_item_id, is_timestamp, normalize_fields

_HQ_TARGET = {
    "version": 1, "domain": "work", "projectId": "p1", "kind": "task", "entityId": "e1",
    "title": "Target", "returnDestination": {"domain": "work", "destination": "/tasks/e1"},
}


def _errors(fields: dict, *, creating: bool = True) -> list[dict]:
    with unittest.TestCase().assertRaises(ValidationError) as ctx:
        normalize_fields(fields, creating=creating)
    return ctx.exception.errors


class LoneSurrogates(StoreTestCase):
    """JSON escapes such as "\\ud800" decode to lone surrogates, which cannot be
    encoded as UTF-8; once stored they made every state and export read fail."""

    BAD = "x\ud800y"

    def test_every_text_field_rejects_lone_surrogates(self):
        cases = {
            "title": {"title": self.BAD},
            "area": {"title": "T", "area": self.BAD},
            "notes": {"title": "T", "notes": self.BAD},
            "next_steps": {"title": "T", "next_steps": [{"text": self.BAD}]},
            "references": {"title": "T", "references": [{"kind": "doc", "label": self.BAD}]},
            "references.url": {"title": "T", "references": [{"url": "https://example.com/" + self.BAD}]},
            "references.hq": {"title": "T", "references": [
                {"kind": "hq", "target": {**_HQ_TARGET, "title": self.BAD}}]},
            "dates.note": {"title": "T", "dates": [
                {"kind": "target", "precision": "year", "value": "2027", "note": self.BAD}]},
        }
        for name, fields in cases.items():
            with self.subTest(name):
                errors = _errors(fields)
                self.assertTrue(errors)
                json.dumps(errors, ensure_ascii=False).encode("utf-8")

    def test_unknown_field_names_are_echoed_safely(self):
        errors = _errors({"title": "T", "bad\udfff": 1})
        json.dumps(errors, ensure_ascii=False).encode("utf-8")
        self.assertIn("bad", errors[0]["message"])

    def test_rejected_step_leaves_the_board_readable(self):
        with self.assertRaises(ValidationError):
            self.store.create_item({"title": "T", "next_steps": [{"text": self.BAD}]})
        snapshot = self.store.snapshot()
        self.assertEqual(snapshot["items"], [])
        json.dumps(snapshot, ensure_ascii=False).encode("utf-8")
        json.dumps(self.store.export(), ensure_ascii=False).encode("utf-8")

    def test_paired_surrogates_still_count_as_one_character(self):
        values = normalize_fields({"title": "Party \U0001f600", "notes": "\U0001f600"}, creating=True)
        self.assertEqual(values["title"], "Party \U0001f600")


class StrictIdentifiers(unittest.TestCase):
    def test_ids_reject_trailing_newline_and_non_ascii(self):
        self.assertTrue(is_item_id("abcdef"))
        for bad in ("abcdef\n", "abcdéf", "abc def"):
            with self.subTest(bad):
                self.assertFalse(is_item_id(bad))
                _errors({"title": "T", "next_steps": [{"id": bad, "text": "s"}]})
                _errors({"title": "T", "references": [{"id": bad, "label": "l"}]})
                _errors({"title": "T", "dates": [
                    {"id": bad, "kind": "target", "precision": "year", "value": "2027"}]})

    def test_timestamps_are_strict_ascii(self):
        self.assertTrue(is_timestamp("2026-01-15T12:00:00.000Z"))
        for bad in ("2026-01-15T12:00:00Z\n", "٢٠٢٦-01-15T12:00:00Z",
                    "2026-02-30T12:00:00Z", "2026-01-15T12:00:00+00:00"):
            with self.subTest(bad):
                self.assertFalse(is_timestamp(bad))


class FieldShapes(unittest.TestCase):
    def test_date_entry_errors_are_not_double_prefixed(self):
        self.assertEqual(_errors({"title": "T", "dates": [1]})[0]["field"], "dates")
        self.assertEqual(_errors({"title": "T", "dates": [{"bogus": 1}]})[0]["field"], "dates")
        self.assertEqual(_errors({"title": "T", "dates": [{"kind": "x"}]})[0]["field"], "dates.kind")

    def test_notes_reject_delete_like_other_text(self):
        _errors({"title": "T", "notes": "a\x7fb"})
        self.assertEqual(normalize_fields({"title": "T", "notes": "a\tb\r\nc"}, creating=True)["notes"],
                         "a\tb\nc")

    def test_non_text_reference_values_are_not_coerced(self):
        for ref in ({"kind": False, "label": "l"}, {"kind": 0, "label": "l"},
                    {"label": "l", "url": False}, {"label": "l", "url": 0}):
            with self.subTest(ref):
                _errors({"title": "T", "references": [ref]})
        refs = normalize_fields({"title": "T", "references": [
            {"kind": "", "label": "l", "url": None}, {"kind": None, "label": "m", "url": ""}]},
            creating=True)["references"]
        self.assertEqual([(r["kind"], r["url"]) for r in refs], [("url", ""), ("url", "")])


class SafeUrls(unittest.TestCase):
    """Every accepted link must also parse with WHATWG new URL(); each verdict
    below was checked against Node's URL parser."""

    def url_ok(self, url: str) -> bool:
        try:
            normalize_fields({"title": "T", "references": [{"url": url}]}, creating=True)
        except ValidationError:
            return False
        return True

    def test_ordinary_links_are_accepted(self):
        for url in ("https://example.com/", "http://example.com:8080/x?y#z", "HTTP://Example.COM",
                    "http://example.com:/", "http://user:pw@example.com/", "http://münchen.de/",
                    "http://xn--mnchen-3ya.de/", "http://exa%41mple.com/", "http://1.2.3.4/",
                    "http://0x7f.1/", "http://[::1]:80/", "https://example.com/%zz/é"):
            with self.subTest(url):
                self.assertTrue(self.url_ok(url))

    def test_links_the_browser_cannot_parse_are_rejected(self):
        for url in ("http://example.com:abc/", "http://exa%zzmple/", "http://example.com:65536/",
                    "http://example.com:+80/", "http://1.2.3.256/", "http://1.2.3.4.5/",
                    "http://example.123/", "http://09.1.1.1/", "http://user@/", "http://a^b.com/",
                    "http://ex%2Fa.com/", "http://[fe80::1%25eth0]/", "http://[v1.x]/", "http://xn--zz/",
                    "http://exa mple.com/", "ftp://example.com/"):
            with self.subTest(url):
                self.assertFalse(self.url_ok(url))

    def test_control_characters_and_lone_surrogates_are_rejected_anywhere(self):
        for url in ("http://example.com/\x7f", "http://example.com/\x00", "http://example.com/\ud800"):
            with self.subTest(repr(url)):
                self.assertFalse(self.url_ok(url))


class Examples(unittest.TestCase):
    def test_examples_validate_on_every_day_across_year_ends_and_a_leap_day(self):
        day, last = _dt.date(2027, 12, 1), _dt.date(2029, 3, 31)
        while day <= last:
            for raw in examples.build(day):
                try:
                    normalize_fields(raw, creating=True)
                except ValidationError as exc:  # pragma: no cover - failure detail
                    self.fail(f"{day}: {raw['title']}: {exc}")
            day += _dt.timedelta(days=1)

    def test_relative_example_dates(self):
        built = {raw["title"]: raw.get("dates", []) for raw in examples.build(_dt.date(2027, 12, 28))}
        self.assertEqual(built["Example: Garden bed rebuild"][0]["value"], "2028-01")
        self.assertEqual(built["Example: Renew passport"][0]["value"], "2028-01-06")
        self.assertEqual(built["Example: Learn to sail"][0]["value"], "2028-Q3")
        self.assertEqual(built["Example: Write family recipe book"][0]["value"], "2028")
        self.assertEqual([d["value"] for d in built["Example: Run a 10k"]], ["2027-12-18", "2028-03"])


if __name__ == "__main__":
    unittest.main()
