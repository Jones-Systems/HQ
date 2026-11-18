# DSN-S source checkpoint

Authority effect: none. Source only; behavior remains unqualified.

## Ancestry and scope

Started clean at DSN-B `b619d411ba0324fa781496474f186b60c05d1098` on
`work/hq-recovery-design-sources-20261112`. Ordinary merges preserve stable shell
`367cfb2159b85927bd04720c57d809e0970640ed`, F5 lane `6d53c41` and all six retained
view refs: References `1f4d5b0`, Imports `ea2824a`, Taste `8d3db74`, Flows `c47bb5a`,
Discovery `4f9130d`, Components `6b4bc02`.

Each merge had a merge-tree inventory/conflict preflight. Expected conflicts
were ImportsView/controller and FlowsView only; all were reconciled in scope.
The source amendment was read at `e9db4f61b0688f3727e4be4e37d00521131fc6f3`.
Frontend guidance main resolved to `b59d310cae8472ae8ed42d4d8562d08c362379d8`;
AGENTS/README/CUSTODY, UI maps, layout, unavailable-action and gallery guidance
were read pinned there. HQ's shared bridge is absent; supplied immutable guidance
was used without installing a replacement.

Shell renderer and UI kit compare byte-identical with the stable-shell dependency.
No contracts, root manifest/lock, desktop or workflow edits were authored. Retained
shell dependency changes and historical F5 handoffs/captures are ancestry, not
new runtime evidence. Public receipts added here contain no private captures.

## Source result

- References queue, drop import, cards and lightbox, plus cross-links and Taste handoff.
- Imports Choose/Review/Done and history retain current `workspace.importsFor` and
  typed `ImportsState.cause`; inline feedback retains the description. Explicit
  rights require basis/holder, license when licensed, optional attribution and
  the mapper's text bounds. Selection wraps the existing picker via
  `withImportRights`; cancellation keeps the statement. Changing rights rebuilds
  the controller and discards the pending plan; controls lock during busy or
  unknown outcomes so changing rights cannot discard reconciliation state.
- Taste queue wrapper and accepted responsive UI retain the DSN-B typed notices
  and `projectVersionSubject` production binding. No backend Taste rewrite.
- Flows retain content revision reads and interactive ports; replace
  `findLastIndex` with the equivalent backwards scan for ES2022.
- Discovery fake source is explicitly labelled, example-only, refresh-on-open off.
  Added guard cases for labels/enrollments/no opening refresh and no native-error
  fallback to examples.
- Components retain the held metadata blueprint, variants, prop hints and motion
  proxy. Runner, generation and export activation remain held.

`workspace.ts`, `bridged-workspace.ts` and `TasteView.tsx` are byte-identical to
DSN-B. `contentEvents`, `retry`, `importsFor`, failures and capability/export ports
remain intact. DSN-C is the next sequential composition writer after this checkpoint.
No automatic repair/disposition of retained P2–P4 findings was attempted.

## Exact shared requests

Desktop picker owner: update only these constants in
`apps/desktop/electron/import-pick-wiring.ts` and its owned wording assertions:

```ts
export const IMPORT_DIALOG_TITLE = 'Choose design files';
export const IMPORT_DIALOG_BUTTON = 'Import selected files';
export const IMPORT_DIALOG_MESSAGE = 'Choose files covered by the rights statement you selected in HQ.';
```

The matching `import-pick-wiring.test.ts` and DSN-M `design-imports.e2e.test.ts`
assertions belong to those owners. No desktop files were edited here. Until this
hunk lands, all four bases work in the example composition; the bridged UI keeps
licensed/permission/public-domain visible but disabled with a reason. On the
assembled source, the composition owner must remove the `dialogCompatible` guard,
its useMemo dependency, the three `disabled={workspace.bridged}` attributes and
the adjacent hold notice in ImportsView, after verifying the dialog change.
Do not activate alternate bases before that reconciliation.

UI map owner: References now has a queue, drop overlay, cards and lightbox instead
of the old details panel. Update its entry and coverage; no current layout check
is claimed. Preview owner: retained Flows/Discovery harness stylesheet/kit gaps
remain outside this cone. There are no requested workspace/contract hunks.

## Verification and remaining gates

