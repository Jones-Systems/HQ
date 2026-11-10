"""Run the HQ Social service: ``python3 -m social_service --data /path/outside/HQ/social --port 8766``."""

from __future__ import annotations

import argparse
import re
import signal
import sys
import threading
from pathlib import Path
from types import FrameType

from .datadir import DataDirError, LockError, acquire_lock, prepare_data_dir
from .server import create_server, display_host, is_loopback_host
from .service import SocialService
from .store import StoreError

_ALLOWED_HOST = re.compile(r'[A-Za-z0-9._:\[\]-]+')


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(prog='social_service',
                                     description='HQ Social workspace service (loopback only).')
    parser.add_argument('--data', required=True,
                        help='Data directory, outside the HQ repository. Created (mode 0700) when its parent exists.')
    parser.add_argument('--host', default='127.0.0.1', help='Loopback address to bind (default 127.0.0.1).')
    parser.add_argument('--port', type=int, default=8766, help='Port (default 8766). 0 picks a free port.')
    parser.add_argument('--allowed-host', action='append', default=[], metavar='HOST[:PORT]',
                        help='Extra Host header value to accept, for a private HTTPS front. May repeat.')
    parser.add_argument('--publishing', choices=['off'], default='off',
                        help='Account connection and publishing. Only "off" exists.')
    return parser.parse_args(argv)


def ready_line(host: str, port: int, data: Path) -> str:
    return f'Social service on http://{display_host(host)}:{port}/  (data: {data})'


def refuse(message: str) -> int:
    print(message, file=sys.stderr)
    return 2


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    if not is_loopback_host(args.host):
        return refuse('Refusing to bind a non-loopback address; private hosting needs its own setup.')
    if not 0 <= args.port <= 65535:
        return refuse('The port must be between 0 and 65535.')
    for allowed in args.allowed_host:
        if _ALLOWED_HOST.fullmatch(allowed) is None:
            return refuse(f'--allowed-host must look like HOST or HOST:PORT, not {allowed!r}.')
    try:
        data, warning = prepare_data_dir(args.data)
    except DataDirError as exc:
        return refuse(str(exc))
    if warning:
        print(warning, file=sys.stderr)
    try:
        lock = acquire_lock(data)
    except LockError as exc:
        return refuse(str(exc))
    try:
        try:
            service = SocialService(data)
        except StoreError as exc:
            return refuse(str(exc))
        try:
            server = create_server(service, args.host, args.port, tuple(args.allowed_host))
        except OSError as exc:
            service.close()
            print(f'Could not listen on {display_host(args.host)}:{args.port}: {exc}', file=sys.stderr)
            return 1
        port = server.server_address[1]

        def stop(signum: int, frame: FrameType | None) -> None:
            # serve_forever runs in this thread, so shutdown() must be requested from another one.
            threading.Thread(target=server.shutdown, daemon=True).start()

        if threading.current_thread() is threading.main_thread():
            signal.signal(signal.SIGTERM, stop)
            signal.signal(signal.SIGINT, stop)
        print(ready_line(args.host, port, data), flush=True)
        try:
            server.serve_forever(poll_interval=0.1)
        finally:
            server.server_close()
            service.close()
    finally:
        lock.release()
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
