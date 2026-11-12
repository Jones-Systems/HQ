"""Run lifecycle over HTTP with a test-only fake worker: statuses, limits, failures and restarts."""

import json
import os
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from unittest import mock

from support import ROOT, ServiceTestCase, raw_db

from social_service import runner, tools
from social_service.errors import ValidationError

QUEUE_FULL = 'Run queue is full. Wait for a run to finish.'
TOO_LARGE = 'Result is too large to return (limit 1,500,000 bytes)'
INTERRUPTED = 'Service restarted before completion; run again explicitly.'
RECORD_KEYS = ['id', 'tool', 'status', 'is_example', 'created_at', 'finished_at', 'error']


def wait_until(predicate, timeout=20.0, what='condition'):
    deadline = time.monotonic() + timeout
    while not predicate():
        if time.monotonic() > deadline:
            raise AssertionError(f'Timed out waiting for {what}')
        time.sleep(0.02)


def process_exists(pid):
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    return True


class RunCase(ServiceTestCase):
    def setUp(self):
        super().setUp()
        self.gate = self.scratch / 'gate'

    def blocking(self):
        return {'mode': 'block', 'gate': str(self.gate)}

    def run_dir(self, run_id):
        return self.data / 'runs' / run_id

    def release(self):
        self.gate.write_text('go')

    def wait_status(self, run_id, status):
        wait_until(lambda: self.get(f'/api/runs/{run_id}').json['status'] == status, what=f'{status} for {run_id}')

    def submit(self, mode='ok', **extra):
        reply = self.harness.submit('x-studio', {'mode': mode, **extra})
        self.assertEqual(reply.status, 201, reply.body)
        return reply.json

    def finished(self, mode='ok', **extra):
        return self.harness.wait_run(self.submit(mode, **extra)['id'])


