"""Capture real HTTP exchanges from a disposable, deterministic HQ Social service process."""
from __future__ import annotations

import argparse
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
import hashlib
import http.client
import itertools
import json
import os
from pathlib import Path
import selectors
import shutil
import signal
import subprocess
import sys
import tempfile
import threading

ROOT = Path(__file__).resolve().parent.parent
CONTRACT = ROOT / 'contract'
SCHEMA = 'hq.social.exchange/v1'
TOKEN = 'synthetic-workspace-token'
START = datetime(2026, 1, 15, 12, 0, 0, tzinfo=timezone.utc)
sys.path.insert(0, str(ROOT))


def serve(data_dir):
    """Run one disposable service: counter ids, a one-second-per-call clock, a fixed token, a contract worker."""
    from social_service.server import create_server
    from social_service.service import SocialService
    ids, ticks = itertools.count(1), itertools.count()
    service = SocialService(
        Path(data_dir), token=TOKEN, timezones=True,
        new_id=lambda: f'{next(ids):032x}',
        clock=lambda: START + timedelta(seconds=next(ticks)),
        worker_command=[sys.executable, '-B', str(CONTRACT / 'contract_worker.py')])
    server = create_server(service, '127.0.0.1', 0, ('localhost',))
    signal.signal(signal.SIGTERM, lambda *_: threading.Thread(target=server.shutdown, daemon=True).start())
    print(server.server_address[1], flush=True)
    try:
        server.serve_forever(poll_interval=0.05)
    finally:
        server.server_close()
        service.close()


@contextmanager
def service():
    previous_term = signal.getsignal(signal.SIGTERM)

    def cancel(*_):
        raise KeyboardInterrupt

    signal.signal(signal.SIGTERM, cancel)
    scratch = Path(tempfile.mkdtemp(prefix='hq-social-', dir='/tmp' if os.path.isdir('/tmp') else None))
    process = None
    try:
        data = scratch / 'data'
        data.mkdir()
        process = subprocess.Popen([sys.executable, '-B', str(Path(__file__).resolve()), '--serve', str(data)],
                                   stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True)
        with selectors.DefaultSelector() as selector:
            selector.register(process.stdout, selectors.EVENT_READ)
            if not selector.select(timeout=10):
                raise RuntimeError('Disposable service did not bind within ten seconds')
            port = int(process.stdout.readline())
        yield port
    finally:
        if process is not None:
            process.terminate()
            try:
                process.wait(timeout=10)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=5)
            process.stdout.close()
        shutil.rmtree(scratch, ignore_errors=True)
        signal.signal(signal.SIGTERM, previous_term)


def wire(body):
    return '' if body is None else json.dumps(body, separators=(',', ':'), ensure_ascii=True)


