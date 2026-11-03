# Storage admission helpers and scoped package commands

Stage A supplies dependency-free Node ESM helpers for a cooperating producer
coordinator. The root `build`, `build:electron`, `build:preview-agent` and `test`
scripts now use one cooperating storage envelope each. This is scoped source
coverage, not global storage protection, installed runtime protection or native
qualification. Repository
ownership remains in [AGENTS.md](../../AGENTS.md); the integration campaign is
[HQ integration parallel execution](../../docs/engineering-specs/hq-integration-parallel-execution.md).

## Scoped cache placement

The desktop Vite config, preview-agent Vite config and root Vitest config set
their cache destinations to `.t3/cache/vite-desktop`,
`.t3/cache/vite-preview-agent` and `.t3/cache/vitest-root` in their own worktree.
Paths resolve from each config's URL, independently of the invocation's working
directory. The root Vitest projects inherit its cache destination. `.t3/` is
already ignored. Compiled outputs and their replacement behavior are unchanged.

The nine module-local Vitest configs for annotations, app/sections, canvas,
compare, components, references, requests, taste and ui use separate
`.t3/cache/design-<namespace>` destinations. The Design integration preview
Vite config uses `.t3/cache/design-preview`. Each resolves from its own config
URL. The Design matrix consumes these configs without a workflow change.

**Uncovered:** `modules/design/app/vitest.config.ts` (the separate PR168
candidate) and the eight Vite configs under
`modules/design/{canvas/harness,compare/demo,components/harness,projects/harness,references/harness,requests/harness,taste/preview,ui/harness}/`
retain their default cache placement. Covering those requires a separate scope
release. Existing caches are not moved or removed. The new
locations persist with the worktree, without automatic eviction, byte limits
or producer admission. This is cache placement, not full Stage B coverage.

`tools/storage/test/cache-config.test.mjs` evaluates the allocated config expressions
using Node's type erasure without installing or starting Vite or a server. It
checks isolated namespaces and checkout relocation, including spaces in paths
and unrelated working directories. The
required hosted typecheck/build/tests exercise the actual Vite/Vitest APIs.

## Scoped package-command admission

`commands.mjs` preserves these ordered, short-circuiting chains without spawning
another wrapped script or coordinator:

- `build`: the unchanged `npm run typecheck`, desktop Vite build, then
  `build:electron`.
- `build:electron`: Electron, Design-host and Wiki-host TypeScript compilation,
  in that order, then `build:preview-agent`.
- `build:preview-agent`: the preview-agent Vite build.
- `test`: `build:electron`, then `vitest run`.

Only the final leaf receives forwarded arguments: Vitest for `test`, or the
preview-agent Vite build for the three build keys. The closed non-routing
argument grammar accepts Vite `--mode`, `--logLevel` and `--sourcemap`; Vitest
`--reporter` (the built-in stdout reporters), `--testNamePattern`/`-t`,
`--passWithNoTests`, `--no-file-parallelism` and `--silent`. Unknown arguments,
including output/config/root/cache routing, watch and coverage options, refuse
before allocation or launch. Accepted argument vectors are forwarded unchanged. This is narrower than npm's
append semantics: positional Vitest filters and other unlisted arguments refuse;
no current CI caller forwards them.

TypeScript, Vite and Vitest resolve exclusively through this worktree's
`node_modules/.bin`, using module identity rather than the caller's working
directory, and run through the current Node executable without a shell.
Only `build` needs the inherited `npm_execpath`: before admission or allocation
it must be absolute and realpath to an existing regular file. Its resolved path
is printed in invocation diagnostics and launched as
`process.execPath, [driver, 'run', 'typecheck']`. It identifies the invoking npm,
not a parent capability. There is no PATH search, fallback download or install.
The other three keys do not consult the driver; standalone `build` without a
proved driver refuses.

Before creating even a scratch parent, admission measures the actual receiving
filesystems and custody for `apps/desktop/dist`, `apps/desktop/dist-electron`,
`.t3/cache`, `node_modules/.vite-temp` and `.t3/storage-command-scratch`.
Unknown capacity refuses; the unchanged policy requires 40 GiB available on each
receiving filesystem. Fixed build replacement and `emptyOutDir` remain unchanged.
The one top-level envelope owns its lock, while nested steps use its live
process-local parent capability. Each leaf declares a provisional additional
512 MiB allowance; nested chains reserve their remaining leaves' allowances
from that same peak. These are conservative unmeasured declarations, not
measured compiler peaks or hard byte quotas.

The environment passes through, including `HQ_CLI_E2E`, except that npm's cache
uses `.t3/cache/npm` and `TMPDIR`/`TMP`/`TEMP` use one uniquely owned scratch
child. Caches persist without eviction. After draining owned producers, cleanup
removes only the exact owned child and matching locks; it never sweeps the
shared scratch parent or historical state. The first failing step short-circuits
the chain, and its exit code or signal remains primary through cleanup. Signals
propagate to the live leaf and the CLI propagates the result after finalization.