class Lifecycle(RunCase):
    def test_a_submission_is_a_queued_record(self):
        reply = self.harness.submit('x-studio', {'mode': 'block', 'gate': str(self.gate)}, is_example=True)
        self.addCleanup(self.release)
        self.assertEqual(reply.status, 201)
        record = reply.json
        self.assertEqual(list(record), RECORD_KEYS)
        self.assertRegex(record['id'], '^[0-9a-f]{32}$')
        self.assertEqual((record['tool'], record['status'], record['is_example'], record['finished_at'], record['error']),
                         ('x-studio', 'queued', 1, None, None))
        self.assertRegex(record['created_at'], r'^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d+\+00:00$')

    def test_is_example_defaults_to_false_and_is_stored_as_zero_or_one(self):
        self.assertEqual(self.submit()['is_example'], 0)
        self.assertEqual(self.harness.submit('x-studio', {}, is_example=False).json['is_example'], 0)
        self.assertEqual(self.harness.submit('x-studio', {}, is_example=True).json['is_example'], 1)

    def test_status_moves_queued_running_succeeded_and_output_appears_only_at_the_end(self):
        record = self.submit('block', gate=str(self.gate))
        self.wait_status(record['id'], 'running')
        running = self.get(f'/api/runs/{record["id"]}').json
        self.assertEqual((running['status'], running['finished_at'], running['error']), ('running', None, None))
        self.assertNotIn('output', running)
        self.release()
        done = self.harness.wait_run(record['id'])
        self.assertEqual(list(done), RECORD_KEYS + ['output'])
        self.assertEqual((done['status'], done['error']), ('succeeded', None))
        self.assertEqual(done['output'], {'ok': True, 'result': {'released': True}})
        self.assertRegex(done['finished_at'], r'^\d{4}-\d\d-\d\dT')
        self.assertGreaterEqual(done['finished_at'], done['created_at'])

    def test_a_queued_run_has_no_output(self):
        first = self.submit('block', gate=str(self.gate))
        self.wait_status(first['id'], 'running')
        second = self.submit()
        queued = self.get(f'/api/runs/{second["id"]}').json
        self.assertEqual(queued['status'], 'queued')
        self.assertNotIn('output', queued)
        self.release()
        self.assertEqual(self.harness.wait_run(second['id'])['status'], 'succeeded')

    def test_the_workspace_lists_runs_newest_first_without_output(self):
        first = self.finished()
        second = self.finished()
        runs = self.get('/api/workspace').json['runs']
        self.assertEqual([run['id'] for run in runs], [second['id'], first['id']])
        for run in runs:
            self.assertEqual(list(run), RECORD_KEYS)
            self.assertEqual(run['status'], 'succeeded')

    def test_a_failed_envelope_is_a_failed_run_with_its_error_and_output(self):
        done = self.finished('fail', message='The notes were empty')
        self.assertEqual((done['status'], done['error']), ('failed', 'The notes were empty'))
        self.assertEqual(done['output'], {'ok': False, 'error': 'The notes were empty'})
        self.assertIsNotNone(done['finished_at'])

    def test_error_text_is_capped_at_four_thousand_characters(self):
        done = self.finished('long_error')
        self.assertEqual(done['status'], 'failed')
        self.assertEqual(done['error'], 'e' * 4000)
        self.assertEqual(len(done['output']['error']), 5000)

    def test_a_record_passes_the_hq_run_guard(self):
        statuses = ('queued', 'running', 'succeeded', 'failed', 'interrupted')
        for record in (self.submit(), self.finished(), self.finished('fail')):
            self.assertIsInstance(record['id'], str)
            self.assertIn(record['tool'], tools.TOOL_IDS)
            self.assertIn(record['status'], statuses)
            self.assertIn(record['is_example'], (0, 1))
            self.assertIsInstance(record['created_at'], str)
            self.assertIn(type(record['finished_at']), (str, type(None)))
            self.assertIn(type(record['error']), (str, type(None)))

    def test_every_tool_can_be_submitted(self):
        for tool in tools.TOOL_IDS:
            reply = self.harness.submit(tool, {'mode': 'ok'})
            self.assertEqual((reply.status, reply.json['tool']), (201, tool))
            self.assertEqual(self.harness.wait_run(reply.json['id'])['output']['result']['tool'], tool)

    def test_runs_execute_one_at_a_time_in_submission_order(self):
        records = [self.submit('block', gate=str(self.gate)) for _ in range(4)]
        self.wait_status(records[0]['id'], 'running')
        time.sleep(0.15)
        counts = [run['status'] for run in self.get('/api/workspace').json['runs']]
        self.assertEqual((counts.count('running'), counts.count('queued')), (1, 3))
        self.release()
        for record in records:
            self.harness.wait_run(record['id'])
        started = [self.run_dir(record['id']) / 'started' for record in records]
        order = sorted(started, key=lambda path: path.stat().st_mtime_ns)
        self.assertEqual(order, started)

    def test_the_worker_gets_the_tool_and_input_in_input_json(self):
        record = self.submit('ok', marker='é')
        self.harness.wait_run(record['id'])
        written = json.loads((self.run_dir(record['id']) / 'input.json').read_text())
        self.assertEqual(written, {'tool': 'x-studio', 'input': {'mode': 'ok', 'marker': 'é'}})


