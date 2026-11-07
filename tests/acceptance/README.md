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
under `.t3/acceptance-evidence/`, outside disposable scratch. Before creating either
evidence or scratch parents, `evidence-runner.mjs` checks the actual receiving
filesystems through Stage A admission. Unknown or insufficient capacity refuses
without starting the runtime. The standalone writer then accounts existing retained
evidence, acquires its own matching parent lock and preallocates closure diagnostics
before accepting artifacts; do not nest this runner inside a Stage A locked invocation.

Runner-owned inventory, screenshot, report and log disk writes now use
`evidence.mjs`: provisional limits are 128 MiB/run (120 MiB ordinary plus 8 MiB
preallocated closure), 32 MiB/artifact, 256 artifacts and 8 pending writes. Parent
retention is prospectively limited to 2 GiB/16 runs, with the existing 30 GiB
reserve plus 10 GiB additional-peak admission on each receiving filesystem. These
are unmeasured ceilings, not measured peaks. Excess retained evidence refuses;
there is no historical overwrite, eviction, deletion or stale-lock recovery.

`report-before-cleanup.json` and immutable `runtime-before-cleanup.log` precede
teardown. `runtime.log` and `report.json` are each written once afterward. Evidence
refusal, serialization failure and cancellation still visit runtime cleanup and the
existing post-cleanup service/build/source oracles. Accepted writes drain before
writer close. A failed evidence operation makes an otherwise successful invocation
incomplete/nonzero; an original harness failure or observed SIGINT/SIGTERM remains
primary. The padded `.closure.json` is the final writer result: an absent, torn,
failed or incomplete closure is never a passing evidence bundle, even if an earlier
report says pass. A late close/unlock error may be present only in that closure or
stdout. Retained failed/cancelled/incomplete runs stay labelled, never swept here.

This bounds only writes owned by this runner. CDP in-memory responses, stdout,
fixture/internal writes, scratch occupancy after admission, raw traces and other
producers remain uncovered. The separately bounded preview entry points are
described below. It is no global quota, memory bound, sandbox,
full Stage B coverage or native-acceptance claim. `evidence-runner.test.mjs` exercises
the actual adapter with small synthetic artifacts and fake cleanup/oracle ports;
it does not start Electron or a native journey. Reports include Git
head, dirty-source status, the existing entry-point hashes and a complete
compiled-build inventory. They do not certify
that an independently produced build corresponds to source: build immediately
before acceptance. Evidence is local and may contain paths; inspect and sanitize
before publishing. Tests intentionally use synthetic/default app content only.

## Preview evidence routing and storage holds

`preview/run.mjs` and `preview/packaged.mjs` consume the qualified root writer
through the thin streaming adapter `preview/evidence.mjs`. Their existing explicit
absolute `--evidence` path stays outside the repository. Both receiving filesystems
and path custody are checked before creating any evidence or runtime/profile parent;
evidence and scratch must be disjoint. The native runner's disposable runtime
parent is now worktree-local `.t3/preview-acceptance-scratch/`; the packaged runner
keeps its explicit `--profile-parent`. The unchanged runtime owns and removes only
its unique child, never either parent or retained evidence.

A unique retained run holds a standalone matching parent lock and a real
preallocated closure before accepting artifacts. Preview reports/screenshots and
immediate event, row and stderr appends use the same provisional byte, artifact,
pending-write, retention and capacity limits stated above. There is no adapter
promise queue that postpones admission. Refusal latches failure and stops only the
affected already-owned producer through the runtime's stop port. Accepted writes
drain; window restoration, runtime close, exact root/process-group absence checks
and existing source/hash readbacks still run. Original failures or observed
cancellation remain primary; expected child termination during teardown is not a
new producer failure. Otherwise successful runs with refused required evidence are
incomplete/nonzero. Immutable before/after-cleanup reports and the padded closure
retain diagnostics; a late closure failure may be visible only in closure/stdout.
No historical overwrite, eviction, deletion, stale-lock recovery or launcher nesting
is supported.

