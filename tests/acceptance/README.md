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

Full mode returns nonzero while integration gaps remain. Synthetic-service replay,
domain-reference round trips and unavailable/unknown UI assertions await the
separately authorized integrated scenario suite. They are not simulated by mutating localStorage
or reported as passed. A missing binary/display/namespace capability also fails.
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
node --test --test-concurrency=1 tests/acceptance/fixtures/fixtures.test.mjs tests/acceptance/cleanup.test.mjs
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

Work service response records persist under the owned scratch root and survive
replacement fixture instances. State/version reads reflect successful retained
writes. This provides no durable unresolved client intent: RW-9/G-3 remain
session-only. An integrated post-restart no-intent test is still a gap, and the
fixture never initiates a replay. Resend application requires an explicit script.
Social scripts do not simulate a real execution provider.

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
rows. The integrated scenario catalog itself remains a gap until the authorized
scenario task supplies it; these reserved rows do not claim an exhaustive final
acceptance catalog. Full mode cannot pass with missing, held or unimplemented
rows. Checkpoint's existing limited success semantics remain unchanged.

Runtime ownership includes HTTP servers and their accepted sockets, CDP sockets,
process groups, profiles and all corpus/export scratch trees beneath the unique
run root. Bounded report/log evidence is saved outside scratch before teardown.
Cleanup attempts every registered resource even after an earlier cleanup fails;
cleanup failure fails the run and preserves any original error. The lifecycle
tests cover success, deliberate failure, partial child startup, both handled
signals, an open HTTP socket, concurrent peers and injected cleanup failure.
