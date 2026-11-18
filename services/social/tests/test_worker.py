"""The shipped worker: its result envelope, the process-denying audit hook and the resource limits."""

import contextlib
import io
import json
import subprocess
import sys
import textwrap
import unittest
from datetime import datetime, timezone
from unittest import mock

from support import ROOT, ScratchTestCase

from social_service import runner, tools, worker

NOW = datetime(2026, 1, 15, 12, 0, tzinfo=timezone.utc)


def python(code, cwd, timeout=60):
    """Run a snippet in a fresh interpreter that can import the service, in a scrubbed environment."""
    environment = {'PATH': '/usr/bin:/bin', 'PYTHONPATH': str(ROOT), 'PYTHONDONTWRITEBYTECODE': '1'}
    return subprocess.run([sys.executable, '-c', textwrap.dedent(code)], cwd=cwd, env=environment,
                          capture_output=True, text=True, timeout=timeout)


class RunDirectory(ScratchTestCase):
    def prepare(self, tool='x-studio', data=None):
        directory = self.scratch / 'run'
        directory.mkdir(exist_ok=True)
        (directory / 'input.json').write_text(json.dumps({'tool': tool, 'input': data if data is not None else {}}))
        return directory

    def result(self, directory):
        return json.loads((directory / 'result.json').read_text())


class Envelope(RunDirectory):
    def execute(self, outcome, data=None):
        directory = self.prepare(data=data)
        patched = mock.patch.object(tools, 'execute', **({'side_effect': outcome} if isinstance(outcome, BaseException)
                                                          or callable(outcome) else {'return_value': outcome}))
        with patched as execute, contextlib.redirect_stderr(io.StringIO()) as log:
            worker.run(directory, now=NOW)
        self.assertFalse((directory / 'result.json.partial').exists(), 'The result is written atomically')
        return self.result(directory), execute, log.getvalue()

    def test_a_result_is_wrapped_as_ok_true_and_executed_with_the_utc_clock(self):
        envelope, execute, _ = self.execute({'blocks': [{'text': 'hi'}]}, {'notes': 'n'})
        self.assertEqual(envelope, {'ok': True, 'result': {'blocks': [{'text': 'hi'}]}})
        execute.assert_called_once_with('x-studio', {'notes': 'n'}, now=NOW)

    def test_the_default_clock_is_timezone_aware_utc(self):
        directory = self.prepare()
        with mock.patch.object(tools, 'execute', return_value={}) as execute:
            worker.run(directory)
        seen = execute.call_args.kwargs['now']
        self.assertEqual(seen.utcoffset().total_seconds(), 0)

    def test_a_value_error_is_the_user_facing_message(self):
        envelope, _, log = self.execute(ValueError('Notes are required'))
        self.assertEqual(envelope, {'ok': False, 'error': 'Notes are required'})
        self.assertEqual(log, '')

    def test_an_empty_value_error_still_has_text(self):
        self.assertEqual(self.execute(ValueError())[0], {'ok': False, 'error': 'The input was rejected.'})

    def test_a_long_message_is_capped(self):
        envelope, _, _ = self.execute(ValueError('m' * 9000))
        self.assertEqual(envelope['error'], 'm' * 4000)

    def test_an_unexpected_failure_is_generic_and_logged(self):
        envelope, _, log = self.execute(RuntimeError('internal detail /home/someone'))
        self.assertEqual(envelope, {'ok': False, 'error': 'The analyzer stopped unexpectedly.'})
        self.assertIn('RuntimeError', log)
        self.assertNotIn('/home/someone', json.dumps(envelope))

    def test_results_that_cannot_be_json_are_refused(self):
        circular = {}
        circular['self'] = circular
        for outcome in ({'nan': float('nan')}, {'inf': float('inf')}, {'set': {1, 2}}, circular, {1, 2}):
            with self.subTest(outcome=repr(outcome)[:40]):
                envelope, _, _ = self.execute(outcome)
                self.assertEqual(envelope, {'ok': False, 'error': 'The analyzer returned a result that cannot be written as JSON.'})

    def test_the_size_limit_is_exact(self):
        template = '{"ok":true,"result":{"pad":""}}'
        exact = {'pad': 'x' * (1_500_000 - len(template))}
        directory = self.prepare()
        with mock.patch.object(tools, 'execute', return_value=exact):
            worker.run(directory, now=NOW)
        self.assertEqual((directory / 'result.json').stat().st_size, 1_500_000)
        self.assertTrue(self.result(directory)['ok'])
        over = {'pad': 'x' * (1_500_001 - len(template))}
        with mock.patch.object(tools, 'execute', return_value=over):
            worker.run(directory, now=NOW)
        self.assertEqual(self.result(directory), {'ok': False, 'error': 'Result is too large to return (limit 1,500,000 bytes)'})

    def test_size_is_measured_on_the_written_bytes(self):
        directory = self.prepare()
        # Each of these characters is escaped to six ASCII bytes, so 300,000 of them exceed the limit.
        with mock.patch.object(tools, 'execute', return_value={'pad': '茶' * 300_000}):
            worker.run(directory, now=NOW)
        self.assertFalse(self.result(directory)['ok'])

    def test_text_round_trips_as_ascii_json(self):
        directory = self.prepare()
        with mock.patch.object(tools, 'execute', return_value={'text': 'Café 茶 😀'}):
            worker.run(directory, now=NOW)
        raw = (directory / 'result.json').read_bytes()
        raw.decode('ascii')
        self.assertEqual(json.loads(raw)['result']['text'], 'Café 茶 😀')

    def test_the_unknown_tool_error_comes_from_the_registry(self):
        with self.assertRaises(ValueError):
            tools.execute('nope', {}, now=NOW)
        with self.assertRaises(ValueError):
            tools.execute('x-studio', [], now=NOW)  # type: ignore[arg-type]