Q-PV4's existing held-capture containment row is explicitly **storage-held and
unmeasured** before `contentTracing.startRecording` could start an unbounded raw
file spill. The result stays incomplete/nonzero. Its containment assertions and
helper are unchanged; this is an execution refusal, never a passed, waived,
retired or weakened criterion. Full trace containment remains unfinished until a
separately allocated actually bounded producer/sink is qualified. There is no
start-then-truncate, compressed-copy substitution or alternative oracle.

CDP memory responses, stdout, fixture-internal and TLS scratch writes, scratch
occupancy after admission and other producers remain uncovered. These cooperating
writer limits are not a global disk/memory quota, sandbox, measured peak, full
Stage B coverage or native/package/live acceptance. `preview/evidence.test.mjs`
uses tiny synthetic fixtures and fake producer/cleanup ports; it starts no
Electron, CDP, native process or raw trace. Evidence bundles still require private
handling and sanitization before publication.

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
their assertions. Work must have zero mutation attempts before intentional capture, and Social must have zero mutation attempts throughout teardown. Rejected writes still fail qualification; raw ledgers remain evidence:

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

This exporter creates files only. The host fixture now uses
`fixtures/host-gallery.mjs --serve <owned-scratch-parent>
<existing-evidence-parent>`. Before `createRuntime`, its evidence adapter inspects
the actual receiving filesystem and custody through Stage A, requires capacity,
and opens one standalone unique retained run with a real preallocated closure.
The evidence parent must already exist and be disjoint from scratch. The fixture
keeps its loopback-only gallery/control listeners, ledger/digest assertions,
120-second lifetime and signal/EOF cleanup. After cleanup and writer close it
announces `hq-gallery-closed/v1` facts naming the actual immutable `report.json`
and `.closure.json`, their byte lengths and SHA-256 hashes. Consumers validate
those facts and identities; there is no fallback to a caller-selected report.
A closed fact is data, never write authority. The Node closure retains the
unchanged Stage A reservation; the separate Python closure described below is
64 KiB.

The cross-host qualifier requires **already-present, pinned non-main checkouts**
on both receivers and the invoking machine. A bounded external startup document
on stdin supplies `qualification`, `manifest`, `fixtureRepo`,
`fixtureEvidenceParent`, `relayEvidenceParent`, `localRepo`, `localNode`, and
`localScratchParent`. The manifest has schema `hq-gallery-source/v1`, exact
candidate `head`, and `files`, mapping every `.mjs`/`.py` beneath
`tests/acceptance` and `tools/storage` to its exact SHA-256. It is immutable input
outside that source closure, not a tracked generated file or a permission token.
Each receiver validates the complete repository-relative graph and source HEAD
before allocation and again for each attempt. Missing/stale layouts, an
incomplete graph, unsafe paths or unknown capacity refuse before parent creation
or runtime startup. This slice performs **no source staging, copy, bootstrap,
provisioning or checkout repair**.

The two existing evidence parents, the existing explicitly owned **local witness
parent**, and new exact scratch must be disjoint. No evidence parent is created.
After those prerequisites and actual local admission, the outer qualifier
exclusively preallocates a 64 KiB terminal slot under `--witness-parent` before
any native execution. That slot precharges one ordinary file and 64 KiB of the
same qualification's limits, with no refund. The Python receiver independently
owns its own parent lock/run/closure in its own process; it never borrows or
serializes the Node writer's lock. All observations remain subject to unchanged
Stage A per-host policy. A remote admission observation does not reserve local
capacity.

Only after the host routes, native run and exact scratch are separately
authorized may the existing qualifier execute:

```sh
python3 tests/acceptance/qualify-host-gallery.py \
  --app-host <ssh-app-alias> --fixture-host <ssh-fixture-alias> \
  --app-repo <pinned-non-main-checkout> --node <pinned-node-executable> \
  --owned-root <new-absolute-scratch-with-existing-owned-parent-on-both-hosts> \
  --witness-parent <existing-owned-local-parent> \
  --telemetry <app-host-collect_work_capacity.py> --runs 4 \
  < qualified-startup.json
```

