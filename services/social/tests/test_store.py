"""SQLite store: migrations, optimistic versions, atomic updates and run bookkeeping."""

import itertools
import sqlite3
import stat
import threading
import unittest
from unittest import mock

from support import ScratchTestCase, raw_db

from social_service import store as store_module
from social_service.errors import ConflictError
from social_service.store import Store, StoreError
from social_service.validation import UNSET, DraftInput

NOW = '2026-01-15T12:00:00+00:00'
CONFLICT = 'This draft changed in another window. Close and reopen it before saving.'


def draft(**changes):
    values = dict(title='Draft', body='', brand_id='default', channel='General', planned_date='', archived=0,
                  slot=UNSET, links=UNSET, target=None)
    values.update(changes)
    return DraftInput(**values)


class StoreCase(ScratchTestCase):
    def setUp(self):
        super().setUp()
        self.path = self.scratch / 'hq-social.sqlite3'
        self.store = Store(self.path)
        self.addCleanup(self.store.close)
        self.counter = itertools.count(1)

    def new_id(self):
        return f'{next(self.counter):032x}'

    def save(self, **changes):
        return self.store.save_draft(draft(**changes), new_id=self.new_id, now=NOW, timezones=True)


class Schema(StoreCase):
    def test_a_new_store_is_current_and_seeds_the_default_brand(self):
        self.assertEqual(self.store.schema_version, len(store_module.MIGRATIONS))
        self.assertEqual(self.store.brands(), [{'id': 'default', 'name': 'My workspace'}])
        self.assertEqual(self.store.brand_ids(), {'default'})

    def test_the_database_file_is_private(self):
        self.assertEqual(stat.S_IMODE(self.path.stat().st_mode), 0o600)

    def test_tables_match_the_contract(self):
        with raw_db(self.path) as db:
            columns = {table: [row[1] for row in db.execute(f'PRAGMA table_info({table})')]
                       for table in ('brands', 'content', 'runs')}
        self.assertEqual(columns['brands'], ['id', 'name', 'project_id'])
        self.assertEqual(columns['content'], ['id', 'title', 'body', 'brand_id', 'channel', 'planned_date',
                                              'planning_slot', 'links', 'archived', 'version', 'updated_at'])
        self.assertEqual(columns['runs'], ['id', 'tool', 'status', 'is_example', 'created_at', 'finished_at', 'error'])

    def test_reopening_keeps_data_and_does_not_reseed(self):
        self.save(title='Kept')
        self.store.add_brand('b1', 'Brand')
        self.store.close()
        reopened = Store(self.path)
        self.addCleanup(reopened.close)
        self.assertEqual([item['title'] for item in reopened.drafts()], ['Kept'])
        self.assertEqual([item['id'] for item in reopened.brands()], ['b1', 'default'])

    def test_a_missing_default_brand_is_restored(self):
        with raw_db(self.path) as db:
            db.execute("DELETE FROM brands WHERE id = 'default'")
        self.store.close()
        reopened = Store(self.path)
        self.addCleanup(reopened.close)
        self.assertEqual(reopened.brand_ids(), {'default'})

    def test_migrations_only_move_forward_and_keep_data(self):
        self.save(title='Survives')
        self.store.close()

        def v2(db):
            db.execute('ALTER TABLE content ADD COLUMN note TEXT')

        with mock.patch.object(store_module, 'MIGRATIONS', (*store_module.MIGRATIONS, v2)):
            upgraded = Store(self.path)
            self.addCleanup(upgraded.close)
            self.assertEqual(upgraded.schema_version, 2)
            self.assertEqual([item['title'] for item in upgraded.drafts()], ['Survives'])
            with raw_db(self.path) as db:
                self.assertIn('note', [row[1] for row in db.execute('PRAGMA table_info(content)')])
            upgraded.close()
        # The plain service no longer matches that store and refuses to run on it.
        with self.assertRaises(StoreError) as caught:
            Store(self.path)
        self.assertIn('newer than this service supports', str(caught.exception))

    def test_a_failed_migration_rolls_back_completely(self):
        self.store.close()

        def broken(db):
            db.execute('ALTER TABLE content ADD COLUMN half_done TEXT')
            raise sqlite3.OperationalError('boom')

        with mock.patch.object(store_module, 'MIGRATIONS', (*store_module.MIGRATIONS, broken)):
            with self.assertRaises(StoreError):
                Store(self.path)
        with raw_db(self.path) as db:
            self.assertEqual(db.execute('PRAGMA user_version').fetchone()[0], len(store_module.MIGRATIONS))
            self.assertNotIn('half_done', [row[1] for row in db.execute('PRAGMA table_info(content)')])

    def test_a_store_from_a_newer_service_is_refused(self):
        self.store.close()
        with raw_db(self.path) as db:
            db.execute('PRAGMA user_version = 99')
        with self.assertRaises(StoreError) as caught:
            Store(self.path)
        self.assertIn('schema 99', str(caught.exception))

    def test_a_file_that_is_not_a_database_is_refused(self):
        self.store.close()
        other = self.scratch / 'not-a-database'
        other.write_bytes(b'this is not sqlite' * 100)
        with self.assertRaises(StoreError):
            Store(other)


