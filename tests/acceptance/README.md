# HQ native Electron acceptance

This Linux runner drives the actual production Electron renderer through CDP and
Node's built-in WebSocket. It adds no npm dependency or root script. Node 22.18+
(or the campaign's Node 24), the pinned Electron executable, Xvfb, bubblewrap,
user namespaces and fonts are prerequisites. It never disables Chromium's sandbox.
The app's preload, context isolation, security policy and production layout remain intact.

After CPU admission, install/build in this isolated checkout:

```sh
npm ci
node node_modules/electron/install.js
npm run build
```

The explicit Electron installer is needed when the package has not downloaded its
binary. Set `electron_config_cache` (the installer’s case-sensitive cache variable),
`npm_config_cache` and `TMPDIR` to owned workspace scratch directories and
clean those exact directories when done; do not use shared runtime/build artifacts.
Then take fresh CPU admission before each separate check command:

```sh
node --test tests/acceptance/cleanup.test.mjs
node tests/acceptance/run.mjs --checkpoint
```

Checkpoint mode qualifies only the available shell: actual Electron/preload,
isolated renderer globals, CSP presence, all mounted domains, and persisted
appearance/navigation across a graceful process restart. Wiki absence is recorded.
It is **not** full `hq-electron-acceptance` or final application acceptance.

```sh
node tests/acceptance/run.mjs
```

Full mode returns nonzero while integration gaps remain. It includes the selected
Work and source scenarios below, with every other reserved row still explicit.
Reference round trips and other unimplemented journeys remain gaps. A missing
binary/display/namespace capability also fails.
Final acceptance requires T1's exact assembled candidate and a fresh build.

Each invocation allocates a unique profile and temporary root under
`.t3/acceptance-scratch/`. Bubblewrap maps its temporary directory to `/tmp` for
Xvfb and Electron and provides private PID/user namespaces and device nodes. The
checkout is then bound back at its own path, so a checkout under `/tmp` still
works. CDP
uses an ephemeral loopback port. All inherited `HQ_*` configuration is removed and only the owned profile path
is generated; this runner must never contact owner-configured services. It does not inspect
installation/authentication state.

Success, failure, SIGINT and SIGTERM close owned process groups and delete only
that invocation's root. The cleanup test covers those lifecycle paths and verifies
that a concurrent invocation survives another's cleanup. SIGKILL or host loss
cannot execute cleanup; a surviving exact run directory requires explicit recovery.

Reports, bounded runtime diagnostics and screenshots remain in a unique directory
under `.t3/acceptance-evidence/`, outside disposable scratch. Reports include Git
head, dirty-source status and hashes of the built entry points. They do not certify
that an independently produced build corresponds to source: build immediately
before acceptance. Evidence is local and may contain paths; inspect and sanitize
before publishing. Tests intentionally use synthetic/default app content only.

## Infrastructure fixtures and row evidence

Run the Node-only affected group before any native check:

```sh
node --test --test-concurrency=1 tests/acceptance/fixtures/fixtures.test.mjs tests/acceptance/fixtures/scenarios.test.mjs tests/acceptance/fixtures/host-gallery.test.mjs tests/acceptance/cleanup.test.mjs
```

`fixtures/http.mjs` supplies scripted Work/Social HTTP exchanges on ephemeral
loopback listeners. Unscripted mutations fail explicitly; this is not a general
Planner or Social implementation. Scripts use only the landed main-process closed
routes and native response bodies. The self-test reads the checked-in Planner
contract exchanges as data and calls the landed main-process encoders; it imports
no module source or tests. Each request records method, path, canonical JSON body,
request ID (null for routes without one), and sequential count. Lost responses,
malformed JSON and unavailable reads exercise the real HTTP codec. HTTP 5xx remain
received transport responses, with adapter interpretation still owned by the app.

The checkpoint's scripted Work records persist under the owned scratch root.
Selected/full mode instead starts the repository's real Python Planner with a
fresh SQLite database. Its recording loopback proxy forwards the app's original
bytes, loses one applied create response, and records the explicit lookup. Oracle
reads go directly to Planner and do not inflate the app ledger. Planner and
Electron restart against the retained database/profile. This provides no durable
unresolved client intent: RW-9/G-3 remain session-only. Social scripts do not
simulate a real execution provider.

The runner writes its own `service-config.json` and `wiki/config.json` to the
owned profile, then passes only harness-generated `HQ_USER_DATA_DIR` after
stripping every inherited `HQ_*`. No qualification flags are allowed. Wiki uses
local bare Git repositories built from the checked-in synthetic corpus with
isolated Git configuration and fixed synthetic identities. The exact inert
`https://example.invalid/synthetic/wiki.git` origin metadata and matching
`expectedRemote` are permitted for the reader's provenance validation; no remote
is contacted and no fetch, push or clone is performed.

Every report contains rows with `pass`, `fail`, `gap`, `held` or `unmeasured`,
prerequisite statuses and evidence. A pass requires observed evidence and passing
prerequisites. Shell checks are separate from the reserved integration/qualification
rows. The integrated scenario catalog remains a gap beyond the selected scenarios;
these reserved rows do not claim an exhaustive final acceptance catalog.
Full mode cannot pass with missing, held or unimplemented
rows. Checkpoint's existing limited success semantics remain unchanged.

Runtime ownership includes HTTP servers and their accepted sockets, CDP sockets,
process groups, profiles and all corpus/export scratch trees beneath the unique
run root. Bounded report/log evidence is saved outside scratch before teardown.
Cleanup attempts every registered resource even after an earlier cleanup fails;
cleanup failure fails the run and preserves any original error. The lifecycle
tests cover success, deliberate failure, partial child startup, both handled
signals, an open HTTP socket, concurrent peers and injected cleanup failure.

## Selected T7 scenarios

After a fresh build and serial execution admission on the bound Linux host:

```sh
node tests/acceptance/run.mjs --selected
```

This runs the existing shell baseline (HQ-01) and HQ-02/03/07/09. Reports replace
rows by ID, never append a passing duplicate beside an old GAP. `--selected`
evaluates only that named subset plus shell prerequisites; it cannot confer full
acceptance. It currently remains nonzero because HQ-07 has the held image edge
below. `--checkpoint` retains its limited shell-only success semantics and does
not launch Planner or the new source fixtures. Native evidence is retained outside tracked source; the scoped qualification
record is in `docs/evidence/hq-integration/acceptance/t7-scenarios-source.md`.
Historical checkpoint JSON files remain historical.

| Scenario / result row | Action and direct oracle | Boundary |
| --- | --- | --- |
| HQ-02 / `work-service-replay` | UI Capture; real Planner commits one item/version; first applied response lost; Unconfirmed changes; navigation/read emits no POST; Check now sends one lookup, never a second create | Native UI plus real local Planner; proxy substitutes response loss only |
| HQ-03 / `work-restart-without-intent` | Graceful Electron shutdown; retained Planner DB process restart; app relaunch; same item/version and zero post-restart non-GET requests | Confirmed item persistence, no unresolved-intent durability claim |
| HQ-07 / `local-folder-source` | Preseeded selected local root; UI refresh shows exact eligible children; real preview bytes/digest; symlink/escape/bad-byte exclusions; generation and cached entries retained across restart/failure | Native chooser untested; displayed preview image **held** |
| HQ-09 / `remote-gallery-source` | UI enrollment; main fetches manifest/index/collection with matching wire SHA-256; persisted source identity/snapshot survives restart; bad digest, malformed manifest and stopped server retain stale last good; remove enrollment preserves corpus files | Same-host loopback only; no live preview launch |
| HQ-09H / `remote-gallery-distinct-host` | Explicit host binding; UI enrollment through owned SSH forwards; remote ledger/disk hashes; restart without fetch; digest/parse/disconnect failures retain last good; removal, restore and restart keep enrollment absent | Real separate HTTP host; held when no binding is supplied; no live preview launch |

HQ-07's exact held seam is
`modules/design/app/compose/bridged-workspace.ts`: the production
`thumbnails.readThumbnail` implementation always throws “Thumbnail storage is
unavailable”. The harness verifies `catalog.preview` through the real preload,
but that is not a rendered image. A production-owner change/binding is required
before this entire accepted scenario can pass. No contract, IPC or product code
is changed here. Invalid preview bytes exclude previews, not their otherwise
eligible parent folders.

Each scenario saves first-failure evidence and bounded timings; independent
scenarios can continue, but none is retried to green. Reports preserve ledgers,
Planner child identities, screenshots, build entry hashes and cleanup readback
outside scratch. These hashes identify the build files; root must still bind the
fresh build to the exact candidate. Cold/warm qualification, resource sampling
and the accepted one-cold/five-warm first-attempt repeatability runs remain the
native qualification owner's responsibility.

## Portable gallery corpus for HQ-09H

The corpus uses relative URLs, fixed synthetic content and a SHA-256 manifest.
An operator can export it beneath an already owned scratch parent; the named
child must not exist:

```sh
node tests/acceptance/fixtures/remote-gallery.mjs --write-corpus "$owned_run_root/gallery"
```

This exporter creates files only. `fixtures/host-gallery.mjs --serve
<owned-scratch-parent> <new-report-file>` reuses that corpus on a separate Linux
host, listens only on loopback, and reports its hostname, PID/PGID, random run ID,
HTTP origin and control origin. Its separate synthetic control listener exposes
remote disk digests, a request ledger and fault modes. The caller must own both
listeners and keep them on loopback behind its forwards. Closing the controller's
stdin or sending SIGINT/SIGTERM preserves the remote report and removes the exact
new scratch tree. A 120-second lifetime bound fails closed.

After the two hosts, SSH route and task scratch are explicitly authorized, the
following command runs only SSH orchestration on its invoking machine. The app,
telemetry and all native checks run on the app host. It transfers only the three
fixture modules into new external scratch, without touching the app checkout:

```sh
python3 tests/acceptance/qualify-host-gallery.py \
  --app-host <ssh-app-alias> --fixture-host <ssh-fixture-alias> \
  --app-repo <bound-non-main-worktree> --node <pinned-node-executable> \
  --owned-root <new-absolute-directory-with-existing-parent-on-both-hosts> \
  --telemetry <app-host-collect_work_capacity.py> --runs 4
```

This relay route is useful when the app host cannot authenticate directly to the
fixture host. No credentials are copied. The relay owns local SSH children and
remote control processes, captures PID/PGID, uses ephemeral loopback ports,
compares all acceptance `.mjs` hashes and HEAD before each native invocation,
and takes fresh same-host admission before starting one serial app process.
An occupied forward port or first failure ends that attempt; no retry or timeout
extension hides it. `--runs 1` selects a single initial qualification. Evidence is
saved under `<owned-root>/evidence` on both hosts; only its exact `work` child is
removed. Host loss/SIGKILL still require explicit recovery, as above.

For an already owned fixture/forward, pass an explicit binding to the existing
runner. It includes `schema: "hq-gallery-forward/v1"`, the fixture's `host`,
`runId`, `pid`, `pgid`, and app-host loopback `origin` and `controlOrigin`.
The adapter rejects its own hostname and validates remote identity/disk hashes
on every control read. The invoking operator owns forward/server teardown:

```sh
node tests/acceptance/run.mjs --gallery-only --gallery-host <binding.json>
node tests/acceptance/run.mjs --selected --gallery-host <binding.json>
```

`--gallery-only` reports only shell/HQ-09H success, preserving other rows as
unmeasured/gaps. With `--selected`, HQ-09H is additionally required, and HQ-07's
held displayed-image edge still makes the overall command nonzero. Full mode
continues to require every reserved row. Removal checks inactive persisted
enrollment, rather than deletion of HQ's retained registry tombstone. Reports
retain the remote ledger/digests before and after removal/restoration, and
screenshots show enrolled, stale and removed Settings states. Restarts are actual
Electron process restarts; cached and removed enrollments must not fetch again.

This is synthetic HTTP through SSH forwarding, not remote TLS, SSH filesystem,
provider authentication, native folder chooser, live preview, installed-app or
production-source qualification. It does not replace the campaign's larger cold/
warm portfolio or root's independent integrated-candidate exercise.
