# HQ native Electron acceptance

This Linux/macOS runner drives the actual production Electron renderer through CDP and
Node's built-in WebSocket. It adds no npm dependency or root script. Node 22.18+
(or the campaign's Node 24) and the pinned Electron executable are prerequisites.
Linux also requires Xvfb, bubblewrap, user namespaces and fonts; see the macOS
section below for Darwin prerequisites. It never disables Chromium's sandbox.
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
`.t3/acceptance-scratch/`. On Linux, bubblewrap maps its temporary directory to `/tmp` for
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
head, dirty-source status, the existing entry-point hashes and a complete
compiled-build inventory. They do not certify
that an independently produced build corresponds to source: build immediately
before acceptance. Evidence is local and may contain paths; inspect and sanitize
before publishing. Tests intentionally use synthetic/default app content only.

## macOS (Darwin)

The same runner selects
`node_modules/electron/dist/Electron.app/Contents/MacOS/Electron` on Darwin.
Use an available native graphical session, Git for the synthetic Wiki corpus,
and a fresh macOS build of the exact candidate. Routine/selected/full scenarios also
require `python3` for the repository's stdlib-only Planner. The install/build and
check commands above are unchanged. Run `--checkpoint` before `--selected`.
Darwin source support alone does not establish native qualification.

Electron launches directly through the existing runtime's owned process group.
It retains the same environment filtering (inherited `HQ_*`, `NODE_OPTIONS` and
`ELECTRON_RUN_AS_NODE` are removed), owned HOME/profile and synthetic fixtures.
TMPDIR points to that invocation's `tmp` directory; DISPLAY is removed and no
Xvfb or bubblewrap process is started. Darwin provides no Linux PID/user namespace
or private `/tmp` mapping. Process-group cleanup covers children remaining in
those owned groups; it is not namespace containment or protection against a
descendant escaping its group. Chromium's sandbox remains enabled.

`cleanup.test.mjs` runs unchanged on Darwin, including success/failure, partial
startup, handled signals, socket closure, cleanup-error preservation and the
negative peer-survival assertion. It has no namespace-specific assertions or
platform skips and does not scan or terminate unrelated processes. Native
Darwin cleanup and scenario results remain unverified until executed there.
Reports retain the platform and the native-prerequisite containment limitation;
HQ-07 remains held and makes selected mode nonzero as described below. CDP
screenshots capture the renderer only, not native window chrome.

## Portable fixtures (B) and native journeys (N)

B is the portable fixture, report and cleanup group. It uses Node, Git and the
real stdlib Python Planner, but no Electron or display. Run it serially before N:

```sh
node --test --test-concurrency=1 tests/acceptance/build-inventory.test.mjs tests/acceptance/fixtures/fixtures.test.mjs tests/acceptance/fixtures/scenarios.test.mjs tests/acceptance/fixtures/host-gallery.test.mjs tests/acceptance/cleanup.test.mjs
```

`fixtures/http.mjs` supplies only fixed Work/Social shell reads on ephemeral
loopback listeners. Unknown routes and every mutation fail closed. It has no
mutation scripts, replay engine, persistent records or simulated Social saves.
The three tests of that removed protocol simulation were removed with it;
production codec/failure behavior remains covered by
`apps/desktop/electron/services.test.ts` and
`modules/work/live/test/transcript.test.ts`. B retains direct fixture isolation,
route denial, corpus identity, cleanup and peer-survival checks.

Routine, selected and full mode start the repository's real Python Planner with
an owned SQLite database. Its recording loopback proxy admits only state/version
reads, capture and explicit replay lookup routes. It forwards original request
bytes, loses one applied create response and records the explicit lookup. Oracle
reads go directly to Planner and do not inflate the app ledger. Planner and
Electron restart against the retained database/profile. Work has no durable
unresolved client intent here: RW-9/G-3 remain session-only. Checkpoint and
host-gallery-only modes need only the fixed shell reads. Social has no real
execution provider in any mode.

N is real Electron plus its preload and native state owners. After building the
exact candidate and taking fresh host admission, run the capped routine tier:

```sh
node tests/acceptance/run.mjs --routine
```

It has exactly four journeys, reusing implemented scenarios without reducing
their assertions:

| Journey | Direct oracle |
| --- | --- |
| HQ-01: launch, domain round trip, restart | Real renderer/preload isolation and CSP; appearance and selected domain survive graceful Electron restart |
| HQ-02: capture, uncertain write, explicit lookup | Real Planner item/version and request ledger prove one create despite response loss; navigation/read never resends |
| HQ-03: Work restart without replay | Real Planner database and renderer retain that item; no post-restart mutations |
| HQ-09: gallery enrollment and last good | Main-process persisted snapshot, exact HTTP hashes, restart without fetch, digest/parse/disconnect failures, removal without deleting corpus |

`routine-passed` means only those four journeys passed. Missing requested
capabilities, missing required rows, duplicate rows, any observed failure,
cleanup failure or changed build identity remain nonzero. There are no retries
to green. Routine mode does not create the local-folder fixture or execute the
held HQ-07 scenario. Its report still includes HQ-07 as held, HQ-09H as held
without an authorized distinct-host binding, and the full acceptance debt.
`--routine` rejects `--gallery-host`; use the existing explicit qualification
modes for that separately owned topology.

The five planning choices are not five implemented native journeys. Social
save/reference and Wiki committed-corpus/reference journeys still lack native
scenarios here. Mounting those domains or constructing a Wiki fixture does not
qualify them. HQ-09 exercises enrollment and last-good state, not a live preview.
HQ-07's displayed image and native chooser remain release obligations.

The original twelve reserved rows remain explicit manual/release obligations:
`work-service-replay`, `work-restart-without-intent`, `social-save-and-unknown`,
`reference-round-trips`, `wiki-committed-corpus`, `unavailable-service-ui`,
`import-export`, `capability-closure`, `preview-qualification`,
`component-containment`, `new-thread-qualification`, and
`integrated-scenario-catalog`. Full mode also requires the three source rows
HQ-07/09/09H. Only observed passes can discharge rows; gaps and holds never pass
full acceptance. `--selected` still executes HQ-07 and remains nonzero at its
held image edge. Neither capped routine success nor B success releases those
obligations.

The `HQ native journeys` workflow uses the existing Ubuntu/Node/build and
Xvfb/bubblewrap recipe, a 15-minute job budget and a five-minute N budget. It runs
nightly on the default branch **only after this workflow is promoted there**,
or by explicit dispatch, or on a non-draft same-repository PR carrying the
`hq-native-journeys` label. The PR checkout is the exact event merge SHA against
that PR's declared base, including integration child bases; there is no `main`
base filter or every-PR native job. A label retained on a PR requests a new run
on synchronization. No macOS job, privileged setup or sandbox bypass is added.
Missing Linux tools/user namespaces fail the requested run and need separate
runner provisioning; they are never converted to skips.

CI admits an estimated additional peak of 8 GiB plus a 2 GiB reserve on the
workspace filesystem before dependency, Electron and build allocation. This is
a conservative budget, not a measured performance claim. CI owns its unique
workspace install/cache scratch and removes that exact root
in an always-run cleanup step. The harness owns each runtime root and cleanup
as described above. The hosted runner owns the checkout, dependency/build trees
and residual state at job disposal. Native evidence is uploaded even on failure
with seven-day retention. An open PR proves neither scheduled activation nor a
qualified native run; report those separately.

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

After a fresh build and serial execution admission on the bound Linux or macOS host:

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

## Complete build identity for target evidence

The portable B group above includes `build-inventory.test.mjs`.
For the focused inner loop use:

```sh
node --test --test-concurrency=1 tests/acceptance/build-inventory.test.mjs
```

Each run retains `build-inventory.json`, a closed
`hq-electron-build/v1` object with `schema`, `roots` and `files`.
The fixed roots are `apps/desktop/dist` and `apps/desktop/dist-electron`.
Every regular file beneath both trees is included, together with
`apps/desktop/package.json` and `package.json`, so renderer assets and compiled
Design/Wiki/preview helpers participate in the identity. Each closed file entry
contains `path`, `bytes` and `sha256`. Entries are sorted by unique ASCII path;
components match `[A-Za-z0-9_][A-Za-z0-9_.-]*`, with a 512-character path bound.
Missing required index/main/preload/package files, symlinks (including
ancestors), unsafe paths and nonregular files fail closed. The inventory allows
at most 10,000 files and at most 512 MiB per file.

Final reports add `buildIdentity:{schema:"hq-electron-build/v1",sha256:"<digest>"}`.
The digest hashes canonical inventory JSON: recursively sorted object keys,
compact comma/colon separators, UTF-8, no trailing newline. The runner checks
the complete inventory and source HEAD again after cleanup before adding this
binding. A changed build or HEAD fails the run; source dirt observed at either
boundary stays recorded. Existing report schema, three-entry `build` hashes,
rows and mode-specific outcome meanings remain available.

The matching Frontend Development `target_evidence.py verify-t7` command takes
the exact final `report.json`, inventory and quiescent build tree. The target
record's artifact SHA is the canonical inventory digest; its harness report SHA
is the SHA-256 of the exact report bytes, including the newline. Combined stdout
logs and command receipts are not report files. Old reports without
`buildIdentity` cannot satisfy that command.

This identifies the complete compiled app payload and its package metadata.
It does not hash Electron/OS binaries, dependency installations, services,
fixtures or captures, nor prove source-to-build provenance. Build the exact
clean candidate immediately before native acceptance, retain its compiled
files, and keep them quiescent during both execution and verification.
A matching subset of T7 rows never upgrades overall T7 acceptance or HQ-07.