def capture():
    exchanges = {}
    with service() as port:
        def call(name, method, path, body=None, *, status=200, headers=None, token=TOKEN, raw=None, record=True):
            text = raw if raw is not None else wire(body)
            sent = {'Host': 'localhost', 'Accept': 'application/json'}
            if method == 'POST':
                sent.update({'Content-Type': 'application/json', 'X-Workspace-Token': token})
            sent.update(headers or {})
            connection = http.client.HTTPConnection('127.0.0.1', port, timeout=10)
            try:
                connection.request(method, path, body=text.encode() if text else None, headers=sent)
                response = connection.getresponse()
                payload = json.loads(response.read())
                received = {key: value for key, value in response.getheaders() if key.lower() not in ('date', 'server')}
                if response.status != status:
                    raise AssertionError(f'{name}: expected HTTP {status}, received {response.status}: {payload}')
                if record:
                    exchanges[name + '.json'] = {'schema': SCHEMA,
                        'request': {'method': method, 'path': path, 'headers': sent, 'body_utf8': text},
                        'response': {'status': response.status, 'headers': received, 'body': payload}}
                return payload
            finally:
                connection.close()

        def finished(run_id):
            for _ in range(2000):
                run = call('poll', 'GET', f'/api/runs/{run_id}', record=False)
                if run['status'] in ('succeeded', 'failed', 'interrupted'):
                    return run
                threading.Event().wait(0.01)
            raise AssertionError('Run did not finish')

        call('01-workspace-empty', 'GET', '/api/workspace')
        call('02-sample', 'GET', '/api/sample/x-studio')
        call('03-sample-unknown', 'GET', '/api/sample/nope', status=400)
        brand = call('04-brand-create', 'POST', '/api/brands', {'name': 'Larkspur Tea Co.'}, status=201)
        reference = {'version': 1, 'domain': 'work', 'projectId': 'project-1', 'kind': 'item', 'entityId': 'item-1',
                     'title': 'Plan the cupping hour',
                     'returnDestination': {'domain': 'social', 'destination': 'library'}}
        draft = call('05-draft-create', 'POST', '/api/content', {
            'title': 'Cupping hour invite', 'body': 'Free tasting on Saturday.', 'brand_id': brand['id'], 'channel': 'X',
            'planned_date': '2026-10-22', 'archived': 0, 'links': [reference],
            'planning_slot': {'start': '09:15', 'duration_minutes': 30, 'timezone': 'America/New_York'}}, status=201)
        edit = {'title': 'Cupping hour invite (edited)', 'body': 'Free tasting on Saturday.', 'brand_id': brand['id'],
                'channel': 'X', 'planned_date': '2026-10-22', 'archived': 0, 'id': draft['id'], 'version': 1}
        call('06-draft-update-keeps-links-and-slot', 'POST', '/api/content', edit)
        call('07-draft-conflict', 'POST', '/api/content', {**edit, 'title': 'Stale window'}, status=409)
        call('08-draft-unknown-field', 'POST', '/api/content', {'title': 'x', 'priority': 'high'}, status=400)
        call('09-draft-repeated-link', 'POST', '/api/content',
             {'title': 'x', 'links': [reference, {**reference, 'title': 'Same target'}]}, status=400)
        call('10-draft-clears-links-and-slot', 'POST', '/api/content',
             {**edit, 'title': 'Cleared', 'version': 2, 'links': [], 'planning_slot': None})
        queued = call('11-run-submit', 'POST', '/api/runs',
                      {'tool': 'x-studio', 'input': {'notes': 'Contract example'}, 'is_example': False}, status=201)
        finished(queued['id'])
        call('12-run-succeeded', 'GET', f'/api/runs/{queued["id"]}')
        failing = call('poll-submit', 'POST', '/api/runs', {'tool': 'social-publisher', 'input': {'fail': True}, 'is_example': True},
                       status=201, record=False)
        finished(failing['id'])
        call('13-run-failed', 'GET', f'/api/runs/{failing["id"]}')
        call('14-run-invalid', 'POST', '/api/runs', {'tool': 'nope', 'input': {}}, status=400)
        call('15-token-mismatch', 'POST', '/api/brands', {'name': 'Never saved'}, status=403, token='stale-token')
        call('16-host-refused', 'GET', '/api/workspace', status=403, headers={'Host': 'evil.example'})
        call('17-origin-refused', 'GET', '/api/workspace', status=403, headers={'Origin': 'https://evil.example'})
        call('18-content-type', 'POST', '/api/brands', raw='name=x', status=400, headers={'Content-Type': 'text/plain'})
        call('19-method-not-allowed', 'DELETE', '/api/content', status=405)
        call('20-route-not-found', 'GET', '/api/missing', status=404)
        call('21-workspace', 'GET', '/api/workspace')
    return exchanges


def rendered(exchanges):
    return {name: json.dumps(data, indent=2, ensure_ascii=True) + '\n' for name, data in exchanges.items()}


def manifest(files):
    return ''.join(f'{hashlib.sha256(content.encode()).hexdigest()}  exchanges/{name}\n' for name, content in sorted(files.items()))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--serve', metavar='DATA_DIR', help=argparse.SUPPRESS)
    parser.add_argument('--check', action='store_true')
    args = parser.parse_args()
    if args.serve:
        serve(args.serve)
        return 0
    output = rendered(capture())
    folder = CONTRACT / 'exchanges'
    if args.check:
        actual = {path.name: path.read_text() for path in folder.glob('*.json')}
        if output != actual or manifest(output) != (CONTRACT / 'SHA256SUMS').read_text():
            print('Social golden exchanges drifted; inspect the changes before regenerating.', file=sys.stderr)
            return 1
        print(f'Verified {len(output)} real HTTP exchanges.')
    else:
        folder.mkdir(exist_ok=True)
        for stale in folder.glob('*.json'):
            if stale.name not in output:
                stale.unlink()
        for name, content in output.items():
            (folder / name).write_text(content)
        (CONTRACT / 'SHA256SUMS').write_text(manifest(output))
        print(f'Captured {len(output)} real HTTP exchanges.')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
