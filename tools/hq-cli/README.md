# HQ CLI

A standalone, dependency-free CLI for agents calling a configured Planner service.
It implements discovery, Planner reads, guarded writes, atomic or explicitly
sequential creation batches, and retention-aware recovery of uncertain writes.
Design, Social, HQ Work fixtures, Wiki and inspiration report an unavailable or
unexposed state with a reason. Planning dates never launch work.

Use Node **22.18 or newer** (native TypeScript stripping):

```sh
tools/hq-cli/bin/hq commands
tools/hq-cli/bin/hq capabilities
tools/hq-cli/bin/hq schema planner.items.create_batch
```

`capabilities` reports Planner as `unconfigured` without making a request unless
`HQ_PLANNER_URL` or `--planner-url` supplies an origin. Explicit flags take
precedence. HTTPS is accepted; plain HTTP requires loopback. Credentials,
URL paths, query strings, fragments and redirects are refused. Requests have a
10-second timeout (`--timeout-ms 1..60000`) and an 8 MiB response limit. Request
bodies are limited to 256 KiB; replay envelopes to 352 KiB. No credentials,
local database, cache or configuration files are maintained.

Examples below use `hq` on PATH, which requires a separately owner-installed
symlink to this checkout's `bin/hq`. The launcher follows symlinks. Do not install
under `node_modules`: native Node does not strip TypeScript there. No package
installation or build step is needed for this standalone CLI. Installation,
service deployment and global activation are separate operations.

## Discover and read

```sh
hq --planner-url https://planner.example planner status
hq planner now --days 14
hq planner boards
hq planner items list --status next --area Work --archive active
hq planner items list --date-kind target --from 2026-11-01 --to 2026-11-30
hq planner items get item0001
hq planner items history item0001
hq planner settings get
```

Planner is exactly `planner:main` with seven fixed columns. Areas are metadata,
not extra boards. Board counts distinguish active (unarchived) and archived items.
List defaults to `--archive active`; `archived` and `all` are explicit alternatives.
Filters combine status, area, kind and horizon with an optional date-kind/window.
A date filter matches **any one qualifying date**, using inclusive period overlap.
A month, week, quarter or year may overlap a day window without becoming a specific
task date. Every original date and its precision remains in output. Filter windows
require valid `YYYY-MM-DD` dates from 1900 through 2200.

`planner now` uses Planner's `settings.default_tz`, never the host timezone. It
returns today, tomorrow, and full weekday mappings for 14 calendar days including
today (`--days 1..31`). Use this mapping to interpret weekday requests.

## Write

```sh
hq planner items create --title 'Synthetic task' --planned today --due 2026-11-06
hq planner items update item0001 --revision 3 --title 'Updated task'
hq planner items move item0001 --revision 4 --status next --place top
hq planner items archive item0001 --revision 5
hq planner items restore item0001 --revision 6
hq planner items reviewed item0001 --revision 7
hq planner settings set --week-start mon --stale-days 30
```

Item changes require the explicit revision from a read. Create/update accept
metadata flags or `--fields-file F` containing an editable-fields JSON object.
A field cannot be supplied both ways. Use the file for explicit null values and
replacement arrays (`dates`, `next_steps`, `references`); an empty dates array
clears dates. The schemas returned by discovery describe these files.

`--planned D` means **target** as the CLI's visible default. `--due D` means
**deadline**, independently. Repeat `--date kind:value[@HH:MM[-HH:MM]][~TZ]` for
other dates. Kinds are `target`, `deadline`, `start`, `event`; values preserve
precision: `2026-11-06`, `2026-W45`, `2026-11`, `2026-Q4`, `2026`.

Only `today`, `tomorrow` and `+Nd` are relative. They resolve once using Planner's
`settings.default_tz` or explicit `--tz`. Output echoes input, resolved value,
timezone and today; frozen values go into the request bytes. Weekday names are
rejected with a pointer to `planner now`. Wall times require day precision and a
valid timezone; nonexistent daylight-saving times and reversed ranges are rejected.

## Batch and resume

A `--spec-file` contains:

```json
{
  "schema": "hq.planner.batch-create/v1",
  "board": "planner:main",
  "items": [
    {"client_key": "first", "title": "Synthetic task", "dates": [{"kind": "target", "value": "today"}]}
  ]
}
```

```sh
hq planner items create-batch --spec-file batch.json --dry-run
hq planner items create-batch --spec-file batch.json --request-id request-1234
hq planner items create-batch --spec-file batch.json --mode sequential --intent-file progress.json
hq planner items create-batch --resume-from progress.json
```