class Refusals(RunCase):
    def test_invalid_submissions_leave_no_run_and_no_directory(self):
        before = sorted(path.name for path in (self.data / 'runs').iterdir())
        for body, message in (({'tool': 'nope', 'input': {}}, 'Choose a known tool and supply a JSON object'),
                              ({'tool': 'x-studio', 'input': []}, 'Choose a known tool and supply a JSON object'),
                              ({'tool': 'x-studio', 'input': {}, 'is_example': 'yes'}, 'Example label must be boolean'),
                              ({'tool': 'x-studio', 'input': {}, 'extra': 1}, 'Unknown field: extra')):
            with self.subTest(message=message):
                reply = self.post('/api/runs', body)
                self.assertEqual((reply.status, reply.json), (400, {'error': message}))
        self.assertEqual(sorted(path.name for path in (self.data / 'runs').iterdir()), before)
        self.assertEqual(self.get('/api/workspace').json['runs'], [])

    def test_input_too_deeply_nested_to_store_is_a_400_that_leaves_nothing(self):
        deep = current = {}
        for _ in range(100_000):  # beyond any interpreter's limit
            current['next'] = {}
            current = current['next']
        before = sorted(path.name for path in (self.data / 'runs').iterdir())
        with self.assertRaises(ValidationError) as caught:
            self.service.submit_run({'tool': 'x-studio', 'input': deep})
        self.assertEqual((caught.exception.status, caught.exception.message), (400, 'Input is nested too deeply'))
        self.assertEqual(sorted(path.name for path in (self.data / 'runs').iterdir()), before)
        self.assertEqual(self.get('/api/workspace').json['runs'], [])

    def test_the_queue_holds_eight_and_a_ninth_is_a_conflict(self):
        records = [self.submit('block', gate=str(self.gate)) for _ in range(8)]
        self.wait_status(records[0]['id'], 'running')
        reply = self.harness.submit('x-studio', {'mode': 'ok'})
        self.assertEqual((reply.status, reply.json), (409, {'error': QUEUE_FULL}))
        self.assertEqual(len(self.get('/api/workspace').json['runs']), 8)
        self.assertEqual(len(list((self.data / 'runs').iterdir())), 8, 'The refused run must not leave a directory')
        self.release()
        for record in records:
            self.assertEqual(self.harness.wait_run(record['id'])['status'], 'succeeded')
        self.assertEqual(self.harness.submit('x-studio', {'mode': 'ok'}).status, 201)

    def test_finished_runs_do_not_count_toward_the_limit(self):
        for _ in range(10):
            self.finished()
        self.assertEqual(self.harness.submit('x-studio', {'mode': 'ok'}).status, 201)

    def test_concurrent_submissions_cannot_exceed_the_limit(self):
        statuses, barrier = [], threading.Barrier(20)
        self.addCleanup(self.release)

        def submit():
            barrier.wait(timeout=10)
            return self.harness.submit('x-studio', {'mode': 'block', 'gate': str(self.gate)}).status

        with ThreadPoolExecutor(max_workers=20) as clients:
            futures = [clients.submit(submit) for _ in range(20)]
            for client, future in enumerate(futures):
                with self.subTest(client=client):
                    statuses.append(future.result(timeout=25))
        self.assertEqual(len(statuses), 20)
        self.assertEqual((statuses.count(201), statuses.count(409)), (8, 12))
        self.assertEqual(len(self.get('/api/workspace').json['runs']), 8)
        self.assertEqual(len(list((self.data / 'runs').iterdir())), 8)


class Failures(RunCase):
    def test_a_worker_that_exits_nonzero_fails_the_run(self):
        done = self.finished('crash')
        self.assertEqual((done['status'], done['error']), ('failed', 'The run ended unexpectedly (exit status 3).'))
        self.assertNotIn('output', done)

    def test_a_worker_killed_by_a_signal_fails_the_run(self):
        done = self.finished('killed')
        self.assertEqual((done['status'], done['error']), ('failed', 'The run ended unexpectedly (signal 9).'))

    def test_a_worker_that_writes_nothing_fails_the_run(self):
        done = self.finished('noresult')
        self.assertEqual((done['status'], done['error']), ('failed', 'The run ended without a result.'))
        self.assertNotIn('output', done)

    def test_unreadable_results_fail_the_run_and_are_discarded(self):
        for mode in ('garbage', 'nonenvelope', 'nan'):
            with self.subTest(mode=mode):
                record = self.submit(mode)
                done = self.harness.wait_run(record['id'])
                self.assertEqual((done['status'], done['error']), ('failed', 'The run produced an unreadable result.'))
                self.assertNotIn('output', done)
                self.assertFalse((self.run_dir(record['id']) / 'result.json').exists())

    def test_a_missing_worker_command_fails_the_run_not_the_service(self):
        self.restart(worker_command=['/nonexistent/worker-binary'])
        done = self.finished()
        self.assertEqual((done['status'], done['error']), ('failed', 'The run could not be started.'))
        self.assertEqual(self.get('/api/workspace').status, 200)


