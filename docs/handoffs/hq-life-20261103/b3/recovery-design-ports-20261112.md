# DSN-B corrected source checkpoint

Authority effect: none. Source only; no behavior qualification.

## Binding and ancestry

Sole writer on `work/hq-recovery-design-ports-20261112`, starting clean at
`9f5a46f9e62ed12d7d77ca052222d3079f324bc9`. That checkpoint preserves the ordinary
Taste merge of `ba82197`. Recovery amendment read at
`e9db4f61b0688f3727e4be4e37d00521131fc6f3`.

Ordinary dependency merges incorporated INT checkpoint
`6cfbaf28964eb8376244e1ab14e6efc6a1d73301` before retained capability source
`e699de57e97a7b198a9f43db7d3edc51f7303788`. Both `merge-tree --write-tree`
preflights returned no conflicts; both merges completed without conflicts.
Contracts are byte-identical to INT. Other upstream Work/Social/Planner changes
are dependency incorporation, not new DSN-B authorship.

## Changes

- `compose/capabilities.ts`: strict capability reader, labelled synthetic answer,
  disabled document-only response, and `withImportRights` over the existing
  zero-argument picker port. Explicit rights are copied before picking; licensed
  requires license text, and mapper text limits are retained.
- `compose/design-export-port.ts`: validated preview/save routes, immutable
  reports, local timestamp refusal, disabled/invalid preservation, unknown lost
  save with Check and no retry.
- `compose/fake-workspace.ts` and `compose/bridged-workspace.ts`: expose
  `readCapabilities` and `designExport`. No changes to `contentEvents`, `retry`,
  `importsFor`, closure or interactive composition.
- `storage/design-export.ts`: status reflects the explicit engine flag. All
  construction sites retain their existing arguments; export enablement excluded.
- Electron `design-host.ts`: projection throws map to invalid; pre-save build
  failures map to unavailable; only save failures map to unknown. Cancellation
  remains `{ saved: false }`.
- `compose/BACKEND-CONTRACT.md`: implemented section 5, new section 13, and
  clarified the separate Imports backup versus host export paths.

No edits to workspace.ts, closure-views.tsx or TasteView.tsx were needed in this
round. Taste scope and typed notices remain in the retained ancestry.

## Test source and inventory requests to INT

No workflow edits requested: existing rows already own these files exactly once.

| Test source | Inventory/check owner | State |
| --- | --- | --- |
| NEW `modules/design/app/compose/test/design-ports.test.ts` | Design `app`, `compose/test/*.test.ts` | Five cases authored, unrun |
| Updated `modules/design/app/storage/test/design-export.test.ts` | Design `app-storage`, `test/*.test.ts` | One flag-status case added, unrun |
| Updated `apps/desktop/electron/design-host.test.ts` | Foundation root Vitest / shared-r3 | Retained three capability cases; two new export/vocabulary cases; unrun |
| Retained `modules/design/app/compose/test/taste-failures.test.ts` | Design `app` Node glob | Unrun here |
| Retained `modules/design/app/compose/test/taste-view.test.tsx` | Design `app` Vitest cone | Unrun here |
| Retained `modules/design/taste/test/{project-service.errors,project-service.subjects,subject-identity}.test.ts` | Design `taste` Node glob | Unrun here |
| Retained `modules/design/taste/test/ui/TastePanel.subjects.test.tsx` | Design `taste` Vitest cone | Unrun here |
| Retained `apps/desktop/electron/design-host.taste.test.ts` | Foundation root Vitest / shared-r3 | Unrun here; unchanged ancestry |

`modules/design/taste/test/document-port.ts` is retained test support, not a
standalone test. Existing errors tests remain retained. No test assertions were
removed, loosened, skipped or retried. The DSN-M host matrix/test-support cone is
untouched. No new inventory row is needed.

## Remaining exact hunk requests

DSN-S owns Imports UI. Collect an explicit `Rights` statement before choosing
files (all four bases, holder, license for licensed, optional attribution), then
apply this port-wiring hunk in `compose/views/ImportsView.tsx`:

```tsx
import { withImportRights } from '../capabilities.ts';
// Add useMemo to the view's React imports. selectedRights is the validated
// Rights | null produced by the UI controls before Pick becomes available.
const { deps, capabilities: baseCapabilities } = workspace.importsFor(context, syntheticSource);
const capabilities = useMemo(() => ({
  ...baseCapabilities,
  pickSource: baseCapabilities.pickSource && selectedRights
    ? withImportRights(baseCapabilities.pickSource, selectedRights)
    : undefined,
}), [baseCapabilities, selectedRights]);
```

Keep the existing `<ImportsPanel ... capabilities={capabilities} />`. Changing
rights must invalidate the pending plan rather than relabeling an already
prepared import. Preserve the selected statement across picker cancellation.
This is a port-integration hunk, not a supplied visual design.

The desktop picker owner must replace the owned-only dialog detail in
`apps/desktop/electron/import-pick-wiring.ts` with this exact constant hunk:

```ts
export const IMPORT_DIALOG_TITLE = 'Choose design files';
export const IMPORT_DIALOG_BUTTON = 'Import selected files';
export const IMPORT_DIALOG_MESSAGE = 'Choose files covered by the rights statement you selected in HQ.';
```

Update the corresponding wording assertions in `import-pick-wiring.test.ts` and
`design-imports.e2e.test.ts` through their assigned test owner (DSN-M for the
host E2E cone). No picker IPC or shared-contract change is
needed; do not enable alternate-basis UI while the dialog claims owned only.
These UI/native-dialog files remain unedited in DSN-B.

No further contracts, workspace.ts or closure-views.tsx hunks requested. DSN-S
then DSN-C consume these committed composition additions in the assigned order.

## Findings retained without repair

- Original possible P2 Taste duplicate-write concern at `ba82197`: source reading
  supports the risk. Notice recovery remounts the panel via `reads`; NotesEditor
  keeps drafts locally and note/counterevidence commands call `newId` on each
  submission. Re-entering an uncertain write can use a new clientEventId. No
  behavioral reproduction or repair here; preserve original P2 severity.
- Taste P3 stale notice and note/counterevidence identity concerns, and P4
  qualified-looking plain IDs, late-client rejection and downgrade-ID concerns
  retain the original review's verified/unverified distinctions. No repair.
- Imports P3/P4 findings, W6 validation-error/name observations, batch-size and
  backup limitations remain recorded in B3's original handoff/reviews. DSN-B
  changes no transaction acceptance, source enablement or matrix assertions.
- The selected recovery export-status/error work is implemented as source;
  this does not dispose of other P2–P4 findings or enable export.

## External overlap and verification

Read current PR #212 at head `eff942d5aae8d4c5610772f11a123e460c8f7ced`.
Its `design-store-compare` compatibility registry roots cover Design host and
`modules/design/app/storage`; these source edits change that protected fingerprint.
The packaging owner must reconcile it on the assembled head. No registry edit,
packaging command or qualification was run here.

Static checks: Node `--check` on all nine new/changed TypeScript source/test
files passed (syntax only, no imports or application/test execution); `git diff
--check` passed; contracts compared byte-identical with INT. Local Node version
was 26.12.1, not CI Node 24.19.0. No dependencies installed. TypeScript dependency
is absent here, so no semantic typecheck is claimed.

All builds, typechecks, tests, real-host/native journeys, export qualification,
UI behavior, and final inventory execution remain UNRUN for the serial Mini
verifier. Preserve the heavy-slot hold, exact toolchain, existing full discovery,
and all enablement/activation/foundation/main holds. No PR or protected merge.