Batches contain 1..50 items. Atomic is the default and requires advertised
`items.batch_create`: server dry-run validates all items, then one commit creates
them in input order. `client_key` is caller metadata and is not sent as an item
field. Atomic `--dry-run` sends only the server validation request.

`--mode sequential` is explicit, works on old services, and stops at the first
non-success. Its dry run is labeled `client_shape_only` and sends no mutation.
Per-item request IDs are `<base>-<index>`, so the base is limited to 60 characters.
Spec files are limited to 4 MiB; replay/prior-result files to 32 MiB to accommodate
frozen specs, per-item receipts and exact bytes together. Results record `created`, `replayed`, `failed`, `unknown`, or `not_attempted` for
every item, along with the frozen spec, original endpoint, ID and observed version.

Resume **only from a prior result**, never by rerunning the raw spec. Completed
items are skipped using their recorded IDs even if server replay records expired.
New services reconcile remaining items through the replay route and stop on
indeterminate retention. Old services can continue only never-attempted items;
an unknown create requires readback, and a known rejected item needs an edited
spec and a new run containing only unfinished work. Resume refuses a changed
endpoint, new request ID, changed frozen replay bytes or re-resolution of dates.

## Uncertain outcomes and caller-owned intent files

Every write reads the service version first. If that fails, no write is sent.
There are no automatic retries. Results include the request ID and an
`hq.planner.replay/v1` document with the exact original bytes as `body_b64`,
method/path, observed version, endpoint and creation time. Save the result.

```sh
hq planner replay --request-file prior-result.json --check
hq planner replay --request-file prior-result.json
```

The replay command accepts either a replay document or a CLI result containing
one. An endpoint override must match its bound endpoint. With `requests.replay`,
`--check` performs lookup only; the default atomically asks the server to replay
or apply only when retention proves that the request was not applied. Lookup is
not permission to send separately: the resend route performs the check and apply
under the server's single-process lock.

On **exit 7**, use `planner replay`; **never retry under a new ID**. If retention
is indeterminate, read back and ask before another change. Inspect item titles
and `updated_at` in `items list`, read individual items, or use `settings get`.
Old services permit exact replay only for revision-guarded item changes. A
revision conflict includes `current` and a “possibly already applied” note.
Create/batch/settings replay and `--check` on an old service return
`replay_unsupported` without sending a mutation.

Optional `--intent-file PATH` atomically writes a document before sending and
updates it with the result. Sequential progress marks the next item unknown
**before** each send, then records its outcome. This preserves uncertainty if the
process is interrupted. The caller owns the final path and retention. Temporary
files are unique siblings, mode 0600, and removed on success, failure and handled
SIGINT/SIGTERM. An intent-file failure before sending prevents that send; a failure
to persist a known outcome is reported in the result, which the caller must save.

## Machine contract and verification

Every invocation writes exactly one `hq.cli.result/v1` JSON document to stdout,
including help and errors. `command` is a stable ID. `effect` is `none`, `applied`,
`replayed`, `unknown` or `partial`. Exit codes are 0 success/replayed, 1 internal
failure, 2 local usage/schema error, 3 service validation rejection, 4 conflict,
5 not found, 6 unavailable/no new write, 7 uncertain original/write outcome, and
8 sequential partial success. Per-item statuses explain batch progress. A read
timeout has effect `none`. Parse stdout and the exit code; stderr is not required.

`hq schema [command-id]` describes normalized inputs, input-file schemas and
complete result envelopes. Map underscore properties to hyphenated flags;
`item_id` and `command_id` are positional. `--dry-run` and `--check` are boolean
switches; `--date` can repeat. Unknown options and duplicate scalar flags are
rejected. History's `detail` is service-owned JSON because imports permit arbitrary
detail objects; other output structures have closed properties. Additive backend
fields outside the declared contract are omitted. `hq --help` returns JSON.

From `tools/hq-cli`, run:

```sh
node --test --test-concurrency=1 'test/**/*.test.mjs'
```

The `hq-cli-t2` and `hq-cli-t3` groups are recorded in `test/manifest.json`.
Unit tests inject fetch/time and open no sockets. File fixtures use unique trees
below `test/` and creating-test teardown; intent-file tests cover atomic visibility
and cleanup. These source checks do not prove installed behavior, live-service
compatibility, root workspace CI or deployment. Real-service E2E and the dedicated
agent guide are a separate delivery stage.