class Timeout(RunCase):
    def setUp(self):
        super().setUp()
        self.restart(run_timeout=0.5)

    def test_a_run_over_the_limit_fails_and_its_process_is_killed(self):
        record = self.submit('sleep', seconds=30)
        done = self.harness.wait_run(record['id'])
        self.assertEqual((done['status'], done['error']), ('failed', 'The run took longer than 0.5 seconds and was stopped.'))
        self.assertNotIn('output', done)
        pid = int((self.run_dir(record['id']) / 'pid').read_text())
        wait_until(lambda: not process_exists(pid), what='the timed-out worker to be gone')

    def test_the_queue_continues_after_a_timeout(self):
        slow = self.submit('sleep', seconds=30)
        after = self.submit('ok')
        self.assertEqual(self.harness.wait_run(slow['id'])['status'], 'failed')
        self.assertEqual(self.harness.wait_run(after['id'])['status'], 'succeeded')

    def test_a_result_written_before_the_kill_is_not_kept(self):
        record = self.submit('late', seconds=30)
        done = self.harness.wait_run(record['id'])
        self.assertEqual(done['status'], 'failed')
        self.assertNotIn('output', done)
        self.assertFalse((self.run_dir(record['id']) / 'result.json').exists())


class ResultSize(RunCase):
    def test_exactly_the_limit_succeeds_and_the_record_fits_the_transport_cap(self):
        record = self.submit('size', bytes=1_500_000)
        self.harness.wait_run(record['id'])
        reply = self.get(f'/api/runs/{record["id"]}')
        self.assertEqual(reply.json['status'], 'succeeded')
        self.assertEqual(os.path.getsize(self.run_dir(record['id']) / 'result.json'), 1_500_000)
        self.assertLessEqual(len(reply.body), 2_000_000)
        self.assertEqual(len(reply.json['output']['result']['pad']), 1_500_000 - len('{"ok":true,"result":{"pad":""}}'))

    def test_one_byte_over_fails_with_the_contract_message(self):
        record = self.submit('size', bytes=1_500_001)
        done = self.harness.wait_run(record['id'])
        self.assertEqual((done['status'], done['error']), ('failed', TOO_LARGE))
        self.assertEqual(done['output'], {'ok': False, 'error': TOO_LARGE})
        self.assertLess(os.path.getsize(self.run_dir(record['id']) / 'result.json'), 1000)

    def test_a_large_result_is_never_returned(self):
        done = self.finished('size', bytes=5_000_000)
        self.assertEqual(done['error'], TOO_LARGE)
        self.assertLessEqual(len(self.get(f'/api/runs/{done["id"]}').body), 2_000)


class Environment(RunCase):
    def test_the_worker_runs_in_a_scrubbed_environment_in_its_own_directory(self):
        with mock.patch.dict(os.environ, {'HQ_SOCIAL_SENTINEL': 'leaked', 'SECRET_TOKEN': 'leaked',
                                          'PYTHONPATH': '/somewhere/else'}):
            record = self.submit('environment')
            done = self.harness.wait_run(record['id'])
        seen = done['output']['result']
        directory = str(self.run_dir(record['id']))
        self.assertEqual(seen['env']['PATH'], '/usr/bin:/bin')
        self.assertEqual((seen['env']['HOME'], seen['env']['TMPDIR']), (directory, directory))
        self.assertEqual(seen['env']['PYTHONDONTWRITEBYTECODE'], '1')
        self.assertEqual(seen['env']['PYTHONPATH'], str(ROOT))
        # Python may add LC_CTYPE itself when the locale is C; nothing else may appear.
        self.assertLessEqual(set(seen['env']) - {'PATH', 'HOME', 'TMPDIR', 'PYTHONDONTWRITEBYTECODE', 'PYTHONPATH'},
                             {'LC_CTYPE'})
        self.assertEqual(os.path.realpath(seen['cwd']), os.path.realpath(directory))
        self.assertEqual(os.path.realpath(seen['argv'][1]), os.path.realpath(directory))
        self.assertEqual(seen['stdin'], '', 'stdin must be /dev/null')
        self.assertTrue(seen['new_session'])

    def test_the_worker_log_belongs_to_the_run(self):
        record = self.submit('ok')
        self.harness.wait_run(record['id'])
        self.assertTrue((self.run_dir(record['id']) / 'worker.log').is_file())

    def test_the_default_command_is_the_worker_module(self):
        self.assertEqual(runner.default_worker_command(), [sys.executable, '-m', 'social_service.worker'])


