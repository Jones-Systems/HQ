"""One analyzer run in a fresh, network-denied subprocess: ``python3 -m social_service.worker <run_dir>``.

The runner starts this with a scrubbed environment, the run directory as working directory and stdin
closed. The worker reads ``input.json`` (``{"tool": ..., "input": {...}}``), applies resource limits where
the platform has them, installs an audit hook that denies sockets and process launch, calls
``tools.execute`` and writes ``result.json`` as ``{"ok": true, "result": ...}`` or
``{"ok": false, "error": "..."}``.
"""

from __future__ import annotations

import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

RESULT_LIMIT = 1_500_000
ERROR_LIMIT = 4_000
TOO_LARGE = f'Result is too large to return (limit {RESULT_LIMIT:,} bytes)'
UNEXPECTED = 'The analyzer stopped unexpectedly.'
UNSERIALIZABLE = 'The analyzer returned a result that cannot be written as JSON.'

LIMITS = {'RLIMIT_CPU': 45, 'RLIMIT_AS': 1024 ** 3, 'RLIMIT_FSIZE': 32 * 1024 ** 2}
_DENIED_EVENTS = frozenset({'subprocess.Popen', 'os.system', 'os.exec', 'os.posix_spawn', 'os.spawn',
                            'os.fork', 'os.forkpty'})


def apply_limits() -> dict[str, tuple[int, int]]:
    """Lower the CPU, address-space and file-size limits. Returns what was set; empty without ``resource``."""
    try:
        import resource
    except ImportError:
        return {}
    applied: dict[str, tuple[int, int]] = {}
    for name, wanted in LIMITS.items():
        which = getattr(resource, name, None)
        if which is None:
            continue
        try:
            _, hard = resource.getrlimit(which)
            value = wanted if hard == resource.RLIM_INFINITY or wanted <= hard else hard
            resource.setrlimit(which, (value, value))
            applied[name] = (value, value)
        except (ValueError, OSError):
            continue
    return applied


def install_audit_hook() -> None:
    """Deny ``socket.*`` events, subprocess creation, ``os.system``, ``os.exec*``, ``posix_spawn`` and ``fork``."""

    def deny(event: str, args: tuple[Any, ...]) -> None:
        if event.startswith('socket.') or event in _DENIED_EVENTS:
            raise PermissionError(f'{event} is not available to analyzers')

    sys.addaudithook(deny)


def _dumps(envelope: dict[str, Any]) -> str:
    return json.dumps(envelope, ensure_ascii=True, separators=(',', ':'), allow_nan=False)


def build_envelope(tool: str, data: dict[str, Any], now: datetime) -> dict[str, Any]:
    """Run the analyzer. ``ValueError`` is a user-facing rejection; any other exception is logged and generic."""
    from . import tools
    try:
        return {'ok': True, 'result': tools.execute(tool, data, now=now)}
    except ValueError as exc:
        return {'ok': False, 'error': str(exc)[:ERROR_LIMIT] or 'The input was rejected.'}
    except Exception:  # noqa: BLE001 - recorded in worker.log; the client sees a fixed message
        import traceback
        traceback.print_exc()
        return {'ok': False, 'error': UNEXPECTED}


def serialize(envelope: dict[str, Any]) -> str:
    """The exact result text, replaced by an ``ok: false`` envelope when it cannot be written or is too large."""
    try:
        text = _dumps(envelope)
    except (TypeError, ValueError, RecursionError):
        return _dumps({'ok': False, 'error': UNSERIALIZABLE})
    if len(text.encode('utf-8')) > RESULT_LIMIT:
        return _dumps({'ok': False, 'error': TOO_LARGE})
    return text


def run(run_dir: Path, *, now: datetime | None = None) -> None:
    """Read the input, execute, and atomically write ``result.json`` in ``run_dir``."""
    payload = json.loads((run_dir / 'input.json').read_text(encoding='utf-8'))
    envelope = build_envelope(payload['tool'], payload['input'], now or datetime.now(timezone.utc))
    text = serialize(envelope)
    partial = run_dir / 'result.json.partial'
    partial.write_text(text, encoding='utf-8')
    os.replace(partial, run_dir / 'result.json')


def main(argv: list[str] | None = None) -> int:
    arguments = sys.argv[1:] if argv is None else argv
    if len(arguments) != 1:
        print('usage: python3 -m social_service.worker <run_dir>', file=sys.stderr)
        return 2
    apply_limits()
    from . import tools  # noqa: F401 - import the registry before the hook closes process access
    install_audit_hook()
    run(Path(arguments[0]))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
