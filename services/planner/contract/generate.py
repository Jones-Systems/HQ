"""Capture real HTTP exchanges from a disposable, deterministic Planner process."""
from __future__ import annotations

import argparse
import base64
from contextlib import contextmanager
import hashlib
import http.client
import itertools
import json
from pathlib import Path
import selectors
import signal
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parent.parent
CONTRACT = ROOT / "contract"
STAMP = "2026-01-15T12:00:00Z"
sys.path.insert(0, str(ROOT))


def serve(database):
    from planning import dates, store, validation
    from planning.server import PlanningApp, ThreadingHTTPServer, make_handler
    counter = itertools.count(1)
    def new_id():
        return f"{next(counter):016x}"
    dates.new_id = store.new_id = validation.new_id = new_id
    store.utc_now = lambda: STAMP
    database = store.Store(database)
    server = ThreadingHTTPServer(("127.0.0.1", 0), None)
    handler = make_handler(PlanningApp(database, port=server.server_address[1], extra_hosts=("localhost",)))
    handler.log_message = lambda *args: None
    server.RequestHandlerClass = handler
    def stop(*_):
        raise KeyboardInterrupt
    signal.signal(signal.SIGTERM, stop)
    print(server.server_address[1], flush=True)
    try:
        server.serve_forever(poll_interval=0.05)
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
        database.close()


@contextmanager
def service():
    scratch = ROOT / "tests/.scratch"
    scratch.mkdir(exist_ok=True)
    previous_term = signal.getsignal(signal.SIGTERM)
    def cancel(*_):
        raise KeyboardInterrupt
    signal.signal(signal.SIGTERM, cancel)
    try:
        with tempfile.TemporaryDirectory(prefix="wire-", dir=scratch) as directory:
            process = subprocess.Popen([sys.executable, "-B", str(Path(__file__).resolve()),
                                        "--serve", str(Path(directory) / "store.sqlite3")],
                                       stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True)
            try:
                with selectors.DefaultSelector() as selector:
                    selector.register(process.stdout, selectors.EVENT_READ)
                    if not selector.select(timeout=10):
                        raise RuntimeError("Disposable service did not bind within ten seconds")
                    line = process.stdout.readline()
                    if not line.strip().isdigit():
                        raise RuntimeError(f"Disposable service exited before binding (code {process.poll()})")
                    port = int(line)
                yield port
            finally:
                process.terminate()
                try:
                    process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait(timeout=5)
                process.stdout.close()
    finally:
        signal.signal(signal.SIGTERM, previous_term)
        try:
            scratch.rmdir()
        except OSError:
            pass