The native command, per-attempt deadline, first-failure stop and build-consistency
checks remain the same. `--runs 1` selects one attempt; at most four execute.
The existing app receiver is launched once, without forwarding options, through
the existing SSH `start` route. It retains evidence ownership through the finite
attempt loop and report finalization. The separate fixture, tunnel and relay
remain captured cleanup subjects. Continuing stdin carries only predetermined
sequenced/hash-bound evidence slots and a finalization manifest, with bounded
acknowledgements; it cannot select commands, signal targets, remove paths,
launch attempts or transport lock authority.

The actual native `Popen` starts with `stdout=PIPE` and merged stderr before any
disk sink. The sink reads and writes incrementally: 8 MiB combined native output
per attempt, 64 KiB chunks/control-line buffers, 1 MiB JSON documents, and one
synchronous pending sink write. There is no spill-then-truncate/compress or final
whole-log read. Segmented protocol frames are at most 64 KiB and each assembled
document remains at most 1 MiB. Relay ordinary files total at most 64 files and
64 MiB including the prepaid witness, leaving the receiver at most 63 files and
64 MiB minus 64 KiB. Its additional 64 KiB closure is physically preallocated
before artifacts. Every relay ordinary log/fact/report write counts, with any
stricter Stage A bound prevailing. Limits are provisional, unmeasured,
cooperating-producer limits, not external free-space reservations or quotas.

Cleanup evidence has three ordered phases:

1. **A:** finish/stop/drain the captured native producer, close fixture/forwards,
   and independently check their PID **and group** absence and closed listeners
   while the receiver owner is explicitly alive. PID reuse, a surviving group or
   unknown cessation holds removal.
2. **B:** deliver bounded A facts; the receiver drains writes, publishes
   `relay-report.json` once, finalizes its reserved closure, releases ownership
   and exits. `relay-report-before-cleanup.json` is separate immutable preliminary
   evidence. The closed report explicitly leaves owner exit and terminal success
   unobserved; it cannot assert its own future absence.
3. **C:** the already-running outer qualifier reaps the transport, independently
   checks receiver PID/group absence and closed bundle hashes/paths, then removes
   eligible exact-owned scratch and checks absence/source again. It fills and
   closes the prepaid terminal witness once and validates readback. The witness
   binds the source/run, immutable report/closure hashes and sizes, captured owner
   identities, exit/absence observations, cleanup and every failure. The binding
   is one-way: witness to closed bundle. It asserts receiver cleanup, never the
   witness author's future exit. A valid bundle alone is not terminal success.

Refusal, cancellation, EOF, malformed/truncated transport, writer/close/unlock or
witness failure cannot pass. An original first producer nonzero or observed
signal remains primary; later evidence/cleanup failures additionally prevent
success. Accepted writes drain and existing cleanup/readbacks are attempted;
unknown cessation retains scratch. No reopen, replacement run/report, stale-lock
eviction, historical overwrite, deletion or eviction is provided. Host loss or
SIGKILL requires separate recovery; it is not a passed cleanup observation.

`fixtures/host-gallery-evidence.test.mjs` and `host-gallery-evidence.test.mjs`
cover the actual adapters, Python owner/sink/protocol and qualifier seams using
fake producer/transport/cleanup ports and tiny exact-owned synthetic fixtures.
They do not execute an app, Electron, SSH or native attempt. The existing fixture
test retains all three success/failure/SIGTERM outcome and peer-survival oracles.
This new cross-host behavior is runtime-unqualified. CDP memory, unrelated
stdout, fixture-internal corpus writes, scratch occupancy after admission, raw
trace/Q-PV4 and other producers remain outside these cooperating-write bounds.
There is no sandbox, global disk/memory quota, full Stage B or native/installed
acceptance claim.

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

