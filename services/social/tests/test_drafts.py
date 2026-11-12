"""Draft saves over HTTP: optimistic versions, links and planning slots, and refusals that change nothing."""

import itertools
from datetime import datetime, timedelta, timezone

from support import ServiceTestCase

CONFLICT = 'This draft changed in another window. Close and reopen it before saving.'
SLOT = {'start': '09:15', 'duration_minutes': 30, 'timezone': 'America/New_York'}


def link(entity='item-1', **changes):
    value = {'version': 1, 'domain': 'work', 'projectId': 'project-1', 'kind': 'item', 'entityId': entity,
             'title': f'Work item {entity}', 'returnDestination': {'domain': 'social', 'destination': 'library'}}
    value.update(changes)
    return value


def ticking_clock():
    moments = itertools.count()
    start = datetime(2026, 1, 15, 12, 0, 0, tzinfo=timezone.utc)
    return lambda: start + timedelta(seconds=next(moments))


class DraftCase(ServiceTestCase):
    """The clock ticks once per call: service start is 12:00:00, then each save or run adds a second."""

    def setUp(self):
        self.service_options = {'clock': ticking_clock()}
        super().setUp()

    def content(self):
        return self.get('/api/workspace').json['content']

    def stored(self, draft_id):
        return next(item for item in self.content() if item['id'] == draft_id)

    def refused(self, body, message, status=400):
        before = self.content()
        reply = self.post('/api/content', body)
        self.assertEqual((reply.status, reply.json), (status, {'error': message}))
        self.assertEqual(self.content(), before, 'A refused save must not change anything')


class Create(DraftCase):
    def test_a_title_only_save_creates_version_one_with_defaults(self):
        reply = self.post('/api/content', {'title': '  First idea  '})
        self.assertEqual(reply.status, 201)
        draft = reply.json
        self.assertRegex(draft['id'], '^[0-9a-f]{32}$')
        self.assertEqual({key: draft[key] for key in ('title', 'body', 'brand_id', 'channel', 'planned_date', 'archived',
                                                       'version', 'planning_slot', 'links')},
                         {'title': 'First idea', 'body': '', 'brand_id': 'default', 'channel': 'General',
                          'planned_date': '', 'archived': 0, 'version': 1, 'planning_slot': None, 'links': []})
        self.assertEqual(draft['updated_at'], '2026-01-15T12:00:01+00:00')
        self.assertEqual(sorted(draft), sorted(['id', 'title', 'body', 'brand_id', 'channel', 'planned_date',
                                                'planning_slot', 'archived', 'version', 'updated_at', 'links']))

    def test_every_field_round_trips(self):
        brand = self.post('/api/brands', {'name': 'B'}).json
        body = {'title': 'T', 'body': '  Body\nwith  spacing ', 'brand_id': brand['id'], 'channel': 'LinkedIn',
                'planned_date': '2026-10-22', 'archived': True, 'planning_slot': SLOT, 'links': [link()]}
        draft = self.post('/api/content', body).json
        self.assertEqual((draft['body'], draft['brand_id'], draft['channel'], draft['planned_date'], draft['archived']),
                         ('  Body\nwith  spacing ', brand['id'], 'LinkedIn', '2026-10-22', 1))
        self.assertEqual((draft['planning_slot'], draft['links']), (SLOT, [link()]))
        self.assertEqual(self.stored(draft['id']), draft)

    def test_an_empty_or_null_id_creates_and_ignores_the_version(self):
        for falsy in ('', None, 0, False):
            with self.subTest(id=falsy):
                self.assertEqual(self.post('/api/content', {'title': 'x', 'id': falsy, 'version': 7}).status, 201)
        self.assertEqual(len({item['id'] for item in self.content()}), 4)

    def test_text_survives_exactly(self):
        title = 'Café 茶 😀'
        body = 'x' * 50_000
        draft = self.post('/api/content', {'title': title, 'body': body}).json
        self.assertEqual(self.stored(draft['id'])['title'], title)
        self.assertEqual(len(self.stored(draft['id'])['body']), 50_000)

    def test_content_is_newest_first(self):
        first = self.harness.save(title='first')
        second = self.harness.save(title='second')
        self.harness.save(title='first again', id=first['id'], version=1)
        self.assertEqual([item['title'] for item in self.content()], ['first again', 'second'])
        self.assertEqual(second['version'], 1)

    def test_refusals_create_nothing(self):
        for body, message in (({'title': ''}, 'Title must be text, 1–200 characters'),
                              ({'title': 'x', 'channel': 'Fax'}, 'Unknown channel'),
                              ({'title': 'x', 'unexpected': 1}, 'Unknown field: unexpected'),
                              ({'title': 'x', 'brand_id': 'nope'}, 'Unknown brand'),
                              ({'title': 'x', 'planned_date': '2026-02-30'}, 'Use a YYYY-MM-DD planning date')):
            with self.subTest(message=message):
                self.refused(body, message)
        self.assertEqual(self.content(), [])