def capture():
    exchanges = {}
    with service() as port:
        def call(name, method, path, body=None, request_id=None, status=200, raw=None):
            wire = raw if raw is not None else (json.dumps(body, separators=(",", ":"), ensure_ascii=True) if body is not None else "")
            headers = {"Host": "localhost", "Accept": "application/json"}
            if method != "GET":
                headers.update({"Content-Type": "application/json", "X-Planning-Request": "1"})
            if request_id is not None:
                headers["X-Request-Id"] = request_id
            connection = http.client.HTTPConnection("127.0.0.1", port, timeout=5)
            try:
                connection.request(method, path, body=wire.encode(), headers=headers)
                response = connection.getresponse()
                payload = json.loads(response.read())
                selected = {key: value for key, value in response.getheaders()
                            if key.lower() not in ("date", "server")}
                if response.status != status:
                    raise AssertionError(f"{name}: expected HTTP {status}, received {response.status}: {payload}")
                exchanges[name + ".json"] = {"schema": "hq.planner.exchange/v1",
                    "request": {"method": method, "path": path, "headers": headers, "body_utf8": wire},
                    "response": {"status": response.status, "headers": selected, "body": payload}}
                return payload
            finally:
                connection.close()

        call("01-version", "GET", "/api/version")
        call("02-state-empty", "GET", "/api/state")
        ref = json.loads((CONTRACT / "reference-vectors.json").read_text())["cases"][0]["expected"][0]
        creation = {"fields": {"title": "Contract example", "references": [ref], "dates": [
            {"id": "date001", "kind": "target", "precision": "quarter", "value": "2027-Q2"},
            {"id": "date002", "kind": "deadline", "precision": "day", "value": "2027-06-30"}]}}
        created = call("03-create", "POST", "/api/items", creation, "contract-create", 201)
        item = created["item"]
        path = "/api/items/" + item["id"]
        call("04-create-repeated", "POST", "/api/items", creation, "contract-create", 201)
        call("05-id-reuse", "POST", "/api/items", {"fields": {"title": "Different"}}, "contract-create", 422)
        call("06-get", "GET", path)
        call("07-patch", "PATCH", path, {"revision": 1, "patch": {"notes": "Synthetic note"}}, "contract-patch")
        call("08-revision-conflict", "PATCH", path, {"revision": 1, "patch": {"title": "Stale"}}, "contract-stale", 409)
        call("09-order-conflict", "POST", path + "/move", {"revision": 2, "status": "next", "after_id": "missing001"}, "contract-order", 409)
        call("10-move", "POST", path + "/move", {"revision": 2, "status": "next", "place": "top"}, "contract-move")
        call("11-archive", "POST", path + "/archive", {"revision": 3}, "contract-archive")
        call("12-restore", "POST", path + "/restore", {"revision": 4}, "contract-restore")
        call("13-reviewed", "POST", path + "/reviewed", {"revision": 5}, "contract-reviewed")
        call("14-settings", "PUT", "/api/settings", {"settings": {"week_start": "mon"}}, "contract-settings")
        call("15-batch-dry-run", "POST", "/api/items/batch", {"items": [{"title": "Batch A", "references": [ref]}], "dry_run": True}, "contract-dry")
        batch = {"items": [{"title": "Batch A", "references": [ref]}, {"title": "Batch B", "status": "next"}]}
        call("16-batch", "POST", "/api/items/batch", batch, "contract-batch", 201)
        call("17-field-validation", "POST", "/api/items", {"fields": {"title": "Invalid", "references": [{**ref, "url": ""}]}}, "contract-invalid", 400)
        call("18-import-validation", "POST", "/api/import/preview", {"data": {"format": "wrong", "version": 1}}, "contract-import", 422)
        original = exchanges["03-create.json"]["request"]["body_utf8"]
        replay = {"mode": "lookup", "request_id": "contract-create", "method": "POST", "path": "/api/items",
                  "body_b64": base64.b64encode(original.encode()).decode(), "sent_after_version": 0}
        call("19-replay-retained", "POST", "/api/requests/replay", replay)
        unseen = {**replay, "request_id": "contract-unseen"}
        call("20-replay-not-applied", "POST", "/api/requests/replay", unseen)
        call("21-replay-apply", "POST", "/api/requests/replay", {**unseen, "mode": "resend"})
        call("22-replay-apply-repeated", "POST", "/api/requests/replay", {**unseen, "mode": "resend"})
        indeterminate = {**unseen, "request_id": "contract-unknown"}
        del indeterminate["sent_after_version"]
        call("23-replay-indeterminate", "POST", "/api/requests/replay", indeterminate, status=409)
        call("24-history", "GET", path + "/history")
        call("25-state", "GET", "/api/state")
        call("26-version", "GET", "/api/version")
        call("27-export", "GET", "/api/export")
    return exchanges


def rendered(exchanges):
    return {name: json.dumps(data, indent=2, ensure_ascii=True) + "\n" for name, data in exchanges.items()}


def manifest(files):
    """SHA256SUMS text for reference vectors followed by exchanges in name order."""
    names = ["reference-vectors.json", *(f"exchanges/{name}" for name in sorted(files))]
    contents = {"reference-vectors.json": (CONTRACT / "reference-vectors.json").read_bytes(),
                **{f"exchanges/{name}": text.encode() for name, text in files.items()}}
    return "".join(f"{hashlib.sha256(contents[name]).hexdigest()}  {name}\n" for name in names)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--serve", metavar="DATABASE", help=argparse.SUPPRESS)
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    if args.serve:
        serve(args.serve)
        return 0
    def cancel(*_):
        raise KeyboardInterrupt
    signal.signal(signal.SIGTERM, cancel)
    output = rendered(capture())
    folder = CONTRACT / "exchanges"
    sums = CONTRACT / "SHA256SUMS"
    if args.check:
        actual = {path.name: path.read_text() for path in folder.glob("*.json")}
        if output != actual:
            for label, names in (("drifted", [n for n in output if n in actual and output[n] != actual[n]]),
                                 ("missing", [n for n in output if n not in actual]),
                                 ("unexpected", [n for n in actual if n not in output])):
                if names:
                    print(f"{label}: {', '.join(sorted(names))}", file=sys.stderr)
            print("Planner golden exchanges drifted; inspect the changes before regenerating.", file=sys.stderr)
            return 1
        if not sums.exists() or sums.read_text() != manifest(output):
            print("SHA256SUMS does not match the contract files.", file=sys.stderr)
            return 1
        print(f"Verified {len(output)} real HTTP exchanges and SHA256SUMS.")
    else:
        folder.mkdir(exist_ok=True)
        for stale in set(path.name for path in folder.glob("*.json")) - set(output):
            (folder / stale).unlink()
        for name, content in output.items():
            (folder / name).write_bytes(content.encode())
        sums.write_bytes(manifest(output).encode())
        print(f"Captured {len(output)} real HTTP exchanges and refreshed SHA256SUMS.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