class Subprocess(RunDirectory):
    def test_the_module_runs_as_a_process_and_records_an_envelope(self):
        directory = self.prepare(tool='nope')
        done = subprocess.run([sys.executable, '-m', 'social_service.worker', str(directory)], cwd=directory,
                              env=runner.worker_environment(directory), stdin=subprocess.DEVNULL,
                              capture_output=True, text=True, timeout=60)
        self.assertEqual((done.returncode, done.stderr), (0, ''))
        self.assertEqual(self.result(directory), {'ok': False, 'error': 'Unknown tool'})

    def test_a_missing_input_file_is_a_crash_not_a_result(self):
        directory = self.scratch / 'empty'
        directory.mkdir()
        done = subprocess.run([sys.executable, '-m', 'social_service.worker', str(directory)], cwd=directory,
                              env=runner.worker_environment(directory), capture_output=True, text=True, timeout=60)
        self.assertNotEqual(done.returncode, 0)
        self.assertFalse((directory / 'result.json').exists())

    def test_usage_errors_exit_two(self):
        with contextlib.redirect_stderr(io.StringIO()) as log:
            self.assertEqual(worker.main([]), 2)
            self.assertEqual(worker.main(['a', 'b']), 2)
        self.assertIn('usage: python3 -m social_service.worker <run_dir>', log.getvalue())