class Drafts(StoreCase):
    def test_create_starts_at_version_one(self):
        created = self.save(title='New', channel='X', planned_date='2026-10-22', archived=1)
        self.assertEqual(created['version'], 1)
        self.assertEqual(created['id'], f'{1:032x}')
        self.assertEqual((created['channel'], created['planned_date'], created['archived']), ('X', '2026-10-22', 1))
        self.assertEqual((created['planning_slot'], created['links']), (None, []))
        self.assertEqual(created['updated_at'], NOW)

    def test_update_requires_the_matching_version_and_adds_one(self):
        created = self.save()
        updated = self.save(title='Second', target=(created['id'], 1))
        self.assertEqual((updated['version'], updated['title']), (2, 'Second'))
        for version in (1, 3, 0):
            with self.subTest(version=version), self.assertRaises(ConflictError) as caught:
                self.save(title='Stale', target=(created['id'], version))
            self.assertEqual(caught.exception.message, CONFLICT)
        self.assertEqual(self.store.get_draft(created['id'])['title'], 'Second')

    def test_an_unknown_id_conflicts_and_creates_nothing(self):
        with self.assertRaises(ConflictError):
            self.save(target=('f' * 32, 1))
        self.assertEqual(self.store.drafts(), [])

    def test_a_rejected_update_changes_nothing(self):
        created = self.save(title='Original', links=[])
        with self.assertRaises(ConflictError):
            self.save(title='Lost', links=[{'x': 1}], target=(created['id'], 9))
        self.assertEqual(self.store.get_draft(created['id']), created)

    def test_two_writers_on_one_version_cannot_both_win(self):
        created = self.save()
        outcomes, barrier = [], threading.Barrier(8)

        def attempt(index):
            barrier.wait()
            try:
                self.save(title=f'Writer {index}', target=(created['id'], 1))
                outcomes.append('saved')
            except ConflictError:
                outcomes.append('conflict')

        threads = [threading.Thread(target=attempt, args=(index,)) for index in range(8)]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join()
        self.assertEqual(sorted(outcomes), ['conflict'] * 7 + ['saved'])
        self.assertEqual(self.store.get_draft(created['id'])['version'], 2)

    def test_links_and_slots_are_stored_as_given_and_preserved_when_omitted(self):
        link = {'version': 1, 'domain': 'work', 'projectId': 'p', 'kind': 'item', 'entityId': 'e', 'title': 'T',
                'returnDestination': {'domain': 'social', 'destination': 'library'}}
        slot = {'start': '09:00', 'duration_minutes': 30, 'timezone': 'UTC'}
        created = self.save(planned_date='2026-10-22', slot=slot, links=[link])
        self.assertEqual((created['planning_slot'], created['links']), (slot, [link]))
        kept = self.save(title='Retitled', planned_date='2026-10-22', target=(created['id'], 1))
        self.assertEqual((kept['planning_slot'], kept['links']), (slot, [link]))
        cleared = self.save(planned_date='2026-10-22', slot=None, links=[], target=(created['id'], 2))
        self.assertEqual((cleared['planning_slot'], cleared['links']), (None, []))

    def test_an_omitted_slot_is_dropped_when_the_date_no_longer_fits(self):
        slot = {'start': '02:30', 'duration_minutes': 30, 'timezone': 'America/New_York'}
        created = self.save(planned_date='2026-03-01', slot=slot)
        moved = self.save(planned_date='2026-03-08', target=(created['id'], 1))
        self.assertIsNone(moved['planning_slot'])

    def test_ordering_is_newest_first_with_stable_ties(self):
        first = self.save(title='first')
        second = self.save(title='second')
        self.assertEqual([item['title'] for item in self.store.drafts()], ['second', 'first'])
        self.store.save_draft(draft(title='first again', target=(first['id'], 1)), new_id=self.new_id,
                              now='2026-01-15T12:00:01+00:00', timezones=True)
        self.assertEqual([item['id'] for item in self.store.drafts()], [first['id'], second['id']])

    def test_brands_sort_by_name_ignoring_case(self):
        for index, name in enumerate(('zeta', 'Beta', 'alpha')):
            self.store.add_brand(f'b{index}', name)
        self.assertEqual([item['name'] for item in self.store.brands()], ['alpha', 'Beta', 'My workspace', 'zeta'])


