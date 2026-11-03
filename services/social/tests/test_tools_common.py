"""Shared analyzer helpers: dates, URLs, word matching and input-shape limits."""

from __future__ import annotations

import unittest
from datetime import datetime, timezone

from social_service.tools import _common as common


class ParseDatetimeTests(unittest.TestCase):
    def test_zulu_and_offsets_become_utc(self) -> None:
        self.assertEqual(common.parse_datetime('2026-10-01T12:00:00Z', 'x'), datetime(2026, 10, 1, 12, tzinfo=timezone.utc))
        self.assertEqual(common.parse_datetime('2026-10-01T14:00:00+02:00', 'x'), datetime(2026, 10, 1, 12, tzinfo=timezone.utc))
        self.assertEqual(common.parse_datetime('2026-10-01T05:30:00-05:30', 'x'), datetime(2026, 10, 1, 11, tzinfo=timezone.utc))

    def test_seconds_are_optional_and_fractions_keep_microseconds(self) -> None:
        self.assertEqual(common.parse_datetime('2026-10-01T12:00Z', 'x'), datetime(2026, 10, 1, 12, tzinfo=timezone.utc))
        parsed = common.parse_datetime('2026-10-01T12:00:00.123456789Z', 'x')
        self.assertEqual(parsed.microsecond, 123456)

    def test_dst_days_use_exact_utc_arithmetic(self) -> None:
        # Local clocks read 24 hours apart across the US spring-forward day, but only 23 hours elapse.
        earlier = common.parse_datetime('2026-03-07T12:00:00-05:00', 'x')
        later = common.parse_datetime('2026-03-08T12:00:00-04:00', 'x')
        self.assertEqual(common.days_between(later, earlier), round(23 / 24, 2))

    def test_invalid_forms_name_the_field(self) -> None:
        for bad in ('2026-10-01', '2026-10-01T12:00:00', '2026-10-01 12:00:00Z', '2026-02-30T00:00:00Z', '2026-10-01T24:00:00Z',
                    '2026-10-01T12:60:00Z', '2026-10-01T23:59:60Z', '2026-10-01T12:00:00+24:00', '2026-10-01T12:00:00+01:60',
                    '2026-10-01T12:00:00Z\n', '０２０２６-10-01T12:00:00Z', '', 'nope', None, 5, ['2026-10-01T12:00:00Z']):
            with self.subTest(bad=bad), self.assertRaisesRegex(ValueError, r'^as_of must be an ISO-8601 date and time with a zone'):
                common.parse_datetime(bad, 'as_of')

    def test_extreme_years_do_not_overflow(self) -> None:
        with self.assertRaises(ValueError):
            common.parse_datetime('0001-01-01T00:00:00+05:00', 'as_of')


class ParseDateTests(unittest.TestCase):
    def test_valid_and_leap_days(self) -> None:
        self.assertEqual(common.parse_date('2028-02-29', 'x').isoformat(), '2028-02-29')

    def test_invalid(self) -> None:
        for bad in ('2027-02-29', '2026-13-01', '2026/10/01', '2026-10-01T00:00:00Z', '26-10-01', ' 2026-10-01', None, 20261001):
            with self.subTest(bad=bad), self.assertRaisesRegex(ValueError, r'^as_of must be a date in YYYY-MM-DD form'):
                common.parse_date(bad, 'as_of')


