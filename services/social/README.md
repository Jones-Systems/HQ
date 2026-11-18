# HQ Social service

An HQ-owned, clean-room implementation of the **Social workspace contract** that HQ's Social adapter
already speaks. It is not Fieldnotes and shares no code or data with it. It is a Python standard-library
HTTP service over SQLite, so HQ Social (drafts, brands, calendar, workbench runs, run history) can work
end to end against a real, disposable local backend. The workbench tools are HQ reference analyzers: pure,
deterministic and offline, working only on input you supply.

Live collection, posting and account connection do not exist here. Nothing is fetched from, or sent to, any
network or account. The service has no web UI; it is only the JSON interface below.

The contract is specified in
[HQ Social service contract v1](../../docs/engineering-specs/backend-assessment-social-20261103.md#hq-social-service-contract-v1-target).
Source availability does not install, deploy or connect anything; a running service is a separate operation.

## Run it

From the repository root, with a data directory **outside** the repository:

```bash
cd services/social
mkdir -p ~/hq-social-data
python3 -m social_service --data ~/hq-social-data --host 127.0.0.1 --port 8766
# Social service on http://127.0.0.1:8766/  (data: /home/you/hq-social-data)
```

Python 3.11 or newer, standard library only. It needs POSIX file locking and process groups (Linux or macOS).

| Option | Meaning |
| --- | --- |
| `--data DIR` | Required. Created with mode 0700 when its parent exists. Refused inside `services/social`; a warning inside the repository. One process per directory: a second one exits 2. |
| `--host` | Loopback only: `127.0.0.1` (default), `::1` or `localhost`. Anything else exits 2. |
| `--port` | Default 8766. `0` picks a free port; the ready line shows the real one. |
| `--allowed-host HOST[:PORT]` | Accept one more `Host` value, for a private HTTPS front the owner sets up separately. Repeatable. |
| `--publishing off` | Default; no publishing advertisement or routes. `simulator` opts into local simulated delivery only. |

The ready line is printed and flushed once the port is bound; IPv6 hosts are bracketed. `SIGINT` and `SIGTERM`
stop the service gracefully. A refused configuration exits 2 and a port in use exits 1.

## Data

The service owns everything in `--data`, and HQ stays a client that never stores Social records:

- `hq-social.sqlite3`: brands, drafts and run records. `PRAGMA user_version` with forward-only additive
  migrations; a store written by a newer service is refused.
- `runs/<id>/`: `input.json`, `worker.log` and `result.json` for each run.
- `hq-social.lock`: the exclusive lock.

Keep the directory and its backups out of the HQ repository. The service never opens a Fieldnotes database.

## Guards and features

On every request, in order: `Host` must be the bound `host:port`, a loopback alias or an `--allowed-host`
value (403 `Unrecognized host`); a present `Origin` must be `http(s)://` plus an accepted host (403
`Cross-origin request refused`); `Sec-Fetch-Site: cross-site` gets 403 `Cross-site request refused`. A `POST`
then needs the per-process `X-Workspace-Token` from `GET /api/workspace` (403 exactly `Reload the workspace
before saving`), `Content-Type: application/json`, no `Transfer-Encoding`, a `Content-Length` of 1–2,000,000
and a JSON object body. Other methods get 405. Every error is exactly `{"error": "<text>"}`.

`features` in the workspace snapshot lists `hq-editorial-timebox-v1` (only when the host resolves
`America/New_York`; without zone data any time slot is refused as `Unknown time zone`) and `hq-references-v1`.
Brand-to-project and supplied-source registry features are advertised after their additive storage migration. Publishing is advertised only with `--publishing simulator`; it has no network provider or credentials.

## Routes

| Route | Result |
| --- | --- |
| `GET /api/workspace` | `{brands, content, runs, tools, features, csrf}`. Brands by name (the built-in `default` always exists), content newest first, the latest 200 runs without output, the eight tools. |
| `POST /api/content` | Save a draft (201 new, 200 updated). A draft carries an optimistic `version`; a stale or unknown `id` is 409. Absent `links` or `planning_slot` keep what is stored (a kept slot is dropped if the new date no longer fits it); `[]` and `null` clear them. A repeated reference is refused. |
| `POST /api/brands` | `{name}` → `{id, name}` (201). |
| `GET /api/sample/<tool>` | The tool's fictional sample input; an unknown tool is 400. |
| `POST /api/runs` | `{tool, input, is_example}` → a queued run (201). With 8 queued or running, 409. |
| `GET /api/runs/<id>` | The run record, plus `output` once it finished with a result. |

Validation mirrors HQ's own rules (`modules/social/core`, `packages/contracts`): the same checks, in the
same order, with the same messages. Unknown fields are refused as `Unknown field: <key>`.

## Runs

Runs execute one at a time on a single worker thread, each in a fresh subprocess,
`python3 -m social_service.worker <run_dir>`, with a scrubbed environment, the run directory as working
directory, stdin from `/dev/null` and a 60 second timeout. The worker lowers its CPU, address-space and
file-size limits where the platform allows, denies sockets and process launch with an audit hook, then runs
the analyzer in `social_service/tools/`. A result over 1,500,000 bytes fails the run. Statuses move
`queued → running → succeeded | failed`; a restart marks unfinished runs `interrupted`, and nothing is retried.

## Tests

From this directory, after checking host capacity, one process at a time:

```bash
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s tests -t tests
PYTHONDONTWRITEBYTECODE=1 python3 -B contract/generate.py --check   # same drift check, outside unittest
```

The suite takes about 30 seconds. It covers validation parity (including the shared planning-slot cases), the
store, every guard and route over a real loopback server, run lifecycles with a test-only fake worker, the
worker's audit hook and limits, launching and signals, the lock and data-directory rules, persistence across
a restart, and the [golden contract exchanges](contract/README.md). All scratch lives in
`/tmp/hq-social-*` and is removed by each test; nothing is written inside the repository, and only loopback
is used.

Limits to know: there is no authentication beyond the per-process token and loopback binding, so this is a
single-owner local service. Data is not encrypted. A saved draft body is limited to 50,000 characters, but the
workspace snapshot has no overall size cap, and HQ's desktop transport caps a response at 2,000,000 bytes.


The extension source follows `spec.hq-social-backend#iface.extensions.001`. Sources retain parsed content,
exact-byte SHA-256 provenance and run associations; snapshots return metadata only. Schema v2 is additive.
Simulator approval snapshots the draft version and canonical UTF-8 JSON (sorted keys, no whitespace) of
`{channel,title,body}`. It records a non-replayable failed state before outbox I/O, allocates a durable
sequence (gaps are possible), syncs the outbox and directory, and then records a simulated receipt.
A lost response or I/O failure must be reconciled from the request and local outbox; never automatically
resubmit approval. Real provider decisions and desktop enablement remain separate holds.

This recovery checkpoint is source only. Golden baseline exchange fields and hashes were updated
statically for the additive wire shape; they are expected artifacts, not newly captured HTTP evidence.
The serial verifier must run contract recapture/check, full Python discovery and client conformance.
