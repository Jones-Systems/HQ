"""Typed planning dates: strict parsing, calendar edges, and DST handling."""

from __future__ import annotations

import unittest

from support import ROOT  # noqa: F401  (puts the service on sys.path)

from planning.dates import DateError, normalize_date, period_bounds, with_derived


def _entry(**fields) -> dict:
    return {"kind": "event", "precision": "day", "value": "2026-11-14", **fields}


class StrictParsing(unittest.TestCase):
    def assertRejected(self, raw: dict, field: str):
        with self.assertRaises(DateError) as ctx:
            normalize_date(raw)
        self.assertEqual(ctx.exception.field, field)

    def test_trailing_newline_is_not_a_valid_time(self):
        self.assertRejected(_entry(time="14:30\n", tz="UTC"), "time")
        self.assertRejected(_entry(time="14:30", end_time="15:30\n", tz="UTC"), "end_time")

    def test_values_and_times_use_ascii_digits_only(self):
        arabic = str.maketrans("0123456789", "٠١٢٣٤٥٦٧٨٩")
        for precision, value in (("day", "2026-11-14"), ("week", "2026-W46"), ("month", "2026-11"),
                                 ("quarter", "2027-Q2"), ("year", "2027")):
            with self.subTest(precision):
                self.assertRejected({"kind": "target", "precision": precision,
                                     "value": value[:4].translate(arabic) + value[4:]}, "value")
        self.assertRejected(_entry(time="１４:30", tz="UTC"), "time")

    def test_non_text_optional_fields_are_not_silently_dropped(self):
        self.assertRejected(_entry(time=False, tz="UTC"), "time")
        self.assertRejected(_entry(time="09:00", end_time=0, tz="UTC"), "end_time")
        self.assertRejected(_entry(note=0), "note")
        self.assertEqual(normalize_date(_entry(time="", end_time=None, tz="", note=None))["time"], None)

    def test_note_rejects_control_characters_and_lone_surrogates(self):
        for note in ("a\x7fb", "a\nb", "a\ud800"):
            with self.subTest(repr(note)):
                self.assertRejected(_entry(note=note), "note")

    def test_padded_value_is_trimmed(self):
        self.assertEqual(normalize_date(_entry(value=" 2026-11-14 "))["value"], "2026-11-14")


class CalendarEdges(unittest.TestCase):
    def test_leap_days(self):
        self.assertEqual(period_bounds("month", "2028-02")[1].isoformat(), "2028-02-29")
        self.assertEqual(period_bounds("month", "2100-02")[1].isoformat(), "2100-02-28")
        period_bounds("day", "2000-02-29")
        for bad in ("2027-02-29", "2100-02-29"):
            with self.subTest(bad), self.assertRaises(DateError):
                period_bounds("day", bad)

    def test_iso_weeks_cross_year_boundaries(self):
        first, last = period_bounds("week", "2026-W53")
        self.assertEqual((first.isoformat(), last.isoformat()), ("2026-12-28", "2027-01-03"))
        self.assertEqual(period_bounds("week", "2027-W01")[0].isoformat(), "2027-01-04")
        with self.assertRaises(DateError):
            period_bounds("week", "2027-W53")

    def test_quarter_and_year_limits(self):
        self.assertEqual(period_bounds("quarter", "2026-Q4")[1].isoformat(), "2026-12-31")
        period_bounds("year", "1900")
        period_bounds("year", "2200")
        for value in ("1899", "2201"):
            with self.subTest(value), self.assertRaises(DateError):
                period_bounds("year", value)


class DaylightSaving(unittest.TestCase):
    def test_ambiguous_fall_back_time_uses_first_occurrence(self):
        entry = normalize_date(_entry(value="2026-11-01", time="01:30", end_time="01:45",
                                      tz="America/New_York"))
        derived = with_derived(entry)
        self.assertEqual((derived["instant"], derived["end_instant"], derived["tz_abbr"]),
                         ("2026-11-01T05:30:00Z", "2026-11-01T05:45:00Z", "EDT"))

    def test_stored_entry_that_no_longer_validates_still_reads(self):
        # Zone rules change with tzdata updates; a stored wall time that now
        # falls in a gap must not make every read of the board fail, and the
        # derived fields keep their wire shape.
        gap = {"id": "abcdefgh", "kind": "event", "precision": "day", "value": "2027-03-14",
               "time": "02:30", "end_time": "03:30", "tz": "America/New_York", "note": ""}
        derived = with_derived(gap)
        self.assertEqual((derived["instant"], derived["end_instant"], derived["tz_abbr"]),
                         ("2027-03-14T07:30:00Z", "2027-03-14T07:30:00Z", "EDT"))
        with self.assertRaises(DateError):
            normalize_date(gap)


if __name__ == "__main__":
    unittest.main()
