"""Validation parity with ``checkDraft``, ``checkBrandName`` and ``checkRunSubmission``: rules, messages and order."""

import unittest

import support  # noqa: F401 - puts the service on sys.path

from social_service import tools, validation
from social_service.errors import ValidationError
from social_service.validation import UNSET

BRANDS = {'default', 'brand-1'}
SLOT = {'start': '09:00', 'duration_minutes': 30, 'timezone': 'UTC'}
TITLE = 'Title must be text, 1–200 characters'
BODY = 'Body must be text, 0–50000 characters'


def draft(**fields):
    fields.setdefault('title', 'A draft')
    return fields


class DraftCase(unittest.TestCase):
    def check(self, data, **options):
        return validation.check_draft(data, brand_ids=BRANDS, **options)

    def message(self, data, **options):
        with self.assertRaises(ValidationError) as caught:
            self.check(data, **options)
        self.assertEqual(caught.exception.status, 400)
        return caught.exception.message


class DraftFields(DraftCase):
    def test_defaults_for_a_title_only_save(self):
        checked = self.check({'title': '  Hello  '})
        self.assertEqual((checked.title, checked.body, checked.brand_id, checked.channel, checked.planned_date,
                          checked.archived), ('Hello', '', 'default', 'General', '', 0))
        self.assertIs(checked.slot, UNSET)
        self.assertIs(checked.links, UNSET)
        self.assertIsNone(checked.target)

    def test_unknown_keys_are_refused_before_any_value_rule(self):
        self.assertEqual(self.message({'title': 'x', 'nope': 1}), 'Unknown field: nope')
        self.assertEqual(self.message({'nope': 1}), 'Unknown field: nope')  # even though the title is missing
        self.assertEqual(self.message({'title': 5, 'first': 1, 'second': 2}), 'Unknown field: first')
        for key in ('csrf', 'updated_at', 'Title', 'project_id'):
            self.assertEqual(self.message(draft(**{key: 'x'})), f'Unknown field: {key}')

    def test_title(self):
        for bad in (None, 5, True, ['x'], {}, '', '   ', '\t\n', 'x' * 201):
            self.assertEqual(self.message({'title': bad}), TITLE, repr(bad))
        self.assertEqual(self.message({}), TITLE)
        self.assertEqual(self.check({'title': 'x' * 200}).title, 'x' * 200)
        self.assertEqual(self.check({'title': ' padded　'}).title, 'padded')  # Python str.strip

    def test_lengths_count_code_points_not_utf16_units(self):
        self.assertEqual(self.check({'title': '😀' * 200}).title, '😀' * 200)
        self.assertEqual(self.message({'title': '😀' * 201}), TITLE)
        # Length is checked on the raw value, before stripping.
        self.assertEqual(self.message({'title': ' ' + 'x' * 200}), TITLE)

    def test_lone_surrogates_are_text_errors_not_server_errors(self):
        self.assertEqual(self.message({'title': 'bad\ud800'}), TITLE)
        self.assertEqual(self.message(draft(body='bad\udc00')), BODY)

    def test_body_may_be_empty_and_is_kept_verbatim(self):
        self.assertEqual(self.check(draft(body='  keep\n  me  ')).body, '  keep\n  me  ')
        self.assertEqual(self.check(draft(body='')).body, '')
        self.assertEqual(self.check(draft(body='b' * 50_000)).body, 'b' * 50_000)
        for bad in (None, 3, False, [], 'b' * 50_001):
            self.assertEqual(self.message(draft(body=bad)), BODY, repr(bad))

    def test_channel(self):
        for channel in validation.CHANNELS:
            self.assertEqual(self.check(draft(channel=channel)).channel, channel)
        for bad in ('x', 'general', '', None, 3, ['X'], {}):
            self.assertEqual(self.message(draft(channel=bad)), 'Unknown channel', repr(bad))

    def test_planned_date(self):
        self.assertEqual(self.check(draft(planned_date='2026-10-22')).planned_date, '2026-10-22')
        self.assertEqual(self.check(draft(planned_date='')).planned_date, '')
        for bad in ('2026-13-01', '2026-02-30', '2026-1-1', ' 2026-10-22', '2026-10-22\n', '20261022', 'tomorrow',
                    20261022, True, ['2026-10-22'], {'a': 1}):
            self.assertEqual(self.message(draft(planned_date=bad)), 'Use a YYYY-MM-DD planning date', repr(bad))
        for falsy in (None, 0, 0.0, False, [], {}):
            self.assertEqual(self.message(draft(planned_date=falsy)), 'Planning date must be text', repr(falsy))

    def test_archived(self):
        for value, stored in ((True, 1), (False, 0), (1, 1), (0, 0)):
            self.assertEqual(self.check(draft(archived=value)).archived, stored)
        for bad in ('bad', 2, -1, 1.0, 0.0, None, [], 'true'):
            self.assertEqual(self.message(draft(archived=bad)), 'Invalid archive state', repr(bad))

    def test_brand(self):
        self.assertEqual(self.check(draft(brand_id='brand-1')).brand_id, 'brand-1')
        for bad in ('unknown', '', None, 3, ['default']):
            self.assertEqual(self.message(draft(brand_id=bad)), 'Unknown brand', repr(bad))

    def test_id_and_version(self):
        self.assertEqual(self.check(draft(id=' abc ', version=3)).target, ('abc', 3))
        # A falsy id means create, and version is then ignored.
        for falsy in ('', None, 0, False, [], {}):
            self.assertIsNone(self.check(draft(id=falsy, version='ignored')).target, repr(falsy))
        for bad in (5, True, ['a'], {'a': 1}, 'x' * 33, '  '):
            self.assertEqual(self.message(draft(id=bad, version=1)), 'ID must be text, 1–32 characters', repr(bad))
        self.assertEqual(self.check(draft(id='x' * 32, version=1)).target, ('x' * 32, 1))
        for bad in (None, True, '3', 1.5, 3.0, [], 2 ** 53, -(2 ** 53)):
            self.assertEqual(self.message(draft(id='abc', version=bad)), 'Version required', repr(bad))
        self.assertEqual(self.message(draft(id='abc')), 'Version required')
        self.assertEqual(self.check(draft(id='abc', version=2 ** 53 - 1)).target, ('abc', 2 ** 53 - 1))
        self.assertEqual(self.check(draft(id='abc', version=0)).target, ('abc', 0))

    def test_slot_is_absent_null_or_canonical(self):
        self.assertIs(self.check(draft()).slot, UNSET)
        self.assertIsNone(self.check(draft(planning_slot=None)).slot)
        self.assertEqual(self.check(draft(planned_date='2026-10-22', planning_slot=SLOT)).slot, SLOT)
        self.assertEqual(self.message(draft(planning_slot=SLOT)), 'Planning time needs a planning date')
        self.assertEqual(self.message(draft(planned_date='2026-10-22', planning_slot={})),
                         'Planning time must have start, duration_minutes and timezone')

    def test_links_are_absent_empty_or_validated(self):
        self.assertIs(self.check(draft()).links, UNSET)
        self.assertEqual(self.check(draft(links=[])).links, [])
        self.assertEqual(self.message(draft(links=None)), 'Links must be a list of 0–30 valid HQ references')
        self.assertEqual(self.message(draft(links=[{'x': 1}])), 'Links must be a list of 0–30 valid HQ references')


