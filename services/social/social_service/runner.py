"""Run queue: at most 8 runs queued or running, executed one at a time on a single worker thread.

Each run is a fresh subprocess (``python3 -m social_service.worker <run_dir>``) with a scrubbed
environment, the run directory as working directory, stdin from ``/dev/null``, output to ``worker.log``
and a 60 s timeout. Statuses move ``queued -> running -> succeeded | failed``. A run that cannot finish
because the service stops becomes ``interrupted``. Nothing is ever retried.
"""

from __future__ import annotations

import json
import os
import queue
import signal
import subprocess
import sys
import threading
from collections.abc import Callable, Sequence
from pathlib import Path
from typing import Any

from .errors import ConflictError, ValidationError
from .store import Store
from .validation import MESSAGES, RunInput
from .worker import ERROR_LIMIT, RESULT_LIMIT, TOO_LARGE

SERVICE_ROOT = Path(__file__).resolve().parent.parent
MAX_ACTIVE_RUNS = 8
RUN_TIMEOUT = 60.0
FINISHED = ('succeeded', 'failed')


def default_worker_command() -> list[str]:
    return [sys.executable, '-m', 'social_service.worker']


def worker_environment(run_dir: Path) -> dict[str, str]:
    """The only variables a worker sees; nothing is inherited from the service."""
    return {
        'PATH': '/usr/bin:/bin',
        'HOME': str(run_dir),
        'TMPDIR': str(run_dir),
        'PYTHONDONTWRITEBYTECODE': '1',
        'PYTHONPATH': str(SERVICE_ROOT),
    }


def _read_json(path: Path) -> Any:
    text = path.read_bytes().decode('utf-8')

    def reject(constant: str) -> Any:
        raise ValueError(constant)

    return json.loads(text, parse_constant=reject)


def read_envelope(path: Path, limit: int = RESULT_LIMIT) -> dict[str, Any] | None:
    """The ``{ok, result|error}`` envelope in ``path``, or None when absent, oversized or not an envelope."""
    try:
        if path.stat().st_size > limit:
            return None
        envelope = _read_json(path)
    except (OSError, ValueError, RecursionError):
        return None
    if not isinstance(envelope, dict) or not isinstance(envelope.get('ok'), bool):
        return None
    if envelope['ok'] and 'result' in envelope:
        return {'ok': True, 'result': envelope['result']}
    if not envelope['ok'] and isinstance(envelope.get('error'), str):
        return {'ok': False, 'error': envelope['error']}
    return None