`dev`'s initial `npm run build:electron` now has its own top-level admission;
long-lived `dev`/`dev:web`, `start` and `preview` remain uncovered. The macOS
package route and Linux native-journeys build would traverse this coordinator,
but are **unqualified pre-merge debts**: no package or native pass is claimed.
The CLI/Planner workflow runs its own `tools/hq-cli` package, not this root
`test` graph; the Wiki workspace script also remains unchanged. Tests and builds
for this slice execute only on GitHub. A required job refusing capacity is a
qualification stop, not permission for an environment bypass or a lower policy.

`commands.test.mjs` uses tiny dependency-free fake CLIs and explicit fixture-only
context injection to exercise order, argv, forwarding, driver refusal, capacity,
lock refusal, failure, cancellation and cleanup. The production CLI has no
fixture, policy, worktree or executable override.

## Policy and accounting

All settings are provisional and unmeasured. Never lower a production reserve
to make a host pass admission.

| Limit | Default |
| --- | --- |
| Available capacity on each receiving filesystem | 30 GiB residual reserve + 10 GiB additional peak |
| Compiled output per declared worktree | 256 MiB |
| Compiled output plus caches per declared worktree | 512 MiB total |
| Evidence per run | 128 MiB: 120 MiB ordinary + 8 MiB closure |
| Ordinary evidence artifact | 32 MiB |
| Each evidence parent | 2 GiB retained, at most 16 runs |
| Review age, without automatic deletion | Evidence 14 days; generated state 30 days |
| Lock acquisition | Five seconds total, in stable path order |

`policy.mjs` exports immutable `POLICY` and the pure `decideStorage(snapshot)`
decision seam. The seam can later be replaced by an approved fleet decision
adapter. There is no daemon, persistent allocation ledger or global controller.
Evidence byte/run limits are prospective: existing occupancy plus one complete
128 MiB run, and existing run count plus one, must fit. Every direct child
directory counts, including failed, cancelled and incomplete runs.

`admission.mjs` exports `inspectStorage(plan)` and `requireAdmission(snapshot)`.
Plans declare an existing worktree and absolute destination roots with a `kind`
of `compiled`, `cache`, `scratch` or `evidence`. Missing generated destinations
resolve through their nearest existing ancestor without creating directories.
Shared evidence parents must already exist under their independently admitted
creator's ownership; the helper never bootstraps or removes shared parents.

Paths containing traversal, symlinks, unsafe writable ancestors, unclear UID
ownership, special files, changed identities or changed mounts refuse. Callers
must supply canonical paths, including canonicalizing trusted system aliases
such as a platform temporary-directory alias before forming a plan. Generated
roots must be inside the worktree. Evidence, generated and scratch lifecycles
must be disjoint; nested evidence parents refuse as ambiguous.

Capacity groups use filesystem device identity and the lowest observed
available value for colocated roots. Free bytes are never added together or
reduced again by retained occupancy. Each receiving device gets the full peak
estimate; separate devices are never admitted using another device's free
space. Shared APFS physical-pool capacity is not added across volumes.
Retained bytes deduplicate nested roots and device/inode identities, including
hardlinks, and use the larger of block-rounded logical size and allocated
blocks. This makes no claim about APFS clone savings or physical reclaim.
Unknown measurements or a scan exceeding 100,000 entries refuse.

## Invocation lifecycle

`withStorageInvocation(plan, callback, options)` in `launcher.mjs` admits the
complete declared envelope before calling the producer callback. It creates a
`.hq-storage.lock` file in the canonical worktree and each evidence parent,
containing only an invocation nonce and PID. It remeasures after locking and
immediately before each launch. A locked, stale, malformed or unreadable lock
is preserved and reported; recovery requires its owner's disposition. No PID
is killed to acquire a lock.

The callback receives a live context with two methods:

- `await context.scratch(parent)` creates a unique scratch directory under an
  existing, explicitly declared `scratch` parent. Only directories created by
  this call are eligible for cleanup. Declare enough peak headroom for scratch.
- `await context.launch({command, args, bytes, ...})` starts a foreground
  producer without a shell. `bytes` is a positive conservative additional
  allowance charged on **each** scoped filesystem. Allowances are consumed
  cumulatively; they are not refunded after a child exits. `cwd` defaults to
  the worktree and must stay inside it. `env` defaults to the caller's
  environment. `stdio` is `inherit` or `ignore`; captured output needs the
  future bounded writer. Optional `signal` accepts an AbortSignal.