class Update(DraftCase):
    def test_a_matching_version_updates_and_adds_one(self):
        draft = self.harness.save(title='One')
        reply = self.post('/api/content', {'title': 'Two', 'id': draft['id'], 'version': 1})
        self.assertEqual(reply.status, 200)
        self.assertEqual((reply.json['id'], reply.json['version'], reply.json['title']), (draft['id'], 2, 'Two'))
        self.assertEqual(reply.json['updated_at'], '2026-01-15T12:00:02+00:00')
        again = self.post('/api/content', {'title': 'Three', 'id': draft['id'], 'version': 2}).json
        self.assertEqual(again['version'], 3)
        self.assertEqual(len(self.content()), 1)

    def test_a_stale_version_is_a_conflict_and_changes_nothing(self):
        draft = self.harness.save(title='One', links=[link()])
        self.harness.save(title='Two', id=draft['id'], version=1)
        self.refused({'title': 'Lost', 'id': draft['id'], 'version': 1, 'links': []}, CONFLICT, 409)
        self.assertEqual(self.stored(draft['id'])['title'], 'Two')
        self.assertEqual(self.stored(draft['id'])['links'], [link()])

    def test_future_and_zero_versions_conflict_too(self):
        draft = self.harness.save()
        for version in (0, 2, 99):
            with self.subTest(version=version):
                self.refused({'title': 'x', 'id': draft['id'], 'version': version}, CONFLICT, 409)

    def test_an_unknown_id_is_a_conflict_and_never_creates(self):
        self.refused({'title': 'x', 'id': 'f' * 32, 'version': 1}, CONFLICT, 409)
        self.refused({'title': 'x', 'id': 'short', 'version': 1}, CONFLICT, 409)
        self.assertEqual(self.content(), [])

    def test_two_windows_cannot_both_save_one_version(self):
        draft = self.harness.save()
        first = self.post('/api/content', {'title': 'Window A', 'id': draft['id'], 'version': 1})
        second = self.post('/api/content', {'title': 'Window B', 'id': draft['id'], 'version': 1})
        self.assertEqual((first.status, second.status), (200, 409))
        self.assertEqual(self.stored(draft['id'])['title'], 'Window A')

    def test_id_length_is_measured_before_stripping(self):
        # Parity with checkDraft: a full-length id cannot be padded, so a padded id is a text error, not a lookup.
        draft = self.harness.save()
        self.refused({'title': 'x', 'id': f' {draft["id"]}', 'version': 1}, 'ID must be text, 1–32 characters')
        self.assertEqual(self.post('/api/content', {'title': 'x', 'id': draft['id'], 'version': 1}).status, 200)

    def test_archive_and_restore(self):
        draft = self.harness.save()
        archived = self.post('/api/content', {'title': 'Draft', 'id': draft['id'], 'version': 1, 'archived': True}).json
        restored = self.post('/api/content', {'title': 'Draft', 'id': draft['id'], 'version': 2, 'archived': 0}).json
        self.assertEqual((archived['archived'], restored['archived'], restored['version']), (1, 0, 3))

    def test_validation_errors_are_400_and_checked_before_the_version(self):
        draft = self.harness.save()
        self.refused({'title': '', 'id': draft['id'], 'version': 99}, 'Title must be text, 1–200 characters')
        self.refused({'title': 'x', 'id': draft['id'], 'version': 'one'}, 'Version required')
        self.refused({'title': 'x', 'id': draft['id']}, 'Version required')
        self.refused({'title': 'x', 'id': draft['id'], 'version': 1, 'brand_id': 'nope'}, 'Unknown brand')