class DraftCheckOrder(DraftCase):
    """Each step names the first of two defects; the earlier rule in checkDraft must win."""

    def test_checks_run_in_the_order_of_check_draft(self):
        worst = {
            'title': 5, 'body': 5, 'channel': 'x', 'planned_date': 'x', 'archived': 'x', 'planning_slot': 'x',
            'brand_id': 'x', 'id': 5, 'version': 'x', 'links': 'x',
        }
        expected = [
            ('title', TITLE), ('body', BODY), ('channel', 'Unknown channel'),
            ('planned_date', 'Use a YYYY-MM-DD planning date'), ('archived', 'Invalid archive state'),
            ('planning_slot', 'Planning time needs a planning date'), ('brand_id', 'Unknown brand'),
            ('id', 'ID must be text, 1–32 characters'), ('version', 'Version required'),
            ('links', 'Links must be a list of 0–30 valid HQ references'),
        ]
        repaired = {'title': 'ok', 'body': '', 'channel': 'General', 'planned_date': '', 'archived': False,
                    'planning_slot': None, 'brand_id': 'default', 'id': 'abc', 'version': 1, 'links': []}
        remaining = dict(worst)
        for field, message in expected:
            with self.subTest(field=field):
                self.assertEqual(self.message(dict(remaining)), message)
            remaining[field] = repaired[field]
        self.assertEqual(self.check(remaining).target, ('abc', 1))

    def test_slot_is_checked_after_archive_and_before_brand_and_version(self):
        fields = {'title': 'Test', 'planned_date': '2026-10-22', 'planning_slot': {}, 'brand_id': 3, 'id': 'id'}
        self.assertEqual(self.message({**fields, 'archived': 'bad'}), 'Invalid archive state')
        self.assertEqual(self.message(fields), 'Planning time must have start, duration_minutes and timezone')

    def test_an_unavailable_zone_database_rejects_slots_at_the_slot_step(self):
        fields = draft(planned_date='2026-10-22', planning_slot=SLOT, brand_id='unknown')
        self.assertEqual(self.message(fields, timezones=False), 'Unknown time zone')
        self.assertEqual(self.message({**fields, 'archived': 'x'}, timezones=False), 'Invalid archive state')
        self.assertEqual(self.check(draft(planning_slot=None), timezones=False).slot, None)