Return the launch result from the callback: `{code, signal, diagnostics}`.
Pre-admission errors reject without a producer; callback, preservation and
cleanup errors fail an otherwise successful invocation. The first producer
failure or signal remains primary even if subsequent steps succeed. Refused
operations latch failure. Unawaited launched work is drained before cleanup;
concurrent operations on one context refuse. This is not permission to spawn
untracked producers directly from the callback.

Callers may pass `preserveEvidence(result, scratchPaths)` to settle their
bounded evidence before cleanup. Locks remain held through that callback,
final measurement and scratch cleanup. Unsafe or changed scratch is preserved
with an error; historical outputs, caches, evidence and other scratch are never
removed. A normal finalization removes only the exact owned scratch trees and
matching owned locks. SIGKILL or host loss can leave locks/scratch for explicit
recovery; no stale eviction runs later.

If `preserveEvidence` throws, that invocation's exact owned scratch trees are
retained and their paths reported in diagnostics. Ancestor cleanup also retains
any owned scratch tree containing that held nested scratch; unrelated owned
scratch still cleans normally. A later successful preservation callback does
not clear this hold. The original child failure or signal remains primary;
otherwise the preservation failure makes the result nonzero. Matching locks
are released once owned producers have stopped: retained evidence is inert,
and later invocations own different scratch trees, so retention alone does not
require blocking the worktree with a stale lock. Unknown or live descendants
still preserve locks as described below. Retained scratch requires explicit
owner disposition; later invocations never sweep or retry its removal.

The launcher forwards SIGINT, SIGTERM and SIGHUP and AbortSignal cancellation
to its owned POSIX process group. A producer ignoring cancellation receives
SIGKILL after one second; its actual exit/signal is returned with diagnostics.
Remaining same-group descendants are stopped before cleanup. Unknown or still
live descendants preserve locks and scratch. Producers must remain foreground
and keep descendants in that process group; daemonizing/escaping processes
are unsupported. The embedding CLI must propagate the result **after** the
promise settles, e.g. re-signal itself for `result.signal`, otherwise use
`process.exitCode = result.code`.

During a producer's lifetime, the default monitor starts an availability and
retained-occupancy check every second without overlapping checks (a check can
take longer on a slow filesystem). A breach
stops the owned group. Admission snapshots and monitoring are **not hard quotas**
against external processes, arbitrary compiler writes or races with unrelated
writers. These helpers are for trusted cooperating coordinators, not a sandbox
against hostile same-user mutation. CPU, memory and compiler fan-out admission
remain independent prerequisites.

### Nested work

Within the **same Node coordinator**, pass the live context as `parent` to
`withStorageInvocation(childPlan, childCallback, {parent, allowanceBytes})`.
The child must use the same worktree and a subset of the parent's roots with
matching lifecycle kinds. Its allowance is deducted from the parent's remaining
allowance, then used by its own children. It inherits policy, cancellation and
locks; it does not reserve another peak or acquire ancestor locks. Each nested
evidence parent denotes the same top-level run, not another run allocation.

The context is a process-local capability checked against live invocation
state. Expired objects, serialized copies and environment tokens refuse.
There is no cross-process context transport. A separately launched wrapper
cannot inherit via an environment flag: orchestrate it in the live coordinator
or let a genuinely standalone invocation acquire its own envelope. Trying to
start another standalone envelope inside an active one contends and refuses.

## Checks and limits of this slice

Requires POSIX Node 22.18+ and same-user owned paths. From the repository root,
after same-host CPU/memory and temporary-storage admission, run:

```sh
UV_THREADPOOL_SIZE=1 OMP_NUM_THREADS=1 OPENBLAS_NUM_THREADS=1 VECLIB_MAXIMUM_THREADS=1 node --max-old-space-size=256 --test --test-concurrency=1 tools/storage/test/*.test.mjs
```

Tests use tiny, uniquely owned temporary fixtures, stub producers and explicit
`createTestContext({policy, measureFilesystem})` injection. That fixture API is
not a production configuration mechanism; no environment variable lowers
defaults. Tests admit their temporary filesystem before allocation and remove
their exact fixture roots. No dependencies, compiler or browser are needed.

Stage B remains incomplete. Beyond the four root commands above, other producer
routing and the unallocated Design caches remain uncovered, along with
the byte-accounting evidence writer, closure preallocation, pending-write and
artifact bounds, screenshots and bounded trace collection; check registration
and campaign amendments. The per-run/ordinary/closure/artifact settings above
are exported policy for that writer, **not implemented write quotas**. Age
settings are review policy only; no age scan or deletion runs here. Wiring must
declare all receiving roots and preserve existing CPU/memory controls. Real
build growth, cold/warm/failure/cancellation qualification and platform-native
acceptance require an independently admitted host and separate scope release.
Dependencies, authoritative userData/databases, Discovery LRU, releases,
rollback, packaging, installation and deployment remain outside this slice.