class Runs(StoreCase):
    def insert(self, run_id, created='2026-01-15T12:00:00+00:00'):
        return self.store.insert_run(run_id, 'x-studio', False, created)

    def test_a_run_moves_from_queued_to_finished_once(self):
        record = self.insert('a' * 32)
        self.assertEqual((record['status'], record['finished_at'], record['error']), ('queued', None, None))
        self.store.mark_running('a' * 32)
        self.assertEqual(self.store.get_run('a' * 32)['status'], 'running')
        self.store.finish_run('a' * 32, 'succeeded', None, NOW)
        self.store.finish_run('a' * 32, 'failed', 'late', NOW)  # a finished run is final
        finished = self.store.get_run('a' * 32)
        self.assertEqual((finished['status'], finished['error'], finished['finished_at']), ('succeeded', None, NOW))

    def test_only_queued_and_running_runs_count_as_active(self):
        for index, status in enumerate(('queued', 'running', 'succeeded', 'failed', 'interrupted')):
            run_id = f'{index:032x}'
            self.insert(run_id)
            if status != 'queued':
                self.store.mark_running(run_id)
            if status in ('succeeded', 'failed', 'interrupted'):
                self.store.finish_run(run_id, status, None, NOW)
        self.assertEqual(self.store.active_run_count(), 2)

    def test_interrupt_active_marks_unfinished_runs_only(self):
        self.insert('1' * 32)
        self.insert('2' * 32)
        self.insert('3' * 32)
        self.store.mark_running('2' * 32)
        self.store.mark_running('3' * 32)
        self.store.finish_run('3' * 32, 'succeeded', None, '2026-01-01T00:00:00+00:00')
        self.assertEqual(self.store.interrupt_active(NOW), 2)
        for run_id in ('1' * 32, '2' * 32):
            run = self.store.get_run(run_id)
            self.assertEqual((run['status'], run['finished_at'], run['error']),
                             ('interrupted', NOW, 'Service restarted before completion; run again explicitly.'))
        self.assertEqual(self.store.get_run('3' * 32)['status'], 'succeeded')
        self.assertEqual(self.store.active_run_count(), 0)

    def test_recent_runs_are_the_latest_two_hundred_newest_first(self):
        for index in range(205):
            self.insert(f'{index:032x}', f'2026-01-15T12:{index // 60:02d}:{index % 60:02d}+00:00')
        runs = self.store.recent_runs()
        self.assertEqual(len(runs), 200)
        self.assertEqual(runs[0]['id'], f'{204:032x}')
        self.assertEqual(runs[-1]['id'], f'{5:032x}')

    def test_status_is_constrained(self):
        self.insert('a' * 32)
        with raw_db(self.path) as db, self.assertRaises(sqlite3.IntegrityError):
            db.execute("UPDATE runs SET status = 'bogus'")


if __name__ == '__main__':
    unittest.main()
