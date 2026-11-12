# B1 Work contract spine source checkpoint

Artifact Type: work-note
Artifact ID: note.hq-b1-work-spine-recovery-20261112
Purpose: Preserve the retained Work live/durability contract on current foundation.
Decision owner: M Jones
Consumers: HQ recovery integration owner and Mini serial verifier
Authority effect: none

## Source binding

Base: `8945d156585510fbdf1515fad01798f416146b4e` on `work/hq-foundation`.
Successor branch: `work/hq-recovery-work-spine-20261112`.
Normal-history merge of retained #198 head
`d2085c564e8b89a26c248261c3058d5a20a1c2e9`
(`work/hq-wrk-planner-live-20261110`). Original branches and history remain.
The #203 HQR head `83764eff95c58030d31c3669815a13da3efe1a51` is already
an ancestor of foundation. No Planner or CLI implementation is added here.

## Composition and preserved contracts

The sole content conflict was `apps/desktop/electron/services.ts` at the
channel/limits declaration. Keep foundation's entire implementation, including
Social reference/link validation, the 16 MiB workspace response limit and its
workspace-read override, main-only CSRF tokens, and unknown-mutation handling;
add only `workLocal: 'hq:svc:work-local'` to the closed channel map.

Retain #198's typed load/save contract, Work-only preload capability and tests,
main-side device storage implementation/tests, intent export/adoption, and local
structural transport mirror. The canonical-shape test still binds the mirror to
shared WorkLocal types. Production Work imports remain local or use only the
permitted package roots. Adoption sends nothing and grants no Apply authority;
uncertain writes require explicit Check and then permitted explicit Apply.

Device storage retains origin binding, optimistic revision comparison, serialized
writes, strict bounded JSON, 16 MiB value cap, private file modes and atomic
replacement. A conflict is never automatically merged or replayed. No account
settings, real stores, credentials or running services were accessed.

## Dependencies held for their owners

- **Electron main owner:** `main.ts` remains byte-identical to foundation. The
  retained merge's three startup additions were deliberately excluded: import
  `createWorkLocal` from `./work-local.js`; construct it with
  `{ root: app.getPath('userData'), endpoint: () => config.get('work') }`; register
  `CHANNELS.workLocal` through the existing `handleDomain`, checking
  `authorized(event)` before `workLocal.call(route, params)` and returning
  `{ ok: false, kind: 'unavailable' }` on refusal. The preload capability has no
  registered main handler until that owner integrates it. No runtime durability
  is claimed by this checkpoint.
- **Later Work correctness lane:** review B1-Q1 offline queue `0406757` before
  importing it; no store queue or `registerWorkDurability` is introduced here.
- **Shell owner:** later wire durability in `chooseWork()` only after the queue
  is reviewed and integrated. `apps/desktop/src/services/domains.tsx` and all
  renderer/shell/Settings/navigation files remain unchanged here.
- **Later focused lanes:** health `d372516` and real-Planner E2E `87dff10` remain
  excluded. Keep the historical B1 handoff's recorded store-swap, quit-drain and
  post-rename directory-fsync limitations visible; this checkpoint resolves none.

## Verification status

SOURCE ONLY; untested pending the Mini serial verifier. No installs, tests,
typechecks, builds, servers or app launches were run. The App Updates owner
retains the Mini heavy slot. The local TypeScript AST parser is unavailable;
no dependency was installed to obtain it.

Static inspection checks the declared file cone, foundation Social implementation
preservation, unchanged main/renderer/Planner/CLI/root surfaces, local Work import
boundary, canonical WorkLocal mirror assertions, and excluded branch ancestry.
`git diff --check` on source and documentation passes except the untouched
retained historical `evidence/hqr-verify-summary-20261103.txt`, which contains
trailing whitespace. Its original bytes are preserved as historical evidence.
Those historical test counts do not qualify this candidate.

Verifier handoff: first run focused Work live/boundary and Electron
services/work-local/preload tests with the required emitted Electron prerequisite,
then full required Foundation typecheck/tests/build, CLI Node plus synthetic
Planner E2E, Planner contract/Python/Node, and the complete Design required family
before any qualifying integration. Include Wiki and portable acceptance/storage
checks in Foundation. All local execution belongs on the Apple Silicon Mini,
serially after admission and slot allocation. No PR is opened at this checkpoint;
publication and integration remain with the parent.

## Static check receipt

- Repository, task branch, clean initial state and exact foundation verified.
- Scoped path check: 29 tracked merge paths, all within the declared cone.
- `services.ts`: foundation bytes plus only the Work-local channel addition.
- `services.test.ts`: foundation bytes plus exactly the two B1 assertions.
- 14 other implementation/test files match retained #198 byte-for-byte;
  canonical-shape differs only in a corrected explanatory comment.
- 69 Work production files pass the static import-boundary scan. This is
  lexical source inspection, not AST parsing or execution of the boundary test.
- All six canonical WorkLocal/shared type equality assertions and shared route
  binding remain present; compile-time validity awaits typecheck.
- Main, renderer, Social module, Planner, CLI, workflows and root manifests are
  unchanged from foundation.
- HQR ancestry and all three excluded branch ancestry checks pass.
- Source/documentation whitespace checks pass with only the preserved historical
  log excluded. Initial whole-diff whitespace check reported that log's trailing
  spaces; no source whitespace errors were reported.

## Exact changed-file inventory

- `apps/desktop/electron/preload.cts`
- `apps/desktop/electron/r3-preload.test.ts`
- `apps/desktop/electron/services.test.ts`
- `apps/desktop/electron/services.ts`
- `apps/desktop/electron/work-local.test.ts`
- `apps/desktop/electron/work-local.ts`
- `docs/design/work/adapter-boundary.md`
- `docs/engineering-specs/backend-assessment-planner-20261103.md`
- `docs/handoffs/hq-life-20261103/b1-planner.md`
- `docs/handoffs/hq-life-20261103/b1-planner/briefs/b1-e.md`
- `docs/handoffs/hq-life-20261103/b1-planner/briefs/b1-h.md`
- `docs/handoffs/hq-life-20261103/b1-planner/briefs/b1-q1.md`
- `docs/handoffs/hq-life-20261103/b1-planner/briefs/b1-q2.md`
- `docs/handoffs/hq-life-20261103/b1-planner/briefs/b1-t.md`
- `docs/handoffs/hq-life-20261103/b1-planner/briefs/b1-w.md`
- `docs/handoffs/hq-life-20261103/b1-planner/briefs/common.md`
- `docs/handoffs/hq-life-20261103/b1-planner/evidence/hqr-verify-summary-20261103.txt`
- `docs/handoffs/hq-life-20261103/b1-planner/recovery-work-spine-20261112.md`
- `modules/work/core/port.ts`
- `modules/work/live/adapter.ts`
- `modules/work/live/durable.ts`
- `modules/work/live/index.ts`
- `modules/work/live/intent.ts`
- `modules/work/live/test/adapter.test.ts`
- `modules/work/live/test/canonical-shape.test.ts`
- `modules/work/live/test/durable.test.ts`
- `modules/work/live/test/intents.test.ts`
- `modules/work/live/transport.ts`
- `packages/contracts/src/services.ts`
- `services/README.md`