`git diff --check` passed. Node 26.12.1 `--check` parsed changed/incoming `.ts`
source/test files without imports or application/test execution. This is syntax
only and differs from CI Node 24.19.0. TypeScript dependencies are absent here;
TSX was read, not compiler-checked. No typecheck, test, build, dependency install,
server, browser, native launch, capture, PR, foundation/main merge or activation.

All new/retained test cases below are UNRUN at this checkpoint. The serial Mini
verifier must check full Design discovery, both renderer-safe import scans,
root typecheck/build/tests and the assembled-head obligations after admission.
Historical builder checks/captures are not current-head evidence. Layout/gutters,
572px and narrow reflow, reduced motion, keyboard, accessibility, native dialog,
real persistence, toast/native-overlay composition and gallery/export completion
remain unverified. No fresh presentation export was admitted; gallery completion
awaits actual later capture/export, not source screenshots.

## Test inventory handoff to INT

No new inventory row or workflow patch is needed: every added test uses an
existing row/glob below. Retain complete discovery and fan-in; verify the actual
inventory on the assembled head. This list includes retained updates and new
DSN-S cases relative to DSN-B; shell-only tests stay with the shell dependency.

| File | Existing Design inventory row | State |
| --- | --- | --- |
| `modules/design/app/compose/test/discovery-example-guard.test.ts` | `app` | UNRUN |
| `modules/design/app/compose/test/import-rights.test.ts` | `app` | UNRUN |
| `modules/design/app/compose/test/imports-rights-view.test.tsx` | `app` | UNRUN |
| `modules/design/app/compose/test/sources-handoff.test.ts` | `app` | UNRUN |
| `modules/design/app/sections/test/references-import.test.tsx` | `app-sections` | UNRUN |
| `modules/design/app/sections/test/references-queue.test.ts` | `app-sections` | UNRUN |
| `modules/design/app/sections/test/renderer-safe.test.ts` | `app-sections` | UNRUN |
| `modules/design/components/tests/blueprint.test.ts` | `components` | UNRUN |
| `modules/design/components/tests/prop-hints.test.ts` | `components` | UNRUN |
| `modules/design/components/tests/proxy-frames.test.ts` | `components` | UNRUN |
| `modules/design/components/tests/variant-diff.test.ts` | `components` | UNRUN |
| `modules/design/components/ui/hold.test.tsx` | `components` | UNRUN |
| `modules/design/components/ui/render.test.tsx` | `components` | UNRUN |
| `modules/design/components/ui/runner.test.tsx` | `components` | UNRUN |
| `modules/design/components/ui/workspace.test.tsx` | `components` | UNRUN |
| `modules/design/discovery/test/data-url.test.ts` | `discovery` | UNRUN |
| `modules/design/discovery/test/explore-refresh.test.ts` | `discovery` | UNRUN |
| `modules/design/discovery/test/grid.test.ts` | `discovery` | UNRUN |
| `modules/design/discovery/test/source-filter.test.ts` | `discovery` | UNRUN |
| `modules/design/discovery/test/view-render.test.ts` | `discovery` | UNRUN |
| `modules/design/flows/test/playback.test.ts` | `flows` | UNRUN |
| `modules/design/flows/test/workspace.test.ts` | `flows` | UNRUN |
| `modules/design/imports/test/cause-feedback.test.ts` | `imports` | UNRUN |
| `modules/design/imports/test/flow.test.ts` | `imports` | UNRUN |
| `modules/design/imports/test/panel-flow.test.ts` | `imports` | UNRUN |
| `modules/design/preview/test/egress-scan.test.ts` | `preview` | UNRUN |
| `modules/design/references/test/view-model-browse.test.ts` | `references` | UNRUN |
| `modules/design/references/ui/browse.render.test.tsx` | `references` | UNRUN |
| `modules/design/references/ui/preview-lifecycle.render.test.tsx` | `references` | UNRUN |
| `modules/design/taste/test/ui/QuickRateDeck.test.tsx` | `taste` | UNRUN |
| `modules/design/taste/test/ui/RatingRow.test.tsx` | `taste` | UNRUN |
| `modules/design/taste/test/ui/deck-model.test.tsx` | `taste` | UNRUN |
