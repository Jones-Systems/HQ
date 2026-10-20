# HQ CLI

A standalone, dependency-free CLI for agents calling a configured Planner service.
This source implements discovery and read commands. Mutations, batches and replay
are not exposed by this checkpoint. Design, Social, HQ Work fixtures, Wiki and
inspiration report their unavailable or unexposed state with a reason.

Use Node **22.18 or newer** (native TypeScript stripping):

```sh
tools/hq-cli/bin/hq commands
tools/hq-cli/bin/hq capabilities
tools/hq-cli/bin/hq schema planner.items.list
```

`capabilities` reports Planner as `unconfigured` without making a request unless
`HQ_PLANNER_URL` or `--planner-url` supplies an origin. Explicit flags take
precedence. HTTPS is accepted; plain HTTP requires loopback. Credentials,
URL paths, query strings, fragments and redirects are refused. Each read has a
10-second timeout (`--timeout-ms 1..60000`) and an 8 MiB response limit. No
credentials, local database, cache or configuration files are maintained.

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

These examples require an explicitly configured service, except discovery.
`hq` on PATH means an owner-installed symlink to this checkout's `bin/hq`;
installation is separate. The launcher follows symlinks. Do not install under
`node_modules`: native Node does not strip TypeScript there. There are no package
installation or build steps for this standalone CLI.

Every invocation writes exactly one `hq.cli.result/v1` JSON document to stdout,
including help and errors. `command` is a stable ID. Reads always have
`effect:"none"`; read timeouts do not imply a write occurred. Exit codes used here
are 0 success, 1 internal failure, 2 local usage/schema error, 3 service validation
rejection, 5 not found and 6 unavailable. Codes 4, 7 and 8 are reserved for future
conflict, unknown-write and partial-write results. Parse stdout and the exit code;
stderr is not part of the contract.

`hq schema [command-id]` describes normalized inputs and complete result envelopes.
Map underscore input properties to hyphenated flags; `item_id` and `command_id`
are positional. Unknown options, duplicates and invalid values are rejected.
`hq --help` returns the implemented command list as JSON. History's `detail` is
service-owned JSON because Planner imports permit arbitrary detail objects;
other output structures have closed properties. Additive backend fields outside
the declared read contract are omitted.

Planner is exactly `planner:main` with seven fixed columns. Areas are metadata,
not extra boards. Board counts distinguish active (unarchived) and archived items.
List defaults to `--archive active`; `archived` and `all` are explicit alternatives.
Filters combine status, area, kind and horizon with an optional date-kind/window.
A date filter matches **any one qualifying date**, using inclusive period overlap:
a month, week, quarter or year can overlap a day window without being converted
to a specific task date. Every original date and its precision remains in output.
Filter windows require valid `YYYY-MM-DD` dates from 1900 through 2200.

`planner now` uses Planner's `settings.default_tz`, never the host timezone. It
returns today, tomorrow, and full weekday mappings for 14 calendar days including
today (`--days 1..31`). Use this mapping to interpret weekday requests. Planning
dates do not launch work or schedule execution.

Run the bounded standalone checks from `tools/hq-cli`:

```sh
node --test --test-concurrency=1 'test/**/*.test.mjs'
```

The `hq-cli-t2` group and exact modules are recorded in `test/manifest.json`.
Unit tests inject fetch and time and open no sockets. The launcher check uses a
unique directory below `test/` and removes it in `finally`. These checks do not
prove deployment, installation, live-service compatibility or HQ root CI.