class NormalizeUrlTests(unittest.TestCase):
    def test_comparison_form(self) -> None:
        cases = {
            'HTTPS://Example.INVALID/Path': 'https://example.invalid/Path',
            'https://example.invalid': 'https://example.invalid/',
            'https://example.invalid/steeping/': 'https://example.invalid/steeping',
            'https://example.invalid/steeping#top': 'https://example.invalid/steeping',
            'https://example.invalid:443/a': 'https://example.invalid/a',
            'http://example.invalid:80/a': 'http://example.invalid/a',
            'http://example.invalid:8080/a?q=1': 'http://example.invalid:8080/a?q=1',
            'https://example.invalid/a/?q=1#f': 'https://example.invalid/a?q=1',
            'https://[::1]:8443/x': 'https://[::1]:8443/x',
            'https://example.invalid?x=1': 'https://example.invalid/?x=1',
        }
        for given, expected in cases.items():
            with self.subTest(given=given):
                self.assertEqual(common.normalize_url(given), expected)

    def test_rejects_everything_else(self) -> None:
        for bad in ('ftp://example.invalid/a', 'javascript:alert(1)', 'example.invalid/a', 'https://', 'https:///a',
                    'https://user:pw@example.invalid/', 'https://user@example.invalid/', 'https://example.invalid/a b',
                    'https://example.invalid:0/', 'https://example.invalid:70000/', 'https://exa mple.invalid/',
                    'https://example.invalid/\x00', 'https://example.invalid/' + 'a' * common.MAX_URL, '', None, 7, ['https://a.invalid/']):
            with self.subTest(bad=bad):
                self.assertIsNone(common.normalize_url(bad))

    def test_url_list_names_the_entry(self) -> None:
        self.assertEqual(common.url_list(['https://a.invalid', 'https://b.invalid/'], 'cited', 5), ['https://a.invalid/', 'https://b.invalid/'])
        with self.assertRaisesRegex(ValueError, r'^cited entry 2 must be an http or https URL'):
            common.url_list(['https://a.invalid', 'nope'], 'cited', 5)
        with self.assertRaisesRegex(ValueError, r'^cited must be a list of up to 1 http or https URLs$'):
            common.url_list(['https://a.invalid', 'https://b.invalid'], 'cited', 1)


class TermMatchingTests(unittest.TestCase):
    def match(self, text: str, term: str) -> bool:
        return common.contains_term(common.fold(text), common.fold(term))

    def test_whole_words_only(self) -> None:
        self.assertTrue(self.match('Brew some tea today', 'tea'))
        self.assertTrue(self.match('tea', 'tea'))
        self.assertTrue(self.match('Is it tea? Yes.', 'tea'))
        self.assertFalse(self.match('The steam team', 'tea'))
        self.assertFalse(self.match('teapot', 'tea'))
        self.assertFalse(self.match('green_tea', 'tea'))
        self.assertTrue(self.match('a tea-lover', 'tea'))

    def test_case_and_whitespace_folding(self) -> None:
        self.assertTrue(self.match('OOLONG', 'oolong'))
        self.assertTrue(self.match('Slow\n  Mornings', 'slow mornings'))
        self.assertTrue(self.match('STRASSE', 'straße'))

    def test_a_later_occurrence_can_match_after_an_embedded_one(self) -> None:
        self.assertTrue(self.match('steam then tea', 'tea'))

    def test_terms_with_symbols(self) -> None:
        self.assertTrue(self.match('I like C++ a lot', 'c++'))
        self.assertFalse(self.match('abc++', 'c++'))
        self.assertFalse(self.match('anything', ''))

    def test_quote_list_shapes(self) -> None:
        self.assertEqual(common.quote_list(['a']), '"a"')
        self.assertEqual(common.quote_list(['a', 'b']), '"a" and "b"')
        self.assertEqual(common.quote_list(['a', 'b', 'c']), '"a", "b" and "c"')
        self.assertEqual(common.quote_list(['a', 'b', 'c', 'd', 'e']), '"a", "b", "c" and 2 more')
        self.assertEqual(common.quote_list(['a', 'b', 'c', 'd'], 5), '"a", "b", "c" and "d"')


