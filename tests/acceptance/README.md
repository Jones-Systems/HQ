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
binary. Route installer cache and temporary files into owned workspace scratch and
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
domain-reference round trips and unavailable/unknown UI assertions are held for
T1's integrated service/UI binding. They are not simulated by mutating localStorage
or reported as passed. A missing binary/display/namespace capability also fails.
Final acceptance requires T1's exact assembled candidate and a fresh build.

Each invocation allocates a unique profile and temporary root under
`.t3/acceptance-scratch/`. Bubblewrap maps its temporary directory to `/tmp` for
Xvfb and Electron and provides private PID/user namespaces and device nodes. CDP
uses an ephemeral loopback port. All inherited `HQ_*` configuration is removed;
this runner must never contact owner-configured services. It does not inspect
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