### Diagnostic Q-PV4 source checkpoint

`preview/trace-probe.mjs` is a standalone diagnostic core. It leaves the production
runner's `refuseRawTrace()` and the complete containment oracle unchanged. Its
best result is `MEASURED_PARTIAL`; it exits nonzero even then. `FULL_FIDELITY` is
`FAILED` or `UNPROVED`, and tiny-case `TRUNCATION` never passes. No diagnostic
success, production route, Q-PV4 pass or native acceptance follows from source CI.

The label-only `hq-qpv4-trace-probe.yml` workflow implements the accepted staged
G0/G1/G2 and verified-upload conditions. Source publication carries no label and
does not run that diagnostic workflow. The core and static workflow assertions
use existing portable test discovery; no dependency or lockfile edit is needed.
Do not invoke the native diagnostic from a laptop or VPS. Any future invocation
requires the separate exact operational envelope, a proved Apple Silicon hosted
macOS runner, pinned Node 24.19.0, the locked app build, an existing private owned
evidence parent, and the workflow's approved event head/base and budget anchor.
Its source CLI shape is:

```text
node tests/acceptance/preview/trace-probe.mjs run --evidence EXISTING_PRIVATE_PARENT --publication PUBLIC_DIRECTORY --binding-json EXPECTED_BINDING_JSON --job-end EPOCH_SECONDS --head APPROVED_HEAD
```

This command is not a setup or permission mechanism. `--job-end` must come from
the allocated Runner.Worker anchor, not an invented extension. The 30 s
service/worker gap and 15 s transition allowances are unproved native feasibility
conditions. The hard job limit is 15 minutes, reserving 180 s for closure/upload.
The driver needs at least six integer timeout minutes; each serial case needs
260 s remaining. A refusal never extends a bound or triggers another case.

The process-local storage owner admits actual receiving filesystems before any
new run or scratch parent. It precharges 114 MiB + 4096 ordinary bytes and
preallocates a real 8 MiB closure, under the unchanged Stage A reserve/peak and
per-artifact limits. Raw slots, decoded JSON, both pinned tools, logs, and facts
share that accounting. Evidence and runtime scratch are disjoint on the same
filesystem. Raw files are charged before start, accepted at 0644 only in the
owned 0700 runtime root, then made 0600 after cessation and moved without copying.
No retained file is overwritten or deleted, and an existing parent lock refuses
without eviction. Pipe chunks are at most 64 KiB with one pending sink write;
JSON is at most 32 MiB, query memory 64 MiB, text/stderr 1 MiB each, and Electron
output 1 MiB in memory. These provisional limits are unmeasured; they are not a
global quota, memory sandbox, or reservation of external free space.

Sanitized publication uses that same process-local owner and lock. Admission
validates a closed immutable repository/PR/run/attempt/event/actor/head/base/source
binding and hashes its canonical encoding. The required publication selector is
`EXISTING_PRIVATE_PARENT/public-<binding SHA-256>`; it grants no authority and
must be absent, private, disjoint from scratch and on the admitted filesystem.
The selector itself provisions nothing. After G1 and fresh Stage A admission,
one workflow step exclusively creates `${RUNNER_TEMP}/hq-qpv4-evidence` at mode
0700, failing on any existing entry. Before allocation it checks actual receiving
filesystem/custody and the same filesystem as runtime scratch. Its one-minute
maximum must fit `now + 60 + 180 <= END`; no time allowance is added.

Before the first lock write, the existing 2 MiB facts allowance is split into
2,060,288 bytes for ordinary facts, 16,384 bytes for the four public files
(4,096 each), 16,384 bytes for one private receipt and 4,096 bytes for the lock.
Seven artifact positions are reserved, leaving 249 ordinary positions. There is
no extra allowance, reclaimed failed reservation or second writer. Failed partial
files retain their charges. The aggregate 114 MiB + 4096 ordinary and 8 MiB
closure limits are unchanged.