class AuditHook(ScratchTestCase):
    def test_sockets_and_process_launch_are_denied_and_files_are_not(self):
        code = '''
            import json, os, socket, subprocess, sys
            from social_service import worker
            worker.install_audit_hook()
            outcomes = {}
            def attempt(name, action):
                try:
                    action()
                    outcomes[name] = 'allowed'
                except PermissionError:
                    outcomes[name] = 'denied'
                except BaseException as exc:
                    outcomes[name] = 'other:' + type(exc).__name__
            python = sys.executable
            attempt('socket', lambda: socket.socket())
            attempt('udp socket', lambda: socket.socket(socket.AF_INET, socket.SOCK_DGRAM))
            attempt('create_connection', lambda: socket.create_connection(('127.0.0.1', 9), timeout=1))
            attempt('getaddrinfo', lambda: socket.getaddrinfo('example.invalid', 80))
            attempt('gethostbyname', lambda: socket.gethostbyname('example.invalid'))
            attempt('Popen', lambda: subprocess.Popen([python, '-c', 'pass']))
            attempt('subprocess.run', lambda: subprocess.run([python, '-c', 'pass']))
            attempt('check_output', lambda: subprocess.check_output([python, '-c', 'pass']))
            attempt('os.system', lambda: os.system('exit 0'))
            attempt('os.execv', lambda: os.execv(python, [python, '-c', 'pass']))
            attempt('os.execvp', lambda: os.execvp(python, [python, '-c', 'pass']))
            attempt('os.posix_spawn', lambda: os.posix_spawn(python, [python, '-c', 'pass'], {}))
            attempt('os.spawnv', lambda: os.spawnv(os.P_WAIT, python, [python, '-c', 'pass']))
            attempt('os.fork', lambda: os.fork())
            attempt('os.forkpty', lambda: os.forkpty())
            attempt('write file', lambda: open('note.txt', 'w').close())
            attempt('read file', lambda: open('note.txt').close())
            attempt('listdir', lambda: os.listdir('.'))
            attempt('import', lambda: __import__('json'))
            print(json.dumps(outcomes))
        '''
        done = python(code, self.scratch)
        self.assertEqual(done.returncode, 0, done.stderr)
        outcomes = json.loads(done.stdout)
        denied = {name for name, outcome in outcomes.items() if outcome == 'denied'}
        allowed = {name for name, outcome in outcomes.items() if outcome == 'allowed'}
        self.assertEqual(allowed, {'write file', 'read file', 'listdir', 'import'}, outcomes)
        self.assertEqual(len(denied), len(outcomes) - 4, outcomes)

    def test_an_analyzer_that_opens_a_socket_fails_the_run_with_the_generic_message(self):
        directory = self.scratch / 'run'
        directory.mkdir()
        (directory / 'input.json').write_text(json.dumps({'tool': 'x-studio', 'input': {}}))
        code = '''
            import socket, sys
            from pathlib import Path
            from unittest import mock
            from social_service import tools, worker
            def sneaky(tool, data, *, now):
                socket.create_connection(("127.0.0.1", 9), timeout=1)
            worker.install_audit_hook()
            with mock.patch.object(tools, "execute", sneaky):
                worker.run(Path("run"))
            print(Path("run/result.json").read_text())
        '''
        done = python(code, self.scratch)
        self.assertEqual(done.returncode, 0, done.stderr)
        self.assertEqual(json.loads(done.stdout), {'ok': False, 'error': 'The analyzer stopped unexpectedly.'})
        self.assertIn('PermissionError', done.stderr)


class Limits(ScratchTestCase):
    def test_limits_are_lowered_to_the_documented_values_where_the_platform_allows(self):
        code = '''
            import json
            from social_service import worker
            applied = worker.apply_limits()
            try:
                import resource
                read = {name: resource.getrlimit(getattr(resource, name)) for name in applied}
            except ImportError:
                read = {}
            print(json.dumps({"applied": applied, "read": read}))
        '''
        done = python(code, self.scratch)
        self.assertEqual(done.returncode, 0, done.stderr)
        seen = json.loads(done.stdout)
        wanted = {'RLIMIT_CPU': 45, 'RLIMIT_AS': 1024 ** 3, 'RLIMIT_FSIZE': 32 * 1024 ** 2}
        self.assertEqual(worker.LIMITS, wanted)
        for name, pair in seen['applied'].items():
            self.assertEqual(pair, [wanted[name]] * 2, name)
            self.assertEqual(seen['read'][name], [wanted[name]] * 2, name)
        if sys.platform.startswith('linux'):
            self.assertEqual(set(seen['applied']), set(wanted))

    @unittest.skipUnless(sys.platform.startswith('linux'), 'RLIMIT_AS is only enforced on Linux')
    def test_a_file_over_32_mib_and_memory_over_1_gib_are_refused(self):
        code = '''
            from social_service import worker
            worker.apply_limits()
            results = {}
            try:
                with open("big.bin", "wb") as handle:
                    handle.write(b"x" * (33 * 1024 * 1024))
                results["file"] = "written"
            except OSError as exc:
                results["file"] = "refused"
            try:
                bytearray(1536 * 1024 * 1024)
                results["memory"] = "allocated"
            except MemoryError:
                results["memory"] = "refused"
            print(results)
        '''
        done = python(code, self.scratch)
        self.assertEqual(done.returncode, 0, done.stderr)
        self.assertEqual(done.stdout.strip(), "{'file': 'refused', 'memory': 'refused'}")

    def test_a_lower_existing_hard_limit_is_respected_rather_than_raised(self):
        code = '''
            import resource
            from social_service import worker
            if not hasattr(resource, "RLIMIT_CPU"):
                print("none")
            else:
                resource.setrlimit(resource.RLIMIT_CPU, (10, 10))
                print(worker.apply_limits().get("RLIMIT_CPU"), resource.getrlimit(resource.RLIMIT_CPU))
        '''
        done = python(code, self.scratch)
        self.assertEqual(done.returncode, 0, done.stderr)
        self.assertIn(done.stdout.strip(), ('none', '(10, 10) (10, 10)'))


if __name__ == '__main__':
    unittest.main()
