# DSN-M Design host matrix source receipt

Authority effect: none. Source checkpoint only; no behavior qualification.

Base: foundation `8945d156585510fbdf1515fad01798f416146b4e`.
Retained matrix: `c1fc58ce5c8dedadcb271ed5eb3558cd900e553f`, preserved by
ordinary merge `dc28a2db5f4bdb5b3929d026eaf9c3a8a2577f11` after a path-only
scope check and conflict-free `merge-tree`. Recovery amendment read at
`e9db4f61b0688f3727e4be4e37d00521131fc6f3`. The B3 and retained W6 handoffs
and landed typed-failure implementation were read before adaptation.

The two E2E files retain 15 section cases and 27 expanded failure cases
(including seven disabled-route table entries): 42 total. The real temporary
file store, structured-clone transport, request-drop/reply-loss controls, CAS
races, no-effect assertions, read-only checks and close/reopen oracles remain.
Each classified rejection now also checks the landed operation-error envelope,
round-trip classification and Check-only recovery for unknown effects. The
closed-host case additionally observes a typed rejection from an uncached
composition call. Runtime-invalid Flow input crosses one explicit typed boundary;
its recorded unknown classification is pinned rather than repaired. The unused
helper and unsafe table/spread casts are removed, and reference success narrows
by its discriminant. Production code is unchanged.

`apps/desktop/test-support/tsconfig.json` includes both E2E files, all harness
fixtures and the dedicated serial Vitest config. It extends root strict options,
uses the Design app's ES2024 libraries and emits nothing. It has NOT been
executed by TypeScript. The Vitest config roots at the repository and selects only
the two matrix files, with one worker and no file parallelism.

## Required-CI placement after independent source judgment

Foundation is the sole executable owner of
`apps/desktop/electron/design-host.e2e.failures.test.ts` and
`apps/desktop/electron/design-host.e2e.sections.test.ts`: 27 failure cases and
15 section cases. Root Vitest discovery already includes both. Root `typecheck`
now includes `tsc -p apps/desktop/test-support/tsconfig.json --noEmit` for
semantic checking; that command remains unrun in this source campaign.

These desktop host integration tests are outside the Design module/package
inventory. Do not add a desktop inventory row, cone wrapper or parser allowlist.
Existing Design coverage and fan-in remain unchanged. The dedicated serial
Vitest config remains available for focused qualification; it is not a second
required CI execution. This corrects the original proposed placement explicitly.

A focused serial pass alone will not qualify Foundation's actual root execution.
The emitted-store parity and native limitations below remain separate.

## Static evidence and later verification

Passed: `git diff --check`; syntax-only `node --check` for all six TypeScript
files; JSON parse and explicit-include inspection; static retained-case title
comparison and seven-row table inspection (42 cases). Syntax used available
Node 26.12.1, not the required CI version. No application or test code executed.
No dependencies were installed. Shared guidance bridge is absent; supplied
immutable owner guidance was used without installing enrollment.

After the existing heavy-slot release, unknown-baseline reconciliation, fresh
Mini admission and qualified compiler controller/lock, the sole serial verifier
must use Node 24.19.0 and Python 3.13.5. From the assembled repository root, run
these commands one at a time under that controller:

```text
node_modules/.bin/tsc -p apps/desktop/test-support/tsconfig.json --noEmit
node_modules/.bin/vitest run --config apps/desktop/test-support/vitest.config.ts
npm run build:electron
node_modules/.bin/vitest run --project node apps/desktop/electron/design-host.test.ts --fileParallelism=false --maxWorkers=1
```

The first two qualify the 42-case source matrix. The last two qualify the
existing emitted-store parity seam separately; the matrix imports the source
store and does not prove emitted-store or native IPC parity. Required full
assembled-head checks and Design inventory/fan-in remain with INT/verifier.
No typecheck, matrix run, build, fixture/app/native process, private-data access,
PR or protected-branch merge occurred here.

Recorded validation-as-unknown, unnamed error classes and absent storage
`too-large` reason remain unmodified findings, with their original disposition.
Imports enablement, export enablement, native behavior and the broader recovery
acceptance remain outside this checkpoint's qualification.
