"""Launching the service: the ready line, signals, loopback-only binding, data-directory rules and the lock."""

import http.client
import json
import os
import re
import selectors
import signal
import socket
import stat
import subprocess
import sys
import unittest
from pathlib import Path

from support import ROOT, ScratchTestCase, raw_db

from social_service import __main__ as launcher
from social_service import datadir

READY = re.compile(r'^Social service on http://(?P<host>[^/]+):(?P<port>\d+)/  \(data: (?P<data>.+)\)$')
REPO_ROOT = ROOT.parent.parent


def command(*arguments):
    return [sys.executable, '-m', 'social_service', *arguments]


def environment():
    return {**os.environ, 'PYTHONDONTWRITEBYTECODE': '1'}


def run(*arguments, timeout=60):
    return subprocess.run(command(*arguments), cwd=ROOT, env=environment(), capture_output=True, text=True,
                          timeout=timeout)


def get(port, path='/api/workspace', headers=None):
    connection = http.client.HTTPConnection('127.0.0.1', port, timeout=10)
    try:
        connection.request('GET', path, headers=headers or {})
        response = connection.getresponse()
        return response.status, response.read()
    finally:
        connection.close()


class Launched(ScratchTestCase):
    def launch(self, *arguments, data=None):
        data = data if data is not None else self.scratch / 'data'
        process = subprocess.Popen(command('--data', str(data), *arguments), cwd=ROOT, env=environment(),
                                   stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        self.addCleanup(self.reap, process)
        return process, self.ready_line(process)

    def ready_line(self, process, timeout=30):
        with selectors.DefaultSelector() as selector:
            selector.register(process.stdout, selectors.EVENT_READ)
            if not selector.select(timeout):
                raise AssertionError('The service printed nothing within %s seconds' % timeout)
        return process.stdout.readline().rstrip('\n')

    @staticmethod
    def reap(process):
        if process.poll() is None:
            process.kill()
        process.communicate()

    def stop(self, process, number=signal.SIGTERM):
        process.send_signal(number)
        return process.wait(timeout=30)


class ReadyLine(Launched):
    def test_the_exact_line_names_the_bound_port_and_resolved_data_directory(self):
        process, line = self.launch('--port', '0')
        match = READY.match(line)
        self.assertIsNotNone(match, line)
        self.assertEqual(match['host'], '127.0.0.1')
        self.assertGreater(int(match['port']), 0)
        self.assertEqual(match['data'], str((self.scratch / 'data').resolve()))
        self.assertEqual(line, f"Social service on http://127.0.0.1:{match['port']}/  (data: {(self.scratch / 'data').resolve()})")

    def test_port_zero_picks_a_free_port_that_serves(self):
        process, line = self.launch('--port', '0')
        port = int(READY.match(line)['port'])
        status, body = get(port)
        self.assertEqual(status, 200)
        self.assertEqual(json.loads(body)['features'], ['hq-editorial-timebox-v1', 'hq-references-v1'])
        process_two, line_two = self.launch('--port', '0', data=self.scratch / 'second')
        self.assertNotEqual(READY.match(line_two)['port'], str(port))

    def test_the_default_host_is_loopback_and_localhost_is_accepted(self):
        _, line = self.launch('--port', '0', '--host', 'localhost')
        self.assertTrue(line.startswith('Social service on http://localhost:'), line)

    def test_ipv6_hosts_are_bracketed(self):
        self.assertEqual(launcher.ready_line('::1', 8766, Path('/data/social')),
                         'Social service on http://[::1]:8766/  (data: /data/social)')
        self.assertEqual(launcher.ready_line('127.0.0.1', 1, Path('/d')), 'Social service on http://127.0.0.1:1/  (data: /d)')

    def test_a_real_ipv6_launch_is_bracketed_when_the_host_has_it(self):
        if not socket.has_ipv6:
            self.skipTest('This Python has no IPv6 support')
        probe = socket.socket(socket.AF_INET6)
        try:
            probe.bind(('::1', 0))
        except OSError:
            self.skipTest('The IPv6 loopback address is not available on this host')
        finally:
            probe.close()
        _, line = self.launch('--port', '0', '--host', '::1')
        match = READY.match(line)
        self.assertEqual(match['host'], '[::1]')
        connection = http.client.HTTPConnection('::1', int(match['port']), timeout=10)
        connection.request('GET', '/api/workspace')
        response = connection.getresponse()
        response.read()
        self.assertEqual(response.status, 200)
        connection.close()

    def test_publishing_defaults_to_off_and_only_off_exists(self):
        self.launch('--port', '0', '--publishing', 'off')
        refused = run('--data', str(self.scratch / 'other'), '--publishing', 'simulator')
        self.assertEqual(refused.returncode, 2)
        self.assertIn('invalid choice', refused.stderr)
        self.assertFalse((self.scratch / 'other').exists())

    def test_allowed_hosts_widen_the_host_guard(self):
        _, line = self.launch('--port', '0', '--allowed-host', 'front.example.test', '--allowed-host', 'second.example.test:8443')
        port = int(READY.match(line)['port'])
        self.assertEqual(get(port, headers={'Host': 'front.example.test'})[0], 200)
        self.assertEqual(get(port, headers={'Host': 'second.example.test:8443'})[0], 200)
        status, body = get(port, headers={'Host': 'other.example.test'})
        self.assertEqual((status, json.loads(body)), (403, {'error': 'Unrecognized host'}))


class Signals(Launched):
    def test_sigterm_and_sigint_stop_gracefully_and_release_the_data_directory(self):
        for number in (signal.SIGTERM, signal.SIGINT):
            with self.subTest(signal=signal.Signals(number).name):
                data = self.scratch / f'data-{number}'
                process, line = self.launch('--port', '0', data=data)
                port = int(READY.match(line)['port'])
                self.assertEqual(self.stop(process, number), 0)
                with self.assertRaises(OSError):
                    socket.create_connection(('127.0.0.1', port), timeout=2).close()
                self.assertEqual(process.stderr.read(), '')
                again, _ = self.launch('--port', '0', data=data)
                self.assertEqual(self.stop(again), 0)

    def test_data_survives_a_stop_and_start(self):
        data = self.scratch / 'keep'
        process, line = self.launch('--port', '0', data=data)
        port = int(READY.match(line)['port'])
        token = json.loads(get(port)[1])['csrf']
        connection = http.client.HTTPConnection('127.0.0.1', port, timeout=10)
        connection.request('POST', '/api/brands', body=json.dumps({'name': 'Kept brand'}),
                           headers={'Content-Type': 'application/json', 'X-Workspace-Token': token})
        self.assertEqual(connection.getresponse().status, 201)
        connection.close()
        self.assertEqual(self.stop(process), 0)
        again, line = self.launch('--port', '0', data=data)
        brands = json.loads(get(int(READY.match(line)['port']))[1])['brands']
        self.assertEqual([brand['name'] for brand in brands], ['Kept brand', 'My workspace'])


class SingleInstance(Launched):
    def test_a_second_process_on_the_same_data_exits_two(self):
        first, line = self.launch('--port', '0')
        second = run('--data', str(self.scratch / 'data'), '--port', '0')
        self.assertEqual(second.returncode, 2)
        self.assertIn('already using', second.stderr)
        self.assertEqual(second.stdout, '')
        self.assertEqual(get(int(READY.match(line)['port']))[0], 200, 'The first instance keeps serving')
        self.assertEqual(self.stop(first), 0)
        third, _ = self.launch('--port', '0')
        self.assertIsNone(third.poll())

    def test_different_data_directories_run_side_by_side(self):
        self.launch('--port', '0', data=self.scratch / 'a')
        _, line = self.launch('--port', '0', data=self.scratch / 'b')
        self.assertIsNotNone(READY.match(line))

    def test_the_lock_is_exclusive_in_process_and_private(self):
        directory = self.new_directory('locked')
        first = datadir.acquire_lock(directory)
        with self.assertRaises(datadir.LockError):
            datadir.acquire_lock(directory)
        lock_file = directory / datadir.LOCK_NAME
        self.assertEqual(stat.S_IMODE(lock_file.stat().st_mode), 0o600)
        self.assertEqual(lock_file.read_text().strip(), str(os.getpid()))
        first.release()
        datadir.acquire_lock(directory).release()

    def test_a_killed_process_leaves_no_stale_lock(self):
        process, _ = self.launch('--port', '0')
        process.kill()
        process.wait(timeout=30)
        again, line = self.launch('--port', '0')
        self.assertIsNotNone(READY.match(line))


class Refusals(Launched):
    def test_non_loopback_addresses_exit_two_before_touching_the_data_directory(self):
        for host in ('0.0.0.0', '::', '192.0.2.7', '10.1.2.3', 'example.com', '127.0.0.1.example.com', ''):
            with self.subTest(host=host):
                data = self.scratch / 'never'
                done = run('--data', str(data), '--host', host)
                self.assertEqual(done.returncode, 2, done.stderr)
                self.assertIn('non-loopback', done.stderr)
                self.assertEqual(done.stdout, '')
                self.assertFalse(data.exists())

    def test_bad_ports_and_allowed_hosts_exit_two(self):
        for arguments in (('--port', '70000'), ('--port', '-1'), ('--port', 'abc'), ('--allowed-host', 'a b'),
                          ('--allowed-host', 'evil/path'), ('--allowed-host', ''), ('--allowed-host', 'user@host')):
            with self.subTest(arguments=arguments):
                done = run('--data', str(self.scratch / 'never'), *arguments)
                self.assertEqual(done.returncode, 2, done.stderr)
                self.assertEqual(done.stdout, '')
        self.assertFalse((self.scratch / 'never').exists())

    def test_data_is_required(self):
        done = run('--port', '0')
        self.assertEqual(done.returncode, 2)
        self.assertIn('--data', done.stderr)

    def test_a_port_already_in_use_exits_one_with_a_message(self):
        with socket.socket() as taken:
            taken.bind(('127.0.0.1', 0))
            taken.listen(1)
            done = run('--data', str(self.scratch / 'data'), '--port', str(taken.getsockname()[1]))
        self.assertEqual(done.returncode, 1)
        self.assertIn('Could not listen', done.stderr)

    def test_a_store_from_a_newer_service_exits_two(self):
        data = self.new_directory('future')
        with raw_db(data / 'hq-social.sqlite3') as db:
            db.execute('PRAGMA user_version = 99')
        done = run('--data', str(data), '--port', '0')
        self.assertEqual(done.returncode, 2)
        self.assertIn('newer than this service supports', done.stderr)


class DataDirectory(Launched):
    def test_it_is_created_private_when_its_parent_exists(self):
        data = self.scratch / 'fresh'
        process, line = self.launch('--port', '0', data=data)
        self.assertIsNotNone(READY.match(line))
        self.assertEqual(stat.S_IMODE(data.stat().st_mode), 0o700)
        self.assertEqual(stat.S_IMODE((data / 'hq-social.sqlite3').stat().st_mode), 0o600)
        self.assertEqual(stat.S_IMODE((data / datadir.LOCK_NAME).stat().st_mode), 0o600)
        self.assertEqual(stat.S_IMODE((data / 'runs').stat().st_mode), 0o700)

    def test_an_existing_directory_is_reused(self):
        data = self.new_directory('existing')
        (data / 'unrelated.txt').write_text('mine')
        self.launch('--port', '0', data=data)
        self.assertEqual((data / 'unrelated.txt').read_text(), 'mine')
        self.assertTrue((data / 'hq-social.sqlite3').is_file())

    def test_a_missing_parent_is_refused_and_nothing_is_created(self):
        done = run('--data', str(self.scratch / 'missing' / 'child'), '--port', '0')
        self.assertEqual(done.returncode, 2)
        self.assertIn('does not exist', done.stderr)
        self.assertFalse((self.scratch / 'missing').exists())

    def test_a_file_is_refused(self):
        target = self.scratch / 'a-file'
        target.write_text('not a directory')
        done = run('--data', str(target), '--port', '0')
        self.assertEqual(done.returncode, 2)
        self.assertIn('is not a directory', done.stderr)
        self.assertEqual(target.read_text(), 'not a directory')

    def test_a_directory_inside_services_social_is_refused_and_not_created(self):
        inside = ROOT / '.hq-social-refused-data'
        self.addCleanup(lambda: inside.exists() and inside.rmdir())
        done = run('--data', str(inside), '--port', '0')
        self.assertEqual(done.returncode, 2)
        self.assertIn('must not be inside services/social', done.stderr)
        self.assertFalse(inside.exists())
        self.assertEqual(run('--data', str(ROOT), '--port', '0').returncode, 2)

    def test_a_symlink_into_the_service_is_resolved_before_the_check(self):
        link = self.scratch / 'link'
        link.symlink_to(ROOT)
        with self.assertRaises(datadir.DataDirError):
            datadir.prepare_data_dir(link / '.hq-social-refused-data')
        self.assertFalse((ROOT / '.hq-social-refused-data').exists())

    def test_inspection_touches_nothing_and_warns_for_the_repository(self):
        refusal, warning = datadir.inspect_data_path(ROOT / 'tests' / 'x')
        self.assertEqual((refusal is not None, warning), (True, None))
        self.assertEqual(datadir.inspect_data_path(ROOT)[0], 'The data directory must not be inside services/social.')
        refusal, warning = datadir.inspect_data_path(REPO_ROOT / 'docs' / 'social-data')
        self.assertIsNone(refusal)
        self.assertIn('inside the HQ repository', warning)
        self.assertEqual(datadir.inspect_data_path(self.scratch / 'data'), (None, None))
        self.assertFalse((REPO_ROOT / 'docs' / 'social-data').exists())


if __name__ == '__main__':
    unittest.main()
