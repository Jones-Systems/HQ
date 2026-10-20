"""Run the planning hub: ``python3 -m planning --data /path/outside/source/planning.sqlite3``."""

from __future__ import annotations

import argparse
import socket
import sys
from pathlib import Path

from .server import PUBLIC_DIR, PlanningApp, ThreadingHTTPServer, is_loopback_host, make_handler
from .store import Store


def port_number(value: str) -> int:
    port = int(value)
    if not 0 <= port <= 65535:
        raise argparse.ArgumentTypeError("must be between 0 and 65535")
    return port


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(prog="planning", description="Manual planning hub (loopback only).")
    parser.add_argument("--data", required=True,
                        help="SQLite store path. Must be outside the public/ directory; backups go beside it.")
    parser.add_argument("--host", default="127.0.0.1", help="Loopback address to bind (default 127.0.0.1).")
    parser.add_argument("--port", type=port_number, default=8765, help="Port (default 8765).")
    parser.add_argument("--allowed-host", action="append", default=[], metavar="HOST[:PORT]",
                        help="Extra Host header value to accept, e.g. when a private proxy fronts loopback.")
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    if not is_loopback_host(args.host):
        print("Refusing to bind a non-loopback address; private hosting needs its own setup.", file=sys.stderr)
        return 2
    data = Path(args.data).expanduser().resolve()
    project_root = PUBLIC_DIR.parent
    if data == PUBLIC_DIR or PUBLIC_DIR in data.parents:
        print("The data file must not live inside public/.", file=sys.stderr)
        return 2
    if project_root in data.parents:
        print(f"Warning: {data} is inside the website source tree; prefer a separate data directory.",
              file=sys.stderr)
    if not data.parent.is_dir():
        print(f"Data directory {data.parent} does not exist.", file=sys.stderr)
        return 2
    store = Store(data)
    server_class = ThreadingHTTPServer
    if ":" in args.host:
        server_class = type("ThreadingHTTPServerV6", (ThreadingHTTPServer,), {"address_family": socket.AF_INET6})
    server = server_class((args.host, args.port), None)
    port = server.server_address[1]
    app = PlanningApp(store, port=port, extra_hosts=tuple(args.allowed_host))
    server.RequestHandlerClass = make_handler(app)
    shown = f"[{args.host}]" if ":" in args.host else args.host
    print(f"Planning hub on http://{shown}:{port}/  (data: {data})", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
        store.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