class RunManager:
    def __init__(self, store: Store, runs_dir: Path, *, clock: Callable[[], str], new_id: Callable[[], str],
                 worker_command: Sequence[str] | None = None, timeout: float = RUN_TIMEOUT,
                 max_active: int = MAX_ACTIVE_RUNS, result_limit: int = RESULT_LIMIT):
        self._store = store
        self._runs_dir = Path(runs_dir)
        self._clock = clock
        self._new_id = new_id
        self._command = list(worker_command) if worker_command is not None else default_worker_command()
        self._timeout = timeout
        self._max_active = max_active
        self._result_limit = result_limit
        self._queue: queue.Queue[str | None] = queue.Queue()
        self._submit_lock = threading.Lock()
        self._process_lock = threading.Lock()
        self._process: subprocess.Popen[bytes] | None = None
        self._stopping = False
        self._thread: threading.Thread | None = None

    # -------------------------------------------------------------- lifecycle

    def start(self) -> None:
        if self._thread is None:
            self._thread = threading.Thread(target=self._loop, name='social-runs', daemon=True)
            self._thread.start()

    def stop(self) -> None:
        """Stop the worker thread, kill a running worker and mark unfinished runs interrupted."""
        with self._process_lock:
            self._stopping = True
            if self._process is not None:
                self._kill(self._process)
        self._queue.put(None)
        if self._thread is not None:
            self._thread.join(timeout=15)
        self._store.interrupt_active(self._clock())

    # ----------------------------------------------------------------- submit

    def run_dir(self, run_id: str) -> Path:
        return self._runs_dir / run_id

    def submit(self, run: RunInput) -> dict[str, Any]:
        """Queue a run, or raise ConflictError when eight are already queued or running."""
        with self._submit_lock:
            if self._store.active_run_count() >= self._max_active:
                raise ConflictError(MESSAGES['queue_full'])
            try:
                payload = json.dumps({'tool': run.tool, 'input': run.input}, ensure_ascii=True, allow_nan=False)
            except RecursionError:
                raise ValidationError(MESSAGES['input_too_deep']) from None
            run_id = self._new_id()
            directory = self.run_dir(run_id)
            directory.mkdir(parents=True, mode=0o700)
            try:
                (directory / 'input.json').write_text(payload, encoding='utf-8')
                record = self._store.insert_run(run_id, run.tool, run.is_example, self._clock())
            except BaseException:
                self._discard(directory)
                raise
            self._queue.put(run_id)
        return record

    def output(self, run_id: str) -> dict[str, Any] | None:
        """The finished run's envelope for ``GET /api/runs/<id>``, or None when there is no result file."""
        return read_envelope(self.run_dir(run_id) / 'result.json', self._result_limit)

    # ----------------------------------------------------------------- worker

    def _loop(self) -> None:
        while True:
            run_id = self._queue.get()
            if run_id is None:
                return
            try:
                self._execute(run_id)
            except Exception:  # noqa: BLE001 - one bad run must never stop the queue
                sys.stderr.write(f'Run {run_id} could not be completed\n')
                self._store.finish_run(run_id, 'failed', 'The run could not be completed.', self._clock())

    def _execute(self, run_id: str) -> None:
        directory = self.run_dir(run_id)
        self._store.mark_running(run_id)
        outcome = self._run_worker(directory)
        if outcome is None:  # the service is stopping; stop() marks the run interrupted
            return
        status, error = outcome
        self._store.finish_run(run_id, status, None if error is None else error[:ERROR_LIMIT], self._clock())

    def _run_worker(self, directory: Path) -> tuple[str, str | None] | None:
        result = directory / 'result.json'
        with self._process_lock:
            if self._stopping:
                return None
            try:
                with open(directory / 'worker.log', 'wb') as log:
                    process = subprocess.Popen(
                        [*self._command, str(directory)], cwd=directory, env=worker_environment(directory),
                        stdin=subprocess.DEVNULL, stdout=log, stderr=subprocess.STDOUT,
                        start_new_session=True, close_fds=True)
            except OSError:
                return 'failed', 'The run could not be started.'
            self._process = process
        timed_out = False
        try:
            process.wait(timeout=self._timeout)
        except subprocess.TimeoutExpired:
            timed_out = True
            self._kill(process)
        finally:
            with self._process_lock:
                self._process = None
                stopping = self._stopping
        if stopping:
            return None
        code = process.returncode
        if timed_out:
            self._discard_file(result)
            return 'failed', f'The run took longer than {self._timeout:g} seconds and was stopped.'
        if code != 0:
            self._discard_file(result)
            detail = f'signal {-code}' if code < 0 else f'exit status {code}'
            return 'failed', f'The run ended unexpectedly ({detail}).'
        try:
            size = result.stat().st_size
        except OSError:
            return 'failed', 'The run ended without a result.'
        if size > self._result_limit:
            result.write_text(json.dumps({'ok': False, 'error': TOO_LARGE}), encoding='utf-8')
            return 'failed', TOO_LARGE
        envelope = read_envelope(result, self._result_limit)
        if envelope is None:
            self._discard_file(result)
            return 'failed', 'The run produced an unreadable result.'
        if envelope['ok']:
            return 'succeeded', None
        return 'failed', envelope['error']

    @staticmethod
    def _kill(process: subprocess.Popen[bytes]) -> None:
        if process.poll() is None:
            try:
                os.killpg(process.pid, signal.SIGKILL)  # the worker leads its own session and group
            except (ProcessLookupError, PermissionError):
                process.kill()
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            pass

    @staticmethod
    def _discard_file(path: Path) -> None:
        try:
            path.unlink()
        except OSError:
            pass

    @staticmethod
    def _discard(directory: Path) -> None:
        for child in directory.glob('*'):
            RunManager._discard_file(child)
        try:
            directory.rmdir()
        except OSError:
            pass