class Restart(RunCase):
    def test_stopping_marks_running_and_queued_runs_interrupted_and_kills_the_worker(self):
        running = self.submit('block', gate=str(self.gate))
        self.wait_status(running['id'], 'running')
        queued = self.submit('ok')
        wait_until(lambda: (self.run_dir(running['id']) / 'pid').exists(), what='the worker to start')
        pid = int((self.run_dir(running['id']) / 'pid').read_text())
        self.restart()
        wait_until(lambda: not process_exists(pid), what='the worker to be killed on stop')
        for record in (running, queued):
            seen = self.get(f'/api/runs/{record["id"]}').json
            self.assertEqual((seen['status'], seen['error']), ('interrupted', INTERRUPTED))
            self.assertIsNotNone(seen['finished_at'])
            self.assertNotIn('output', seen)
        self.assertFalse((self.run_dir(queued['id']) / 'pid').exists(), 'A queued run must never have started')

    def test_nothing_is_retried_after_a_restart(self):
        running = self.submit('block', gate=str(self.gate))
        self.wait_status(running['id'], 'running')
        queued = self.submit('ok')
        self.restart()
        self.release()
        time.sleep(0.4)
        for record in (running, queued):
            seen = self.get(f'/api/runs/{record["id"]}').json
            self.assertEqual(seen['status'], 'interrupted')
            self.assertFalse((self.run_dir(record['id']) / 'result.json').exists())
        self.assertEqual(self.harness.submit('x-studio', {'mode': 'ok'}).status, 201, 'The queue has room again')

    def test_a_crash_leaves_runs_that_the_next_start_marks_interrupted(self):
        finished = self.finished()
        self.harness.stop()
        with raw_db(self.data / 'hq-social.sqlite3') as db:
            for run_id, status in (('1' * 32, 'queued'), ('2' * 32, 'running')):
                db.execute("INSERT INTO runs VALUES (?, 'x-studio', ?, 0, '2026-01-01T00:00:00+00:00', NULL, NULL)",
                           (run_id, status))
        self.start_service()
        for run_id in ('1' * 32, '2' * 32):
            seen = self.get(f'/api/runs/{run_id}').json
            self.assertEqual((seen['status'], seen['error']), ('interrupted', INTERRUPTED))
            self.assertRegex(seen['finished_at'], r'^\d{4}-\d\d-\d\dT')
        untouched = self.get(f'/api/runs/{finished["id"]}').json
        self.assertEqual((untouched['status'], untouched['finished_at']), ('succeeded', finished['finished_at']))
        self.assertEqual([run['id'] for run in self.get('/api/workspace').json['runs']],
                         [finished['id'], '2' * 32, '1' * 32])
        self.assertEqual(self.harness.submit('x-studio', {'mode': 'ok'}).status, 201, 'Interrupted runs free the queue')

    def test_finished_output_is_still_readable_after_a_restart(self):
        done = self.finished('ok', keep='me')
        self.restart()
        again = self.get(f'/api/runs/{done["id"]}').json
        self.assertEqual(again, done)


class RealWorker(RunCase):
    """The shipped worker. Analyzers are built separately, so these assertions hold before and after they land."""

    def setUp(self):
        super().setUp()
        self.restart(worker_command=None)

    def test_a_run_with_unusable_input_fails_with_a_recorded_error(self):
        done = self.harness.wait_run(self.harness.submit('x-studio', {'notes': 5, 'format': 'not-a-format'}).json['id'])
        self.assertEqual(done['status'], 'failed')
        self.assertIsInstance(done['error'], str)
        self.assertTrue(done['error'])
        self.assertIsNotNone(done['finished_at'])
        self.assertEqual(done['output'], {'ok': False, 'error': done['error']})
        self.assertTrue((self.run_dir(done['id']) / 'worker.log').is_file())
        self.assertEqual(json.loads((self.run_dir(done['id']) / 'input.json').read_text())['tool'], 'x-studio')
