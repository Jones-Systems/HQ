"""Editorial time slots: the shared source-data cases plus the service-only rules."""

import json
import unittest
from datetime import date

from support import ROOT

from social_service import timebox
from social_service.errors import ValidationError

CASES = json.loads((ROOT.parent.parent / 'modules/social/core/test/fixtures/planning-slot-cases.json').read_text())


class SharedCases(unittest.TestCase):
    def test_every_shared_case_matches_hq_core(self):
        self.assertGreaterEqual(len(CASES), 30)
        for case in CASES:
            with self.subTest(case['name']):
                if case['error'] is None:
                    self.assertEqual(timebox.check_slot(case['planning_slot'], case['planned_date']),
                                     case['planning_slot'])
                else:
                    with self.assertRaises(ValidationError) as caught:
                        timebox.check_slot(case['planning_slot'], case['planned_date'])
                    self.assertEqual(caught.exception.message, case['error'])

    def test_float_lexeme_is_a_service_only_rejection(self):
        # JavaScript canonicalizes 30.0 to 30; the service sees the lexeme and refuses it.
        case = next(item for item in CASES if item['name'] == 'duration-float')
        self.assertIsInstance(case['planning_slot']['duration_minutes'], float)
        with self.assertRaises(ValidationError) as caught:
            timebox.check_slot(case['planning_slot'], case['planned_date'])
        self.assertEqual(caught.exception.message, timebox.SLOT_MESSAGES['duration'])


class SlotRules(unittest.TestCase):
    def test_null_is_always_accepted_even_without_a_date_or_zone_data(self):
        self.assertIsNone(timebox.check_slot(None, ''))
        self.assertIsNone(timebox.check_slot(None, '', timezones=False))

    def test_without_zone_data_any_slot_is_an_unknown_time_zone(self):
        for slot in ({'start': '09:00', 'duration_minutes': 30, 'timezone': 'UTC'}, {}, [], 'x'):
            with self.subTest(slot=slot), self.assertRaises(ValidationError) as caught:
                timebox.check_slot(slot, '2026-10-22', timezones=False)
            self.assertEqual(caught.exception.message, 'Unknown time zone')

    def test_zone_data_is_detected_through_new_york(self):
        self.assertTrue(timebox.timezone_data_available())
        self.assertIsNone(timebox.load_zone('Invented/Nowhere'))
        self.assertIsNone(timebox.load_zone(['UTC']))
        self.assertIsNone(timebox.load_zone('posixrules'))

    def test_start_must_be_a_padded_ascii_quarter_hour(self):
        for start in ('09:00\n', '٠٩:٠٠', '9:00', '09:60', '09:05'):
            with self.subTest(start=start), self.assertRaises(ValidationError):
                timebox.check_slot({'start': start, 'duration_minutes': 15, 'timezone': 'UTC'}, '2026-10-22')

    def test_planning_dates(self):
        for good in ('2024-02-29', '0001-01-01', '9999-12-31'):
            self.assertTrue(timebox.is_planning_date(good), good)
        for bad in ('2026-02-29', '0000-01-01', '2026-1-1', '2026-10-22 ', '٢٠٢٦-١٠-٢٢', '2026-13-01', '20261022'):
            self.assertFalse(timebox.is_planning_date(bad), bad)


class Revalidation(unittest.TestCase):
    SLOT = {'start': '02:30', 'duration_minutes': 30, 'timezone': 'America/New_York'}

    def test_a_stored_slot_is_kept_while_it_still_fits_the_date(self):
        self.assertEqual(timebox.revalidate_stored(self.SLOT, '2026-03-01', '2026-03-01'), self.SLOT)
        self.assertEqual(timebox.revalidate_stored(self.SLOT, '2026-03-02', '2026-03-01'), self.SLOT)

    def test_it_is_dropped_when_the_new_date_makes_it_invalid(self):
        self.assertIsNone(timebox.revalidate_stored(self.SLOT, '2026-03-08', '2026-03-01'))  # spring-forward gap
        self.assertIsNone(timebox.revalidate_stored(self.SLOT, '', '2026-03-01'))  # no date

    def test_no_slot_stays_no_slot(self):
        self.assertIsNone(timebox.revalidate_stored(None, '2026-03-01', '2026-03-01'))

    def test_without_zone_data_only_an_unchanged_date_keeps_it(self):
        self.assertEqual(timebox.revalidate_stored(self.SLOT, '2026-03-01', '2026-03-01', timezones=False), self.SLOT)
        self.assertIsNone(timebox.revalidate_stored(self.SLOT, '2026-03-02', '2026-03-01', timezones=False))

    def test_instants_are_unique_only_outside_transitions(self):
        zone = timebox.load_zone('America/New_York')
        self.assertIsNotNone(timebox.slot_instant(date(2026, 3, 8), 3 * 60, zone))
        self.assertIsNone(timebox.slot_instant(date(2026, 3, 8), 2 * 60 + 30, zone))
        self.assertIsNone(timebox.slot_instant(date(2026, 11, 1), 60 + 30, zone))


if __name__ == '__main__':
    unittest.main()