class Links(DraftCase):
    def test_links_are_stored_normalized_and_in_order(self):
        draft = self.harness.save(links=[link('b'), link('a', workspaceId='ws', sourceRevision='r1')])
        self.assertEqual([item['entityId'] for item in draft['links']], ['b', 'a'])
        self.assertEqual(draft['links'][1]['sourceRevision'], 'r1')
        self.assertEqual(self.stored(draft['id'])['links'], draft['links'])

    def test_omitting_links_preserves_them(self):
        draft = self.harness.save(links=[link()])
        updated = self.harness.save(title='Retitled', id=draft['id'], version=1)
        self.assertEqual(updated['links'], [link()])
        self.assertEqual(self.stored(draft['id'])['links'], [link()])

    def test_an_empty_list_clears_them(self):
        draft = self.harness.save(links=[link(), link('2')])
        cleared = self.harness.save(id=draft['id'], version=1, links=[])
        self.assertEqual(cleared['links'], [])
        self.assertEqual(self.stored(draft['id'])['links'], [])

    def test_a_replacement_list_replaces(self):
        draft = self.harness.save(links=[link('1')])
        replaced = self.harness.save(id=draft['id'], version=1, links=[link('2'), link('3')])
        self.assertEqual([item['entityId'] for item in replaced['links']], ['2', '3'])

    def test_links_are_always_present_in_the_response(self):
        self.assertEqual(self.harness.save()['links'], [])

    def test_a_repeated_target_is_refused_without_mutation(self):
        message = 'Each HQ reference can be linked once'
        self.refused({'title': 'x', 'links': [link(), link(title='Another title')]}, message)
        draft = self.harness.save(links=[link('keep')])
        self.refused({'title': 'changed', 'id': draft['id'], 'version': 1, 'links': [link(), link()]}, message)
        self.assertEqual(self.stored(draft['id'])['title'], 'Draft')
        self.assertEqual(self.stored(draft['id'])['version'], 1)

    def test_the_same_entity_in_another_domain_or_kind_is_allowed(self):
        draft = self.harness.save(links=[link(), link(domain='design'), link(kind='board')])
        self.assertEqual(len(draft['links']), 3)

    def test_invalid_references_are_refused_without_mutation(self):
        message = 'Links must be a list of 0–30 valid HQ references'
        draft = self.harness.save(links=[link()])
        for bad in (None, 'x', {}, [None], [{'domain': 'work'}], [link(version=2)], [link(extra=1)],
                    [link(returnDestination={'domain': 'social', 'destination': 'https://evil.example'})],
                    [link(title=' padded ')], [link(entityId='')], [link(domain='mail')]):
            with self.subTest(links=str(bad)[:60]):
                self.refused({'title': 'x', 'id': draft['id'], 'version': 1, 'links': bad}, message)

    def test_at_most_thirty_links(self):
        thirty = [link(str(index)) for index in range(30)]
        self.assertEqual(len(self.harness.save(links=thirty)['links']), 30)
        self.refused({'title': 'x', 'links': thirty + [link('31')]}, 'Links must be a list of 0–30 valid HQ references')


