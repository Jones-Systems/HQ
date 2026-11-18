"""Checked-in golden exchanges must be reproducible, byte for byte, from the actual HTTP service."""
import hashlib
import importlib.util
import json
import re
import socket
import unittest
from pathlib import Path

from support import ROOT

SYNTHETIC = '2026-01-15T12:00:'


def module(name):
    spec = importlib.util.spec_from_file_location(name, ROOT / 'contract' / f'{name}.py')
    loaded = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(loaded)
    return loaded


def scratch_directories():
    """Directories made by ``tempfile.mkdtemp(prefix='hq-social-')``, not unrelated files that share the prefix."""
    return {path for path in Path('/tmp').glob('hq-social-*') if path.is_dir() and re.fullmatch('hq-social-[a-z0-9_]{8}', path.name)}


def exchanges():
    return {path.name: json.loads(path.read_text()) for path in sorted((ROOT / 'contract' / 'exchanges').glob('*.json'))}


class ContractDrift(unittest.TestCase):
    def test_real_http_exchanges_have_no_drift(self):
        generator = module('generate')
        expected = {path.name: path.read_text() for path in (ROOT / 'contract/exchanges').glob('*.json')}
        self.assertTrue(expected, 'Golden exchanges must exist')
        self.assertEqual(generator.rendered(generator.capture()), expected)

    def test_manifest_pins_every_exchange(self):
        folder = ROOT / 'contract'
        expected = {f'exchanges/{path.name}': hashlib.sha256(path.read_bytes()).hexdigest()
                    for path in sorted((folder / 'exchanges').glob('*.json'))}
        actual = {}
        for line in (folder / 'SHA256SUMS').read_text().splitlines():
            digest, path = line.split('  ', 1)
            actual[path] = digest
        self.assertEqual(actual, expected)

    def test_disposable_service_cleanup_on_failure_and_interrupt(self):
        generator = module('generate')
        before = scratch_directories()
        for failure in (RuntimeError, KeyboardInterrupt):
            with self.subTest(failure=failure.__name__), self.assertRaises(failure):
                with generator.service() as port:
                    raise failure('synthetic cancellation')
            with self.assertRaises(OSError):
                with socket.create_connection(('127.0.0.1', port), timeout=1):
                    self.fail('Disposable service still accepts connections')
            self.assertEqual(scratch_directories() - before, set())


class ContractContent(unittest.TestCase):
    def setUp(self):
        self.captured = exchanges()

    def test_the_capture_covers_every_route_and_the_key_errors(self):
        routes = set()
        for name, item in self.captured.items():
            path = re.sub('[0-9a-f]{32}', '<id>', item['request']['path'])
            path = re.sub('/api/sample/.*', '/api/sample/<tool>', path)
            routes.add((item['request']['method'], path))
        self.assertGreaterEqual(len(self.captured), 15)
        self.assertGreaterEqual(routes, {
            ('GET', '/api/workspace'), ('GET', '/api/sample/<tool>'), ('GET', '/api/runs/<id>'),
            ('POST', '/api/content'), ('POST', '/api/brands'), ('POST', '/api/runs'),
            ('DELETE', '/api/content'), ('GET', '/api/missing'),
        })
        errors = {item['response']['body']['error'] for item in self.captured.values() if item['response']['status'] >= 400}
        self.assertGreaterEqual(errors, {
            'Unknown tool', 'Unknown field: priority', 'Each HQ reference can be linked once',
            'This draft changed in another window. Close and reopen it before saving.',
            'Choose a known tool and supply a JSON object', 'Reload the workspace before saving',
            'Unrecognized host', 'Cross-origin request refused', 'JSON required', 'Method not allowed', 'Route not found'})
        self.assertGreaterEqual({item['response']['status'] for item in self.captured.values()}, {200, 201, 400, 403, 404, 405, 409})

    def test_every_response_is_the_documented_shape(self):
        for name, item in self.captured.items():
            with self.subTest(name):
                self.assertEqual(item['schema'], 'hq.social.exchange/v1')
                response = item['response']
                self.assertEqual(response['headers']['Cache-Control'], 'no-store')
                self.assertEqual(response['headers']['X-Content-Type-Options'], 'nosniff')
                self.assertEqual(response['headers']['Referrer-Policy'], 'no-referrer')
                self.assertEqual(response['headers']['Content-Security-Policy'], "default-src 'none'; frame-ancestors 'none'")
                self.assertEqual(response['headers']['Content-Type'], 'application/json; charset=utf-8')
                if response['status'] >= 400:
                    self.assertEqual(list(response['body']), ['error'])

    def test_volatile_values_are_deterministic_and_nothing_real_is_recorded(self):
        text = '\n'.join(json.dumps(item) for item in self.captured.values())
        for stamp in re.findall(r'\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?\+00:00', text):
            self.assertTrue(stamp.startswith(SYNTHETIC), stamp)
        for identifier in re.findall(r'"(?:id|brand_id)": "([0-9a-f]{32})"', text):
            self.assertRegex(identifier, '^0{24}[0-9a-f]{8}$')
        self.assertEqual(self.captured['01-workspace-empty.json']['response']['body']['csrf'], 'synthetic-workspace-token')
        for forbidden in ('/home/', '/Users/', '127.0.0.1:', 'localhost:'):
            self.assertNotIn(forbidden, text)

    def test_the_run_exchanges_show_a_finished_record_with_output(self):
        done = self.captured['12-run-succeeded.json']['response']['body']
        self.assertEqual((done['status'], done['error'], done['output']['ok']), ('succeeded', None, True))
        failed = self.captured['13-run-failed.json']['response']['body']
        self.assertEqual((failed['status'], failed['error'], failed['is_example']), ('failed', 'Synthetic contract failure', 1))
        self.assertEqual(failed['output'], {'ok': False, 'error': 'Synthetic contract failure'})
        self.assertEqual(self.captured['11-run-submit.json']['response']['body']['status'], 'queued')
        self.assertNotIn('output', self.captured['11-run-submit.json']['response']['body'])

    def test_links_and_slots_are_preserved_then_cleared(self):
        created = self.captured['05-draft-create.json']['response']['body']
        kept = self.captured['06-draft-update-keeps-links-and-slot.json']['response']['body']
        cleared = self.captured['10-draft-clears-links-and-slot.json']['response']['body']
        self.assertEqual((kept['links'], kept['planning_slot']), (created['links'], created['planning_slot']))
        self.assertEqual((kept['version'], cleared['version']), (2, 3))
        self.assertEqual((cleared['links'], cleared['planning_slot']), ([], None))
        self.assertEqual(len(created['links']), 1)


if __name__ == '__main__':
    unittest.main()
