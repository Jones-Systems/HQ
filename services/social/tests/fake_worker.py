"""Test-only stand-in for ``social_service.worker``, so run lifecycles never depend on the analyzers.

It is started exactly like the real worker (``<python> <this file> <run_dir>``) and behaves as the run's
``input`` says: ``{"mode": "ok" | "fail" | "sleep" | "block" | "size" | "crash" | ...}``. It never imports
``social_service``; it is plain files, time and exit codes.
"""

import json
import os
import signal
import sys
import time
from pathlib import Path


def write(run_dir, text):
    (run_dir / 'result.json').write_text(text, encoding='utf-8')


def main():
    run_dir = Path(sys.argv[1])
    payload = json.loads((run_dir / 'input.json').read_text(encoding='utf-8'))
    tool, data = payload['tool'], payload['input']
    mode = data.get('mode', 'ok')
    (run_dir / 'pid').write_text(str(os.getpid()), encoding='utf-8')
    if mode == 'ok':
        write(run_dir, json.dumps({'ok': True, 'result': {'tool': tool, 'echo': data}}))
    elif mode == 'fail':
        write(run_dir, json.dumps({'ok': False, 'error': data.get('message', 'Synthetic failure')}))
    elif mode == 'long_error':
        write(run_dir, json.dumps({'ok': False, 'error': 'e' * 5000}))
    elif mode == 'sleep':
        time.sleep(data.get('seconds', 30))
        write(run_dir, json.dumps({'ok': True, 'result': {}}))
    elif mode == 'late':
        write(run_dir, json.dumps({'ok': True, 'result': {'late': True}}))
        time.sleep(data.get('seconds', 30))
    elif mode == 'block':
        (run_dir / 'started').write_text('1', encoding='utf-8')
        gate = Path(data['gate'])
        deadline = time.monotonic() + 30
        while not gate.exists() and time.monotonic() < deadline:
            time.sleep(0.02)
        write(run_dir, json.dumps({'ok': True, 'result': {'released': gate.exists()}}))
    elif mode == 'size':
        prefix, suffix = '{"ok":true,"result":{"pad":"', '"}}'
        write(run_dir, prefix + 'x' * (data['bytes'] - len(prefix) - len(suffix)) + suffix)
    elif mode == 'crash':
        sys.exit(3)
    elif mode == 'killed':
        os.kill(os.getpid(), signal.SIGKILL)
    elif mode == 'noresult':
        pass
    elif mode == 'garbage':
        write(run_dir, 'this is not json')
    elif mode == 'nonenvelope':
        write(run_dir, json.dumps([1, 2, 3]))
    elif mode == 'nan':
        write(run_dir, '{"ok": true, "result": NaN}')
    elif mode == 'environment':
        write(run_dir, json.dumps({'ok': True, 'result': {
            'env': dict(os.environ), 'cwd': os.getcwd(), 'argv': sys.argv, 'stdin': sys.stdin.read(),
            'new_session': os.getsid(0) == os.getpid()}}))
    else:
        raise SystemExit(f'unknown mode {mode}')


if __name__ == '__main__':
    main()