class InputShapeTests(unittest.TestCase):
    def test_plain_json_passes(self) -> None:
        common.check_input({'a': [1, 2.5, 'x', None, True, {'b': []}]})

    def test_depth_is_bounded(self) -> None:
        deep: object = 'x'
        for _ in range(common.MAX_DEPTH + 1):
            deep = [deep]
        with self.assertRaisesRegex(ValueError, r'^Input is nested too deeply'):
            common.check_input({'a': deep})
        deep_dict: object = 'x'
        for _ in range(common.MAX_DEPTH + 1):
            deep_dict = {'k': deep_dict}
        with self.assertRaisesRegex(ValueError, r'^Input is nested too deeply'):
            common.check_input(deep_dict)

    def test_very_deep_input_does_not_exhaust_the_stack(self) -> None:
        deep: object = 'x'
        for _ in range(50_000):
            deep = [deep]
        with self.assertRaisesRegex(ValueError, r'^Input is nested too deeply'):
            common.check_input({'a': deep})

    def test_non_finite_numbers_and_foreign_types_are_refused(self) -> None:
        for value in (float('nan'), float('inf'), -float('inf')):
            with self.subTest(value=value), self.assertRaisesRegex(ValueError, r'^Input numbers must be finite$'):
                common.check_input({'a': [value]})
        with self.assertRaisesRegex(ValueError, r'^Input must contain only plain JSON values$'):
            common.check_input({'a': (1, 2)})
        with self.assertRaisesRegex(ValueError, r'^Input keys must be text$'):
            common.check_input({1: 'a'})

    def test_the_input_must_be_an_object(self) -> None:
        for bad in (None, [], 'text', 3, ({},)):
            with self.subTest(bad=bad), self.assertRaisesRegex(ValueError, r'^Input must be a JSON object$'):
                common.check_input(bad)


class FieldValidatorTests(unittest.TestCase):
    def test_short_text_counts_code_points(self) -> None:
        self.assertEqual(common.short_text('😀' * 5, 'f', 5), '😀' * 5)
        with self.assertRaisesRegex(ValueError, r'^f must be at most 4 characters$'):
            common.short_text('😀' * 5, 'f', 4)

    def test_short_text_messages(self) -> None:
        with self.assertRaisesRegex(ValueError, r'^f must be text$'):
            common.short_text(3, 'f', 5)
        with self.assertRaisesRegex(ValueError, r'^f cannot be blank$'):
            common.short_text(' \n', 'f', 5)
        with self.assertRaisesRegex(ValueError, r'^f contains characters that cannot be stored$'):
            common.short_text('\ud800', 'f', 5)
        self.assertEqual(common.short_text('  a ', 'f', 5), 'a')
        self.assertEqual(common.short_text('  a ', 'f', 5, strip=False), '  a ')

    def test_optional_text(self) -> None:
        self.assertIsNone(common.optional_text(None, 'f', 5))
        self.assertIsNone(common.optional_text('   ', 'f', 5))
        self.assertEqual(common.optional_text(' ok ', 'f', 5), 'ok')
        with self.assertRaisesRegex(ValueError, r'^f must be text$'):
            common.optional_text(4, 'f', 5)

    def test_text_list_dedupes_ignoring_case_and_keeps_first_spelling(self) -> None:
        self.assertEqual(common.text_list(['Tea', 'tea ', 'Oolong'], 'terms', 1, 5, 10, 'terms'), ['Tea', 'Oolong'])

    def test_text_list_messages(self) -> None:
        with self.assertRaisesRegex(ValueError, r'^terms must be a list of 1–5 terms$'):
            common.text_list([], 'terms', 1, 5, 10, 'terms')
        with self.assertRaisesRegex(ValueError, r'^terms entry 2 cannot be blank$'):
            common.text_list(['a', ' '], 'terms', 1, 5, 10, 'terms')
        with self.assertRaisesRegex(ValueError, r'^terms may hold at most 5 characters in total$'):
            common.text_list(['abc', 'def'], 'terms', 1, 5, 10, 'terms', total_high=5)

    def test_whole_number(self) -> None:
        self.assertEqual(common.whole_number(5, 'n'), 5)
        self.assertEqual(common.whole_number(5.0, 'n'), 5)
        for bad in (True, -1, 1.5, '5', None, 10 ** 12 + 1):
            with self.subTest(bad=bad), self.assertRaisesRegex(ValueError, r'^n must be a whole number from 0 to 1,000,000,000,000$'):
                common.whole_number(bad, 'n')


if __name__ == '__main__':
    unittest.main()