`close(outcome, {projectClosed, signal})` bars ordinary writes synchronously and
memoizes its first terminal promise. It validates the actual retained report,
seals and hashes the immutable closure while retaining ownership, then projects
exactly four closed-schema files from those validated bytes. It checks every
public capacity before any public file, writes one exclusive private staging
directory and one flat private receipt, then atomically renames that same inode.
There is no copy, overwrite, second receipt or completion marker. The receipt
binds report/closure/file identities and hashes, not future outcome upgrades.
Only verified durable publication permits lock release. Unknown rename, late
close or unlock retains evidence/custody and never triggers a retry. A parent
lock or ambiguous state always refuses recovery.

The later closure step can invoke only this read-only command:

```text
node tests/acceptance/preview/trace-probe.mjs verify-publication --evidence EXISTING_PRIVATE_PARENT --publication PUBLIC_DIRECTORY --binding-json EXPECTED_BINDING_JSON
```

It verifies expected binding, no outstanding lock, private ownership, identities,
exact hashes/inventory, four exact public filenames and projection-byte equality.
It neither opens an owner nor writes, repairs, evicts, finalizes or emits workflow
outputs. Exit zero means publication verified, never diagnostic success. Complete
post-crash publication may verify; incomplete or unknown publication cannot.
The verifier additionally requires exactly one parent entry beginning `public-`,
of any type, and that it is the expected directory. Extra, malformed, mismatched
or unsafe matching entries refuse without repair. The closure wrapper derives
that directory with the helper's canonical digest, passes the expected event
binding through env data and the read-only CLI, and emits only fixed
`publication_verified=true` after exit zero. Upload requires that positive output
and successful closure; a present directory alone is insufficient. Exactly four
nonrecursive `public-*` filename globs select the verified directory. Event fields
are never interpolated as code in `run` bodies. Private
receipt, run, staging, raw/decoded trace and full closure remain outside the four
sanitized upload files. Native/public-upload authority remains separate.

The closed reference manifest pins exactly two v57.2 mac-arm64 Perfetto tools by
the 9c7 prebuilt manifests, not by a proved 9c7 build, reproducible build or
independent build attestation. Acquisition, tool execution and uploads remain
unapproved. There is no package-manager, source-build, signing or PATH fallback.
The diagnostic uses `ReturnAsStream` only as the protobuf start-format flag;
it sends no `Tracing.end` or `IO.*` request. The disclosed in-process tracing
service flag is diagnostic-only and also needs the later operational envelope.

The unchanged native oracle consumes the upstream JSON export. Subset comparison
uses exact event multisets per integer-microsecond bucket and exact leaf values,
with explicit 16-significant-digit rounding disclosure. Empty containers, nulls,
nanosecond timestamps and 17-digit reals are unobservable or not preserved through
these references. R-F requires a separately allocated producer-encoding-preserving
reference. Tiny files and missing terminal markers are consistency facts only;
positive cap evidence needs the separately allocated R-T early-close observation.
Neither R-T's proposed lsof command nor an R-F decoder is implemented here.

Cessation is independently checked before frozen runtime cleanup. Unknown group
or descendant absence retains scratch, prevents the next case and blocks cleanup;
writer/converter/cleanup failures prevent apparent success. Original producer
failure or cancellation remains primary. Closure retains bounded refusal facts.
Runtime/native capability, complete trace containment, public sanitized upload,
production capture, other producers and full Stage B qualification remain open.

On ephemeral hosted runners, the private parent, run, receipt, raw/decoded traces
and owned setup/runtime scratch last only for the job lifetime and disappear
with the runner. Only the VERIFIED four-file sanitized artifact can be durable
under the separate C authorization. Failed publication leaves no durable uploaded
evidence bundle; ordinary job logs and source CI do not substitute for it. No
public upload, acquisition, native diagnostic build/run, label or merge follows
from this source workflow. VERIFIED means publication verification only.