class Slots(DraftCase):
    def test_a_slot_is_stored_and_returned(self):
        draft = self.harness.save(planned_date='2026-10-22', planning_slot=SLOT)
        self.assertEqual(draft['planning_slot'], SLOT)
        self.assertEqual(self.stored(draft['id'])['planning_slot'], SLOT)

    def test_a_new_draft_without_a_slot_has_none_and_the_key_is_present(self):
        draft = self.harness.save(planned_date='2026-10-22')
        self.assertIn('planning_slot', draft)
        self.assertIsNone(draft['planning_slot'])

    def test_omitting_the_slot_on_update_keeps_it(self):
        draft = self.harness.save(planned_date='2026-10-22', planning_slot=SLOT)
        kept = self.harness.save(title='Retitled', planned_date='2026-10-22', id=draft['id'], version=1)
        self.assertEqual(kept['planning_slot'], SLOT)

    def test_null_clears_it(self):
        draft = self.harness.save(planned_date='2026-10-22', planning_slot=SLOT)
        cleared = self.harness.save(planned_date='2026-10-22', planning_slot=None, id=draft['id'], version=1)
        self.assertIsNone(cleared['planning_slot'])
        self.assertIsNone(self.stored(draft['id'])['planning_slot'])

    def test_a_new_slot_replaces_the_old_one(self):
        draft = self.harness.save(planned_date='2026-10-22', planning_slot=SLOT)
        other = {'start': '14:00', 'duration_minutes': 60, 'timezone': 'UTC'}
        replaced = self.harness.save(planned_date='2026-10-22', planning_slot=other, id=draft['id'], version=1)
        self.assertEqual(replaced['planning_slot'], other)

    def test_an_omitted_slot_is_revalidated_against_the_new_date(self):
        gap = {'start': '02:30', 'duration_minutes': 30, 'timezone': 'America/New_York'}
        draft = self.harness.save(planned_date='2026-03-01', planning_slot=gap)
        moved_but_valid = self.harness.save(planned_date='2026-03-02', id=draft['id'], version=1)
        self.assertEqual(moved_but_valid['planning_slot'], gap)
        into_the_gap = self.harness.save(planned_date='2026-03-08', id=draft['id'], version=2)
        self.assertIsNone(into_the_gap['planning_slot'], 'The spring-forward gap makes 02:30 invalid, so the slot is dropped')
        self.assertEqual(into_the_gap['version'], 3)

    def test_clearing_the_date_drops_an_omitted_slot(self):
        draft = self.harness.save(planned_date='2026-10-22', planning_slot=SLOT)
        unplanned = self.harness.save(planned_date='', id=draft['id'], version=1)
        self.assertIsNone(unplanned['planning_slot'])

    def test_invalid_slots_are_refused_and_change_nothing(self):
        draft = self.harness.save(planned_date='2026-10-22', planning_slot=SLOT)
        cases = {
            'Planning time must have start, duration_minutes and timezone': {'start': '09:00'},
            'Use an HH:MM start on a 15-minute boundary': {**SLOT, 'start': '09:07'},
            'Duration must be 15-minute steps ending by midnight': {**SLOT, 'duration_minutes': 20},
            'Unknown time zone': {**SLOT, 'timezone': 'Invented/Nowhere'},
            'That time is skipped, repeated or crosses a daylight-saving change':
                {'start': '02:30', 'duration_minutes': 30, 'timezone': 'America/New_York'},
        }
        for message, slot in cases.items():
            with self.subTest(message=message):
                date = '2026-03-08' if 'daylight' in message else '2026-10-22'
                self.refused({'title': 'x', 'planned_date': date, 'planning_slot': slot, 'id': draft['id'], 'version': 1},
                             message)
        self.assertEqual(self.stored(draft['id'])['planning_slot'], SLOT)

    def test_a_slot_needs_a_date(self):
        self.refused({'title': 'x', 'planning_slot': SLOT}, 'Planning time needs a planning date')
        self.refused({'title': 'x', 'planned_date': '', 'planning_slot': SLOT}, 'Planning time needs a planning date')

    def test_slot_cases_agree_with_the_dst_rules_end_to_end(self):
        ends_before_gap = {'start': '01:30', 'duration_minutes': 30, 'timezone': 'America/New_York'}
        self.assertEqual(self.harness.save(planned_date='2026-03-08', planning_slot=ends_before_gap)['planning_slot'],
                         ends_before_gap)
        repeated = {'start': '01:30', 'duration_minutes': 30, 'timezone': 'America/New_York'}
        self.refused({'title': 'x', 'planned_date': '2026-11-01', 'planning_slot': repeated},
                     'That time is skipped, repeated or crosses a daylight-saving change')


class WithoutZoneData(DraftCase):
    def setUp(self):
        super().setUp()
        self.restart(timezones=False, clock=ticking_clock())

    def test_timeboxes_are_not_advertised(self):
        self.assertEqual(self.get('/api/workspace').json['features'], ['hq-references-v1', 'hq-brand-project-v1', 'hq-sources-v1'])

    def test_any_non_null_slot_is_an_unknown_time_zone(self):
        self.refused({'title': 'x', 'planned_date': '2026-10-22', 'planning_slot': SLOT}, 'Unknown time zone')
        self.refused({'title': 'x', 'planned_date': '2026-10-22', 'planning_slot': {'start': '09:00', 'duration_minutes': 30, 'timezone': 'UTC'}},
                     'Unknown time zone')

    def test_null_and_omitted_slots_still_save(self):
        draft = self.harness.save(planned_date='2026-10-22', planning_slot=None)
        self.assertIsNone(draft['planning_slot'])
        self.assertIsNone(self.harness.save(id=draft['id'], version=1)['planning_slot'])

    def test_a_stored_slot_survives_unrelated_edits_and_is_dropped_when_the_date_moves(self):
        # A slot is stored by a service that had zone data, then read by one that does not.
        self.restart(timezones=True, clock=ticking_clock())
        draft = self.harness.save(planned_date='2026-10-22', planning_slot=SLOT)
        self.restart(timezones=False, clock=ticking_clock())
        kept = self.harness.save(title='Retitled', planned_date='2026-10-22', id=draft['id'], version=1)
        self.assertEqual(kept['planning_slot'], SLOT)
        moved = self.harness.save(planned_date='2026-10-23', id=draft['id'], version=2)
        self.assertIsNone(moved['planning_slot'])