class BrandCase(unittest.TestCase):
    def message(self, data):
        with self.assertRaises(ValidationError) as caught:
            validation.check_brand(data)
        return caught.exception.message

    def test_name_is_stripped_text_of_one_to_eighty_characters(self):
        self.assertEqual(validation.check_brand({'name': '  Larkspur Tea Co.  '}), 'Larkspur Tea Co.')
        self.assertEqual(validation.check_brand({'name': 'n' * 80}), 'n' * 80)
        for bad in ('', '   ', 'n' * 81, None, 5, True, ['x']):
            self.assertEqual(self.message({'name': bad}), 'Brand name must be text, 1–80 characters', repr(bad))
        self.assertEqual(self.message({}), 'Brand name must be text, 1–80 characters')

    def test_only_name_is_accepted(self):
        self.assertEqual(self.message({'name': 'x', 'project_id': 'p'}), 'Unknown field: project_id')
        self.assertEqual(self.message({'extra': 1}), 'Unknown field: extra')


class RunCase(unittest.TestCase):
    def message(self, data):
        with self.assertRaises(ValidationError) as caught:
            validation.check_run(data)
        return caught.exception.message

    def test_a_known_tool_and_object_input(self):
        for tool in tools.TOOL_IDS:
            checked = validation.check_run({'tool': tool, 'input': {'a': 1}, 'is_example': True})
            self.assertEqual((checked.tool, checked.input, checked.is_example), (tool, {'a': 1}, True))
        self.assertFalse(validation.check_run({'tool': 'x-studio', 'input': {}}).is_example)

    def test_tool_and_input_message(self):
        message = 'Choose a known tool and supply a JSON object'
        for data in ({}, {'tool': 'x-studio'}, {'input': {}}, {'tool': 'nope', 'input': {}},
                     {'tool': 'X-Studio', 'input': {}}, {'tool': None, 'input': {}}, {'tool': ['x-studio'], 'input': {}},
                     {'tool': 'x-studio', 'input': []}, {'tool': 'x-studio', 'input': 'x'},
                     {'tool': 'x-studio', 'input': None}):
            self.assertEqual(self.message(data), message, data)

    def test_example_flag_is_boolean_and_checked_after_tool_and_input(self):
        for bad in (1, 0, 'true', None, [], {}):
            self.assertEqual(self.message({'tool': 'x-studio', 'input': {}, 'is_example': bad}),
                             'Example label must be boolean', repr(bad))
        self.assertEqual(self.message({'tool': 'nope', 'input': [], 'is_example': 'x'}),
                         'Choose a known tool and supply a JSON object')

    def test_only_the_three_keys_are_accepted(self):
        self.assertEqual(self.message({'tool': 'x-studio', 'input': {}, 'is_example': False, 'extra': 1}),
                         'Unknown field: extra')
        self.assertEqual(self.message({'tool': 'nope', 'zzz': 1}), 'Unknown field: zzz')


class IdentifierCase(unittest.TestCase):
    def test_run_ids_are_exactly_32_lowercase_hex(self):
        good = '0123456789abcdef0123456789abcdef'
        self.assertEqual(validation.check_run_id(good), good)
        for bad in (good.upper(), good[:-1], good + '0', good + '\n', 'g' * 32, '', None, 5, [good]):
            with self.assertRaises(ValidationError) as caught:
                validation.check_run_id(bad)
            self.assertEqual(caught.exception.message, 'Invalid run ID', repr(bad))

    def test_tools(self):
        self.assertEqual(validation.check_tool('x-studio'), 'x-studio')
        for bad in ('nope', '', None, 3, 'x-studio/'):
            with self.assertRaises(ValidationError) as caught:
                validation.check_tool(bad)
            self.assertEqual(caught.exception.message, 'Unknown tool')

    def test_message_catalog_matches_hq_core(self):
        self.assertEqual(validation.text_message('Title', 200), TITLE)
        self.assertEqual(validation.text_message('Body', 50_000, True), BODY)
        expected = {
            'unknown_channel': 'Unknown channel', 'planned_date': 'Use a YYYY-MM-DD planning date',
            'planned_date_text': 'Planning date must be text', 'archived': 'Invalid archive state',
            'unknown_brand': 'Unknown brand', 'version': 'Version required',
            'conflict': 'This draft changed in another window. Close and reopen it before saving.',
            'run_input': 'Choose a known tool and supply a JSON object',
            'example_flag': 'Example label must be boolean',
            'queue_full': 'Run queue is full. Wait for a run to finish.', 'run_id': 'Invalid run ID',
            'unknown_tool': 'Unknown tool', 'body_size': 'Input must be 1–2,000,000 bytes',
            'json_object': 'JSON object required',
            'interrupted': 'Service restarted before completion; run again explicitly.',
            'links_invalid': 'Links must be a list of 0–30 valid HQ references',
        }
        for key, text in expected.items():
            self.assertEqual(validation.MESSAGES[key], text, key)


if __name__ == '__main__':
    unittest.main()
