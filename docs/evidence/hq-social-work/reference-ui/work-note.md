# Reference UI candidate evidence

Task: `spec.hq-integration-parallel-execution#task.reference-ui.001`.
Authority effect: none.

Implemented `ReferenceChip`, `LinkList` and `LinkPicker` within the reference UI
cone. The implementation and preview source is commit
`3e2bffbd1ecc65836f27b127c50b720921a23640`, based on
`d9f9682d43cc36b234248c7375018d067bbd3ca5`. Subsequent evidence-only commits do
not change those tested source bytes. This is builder evidence, not independent
review, integration, installed-app or private-persistence qualification.

## Binding

Plan read at `c49c3c4e25bc634deeaa3ed29df927d76cbb82fb`, plan blob
`b294545e772a5b2994d99f2acdc0d0789bf09dea`; catalog blob
`52608c3aac9d112e4768024f8723ef42df6d0005`. Interface and original reference
requirements read at `6ef007fbc36c13351dc305db1989579f413da343`.

The pinned `hq-reference-ui` group projects
`packages/hq-ui/test/references/**/*.test.ts` and `**/*.test.tsx`.
The released source base does not contain that new catalog group. Its projected
scope was executed directly with Vitest; no catalog was changed. The historical
`hq-ui` label in the original reference test intent is superseded for this task
by the pinned plan's `hq-reference-ui`. Existing kit tests were also run because
the package entrypoint gains exports and a stylesheet.

The repository's `.agents/shared-guidance.md` bridge was absent. The mandated
full V3 guide at `427c971045ffa9643aad33e497639fc50cfb1960` and HQ agreements
were read. The task uses the pinned reference specification and accepted kit;
no independent product design or external implementation research was needed.

## Consumer contract

- Import from `@hq/ui` to load the existing tokens, component styles and new
  `.hq-*` reference styles. The document owns `<html data-theme="light|dark">`.
- `ReferenceEnvelope` and `parseReference` are reused unchanged. The resolution,
  port and return-context additions are local structural types. Shared r3 still
  owns canonical assignability proof.
- `ReferenceChip` and `LinkList` receive observations, never resolve or persist
  them. All eight status labels retain snapshot title, project, domain, kind,
  entity, optional workspace, linked revision and observation time.
- Freshness defaults to five minutes, rechecks every second while mounted,
  and can be invalidated with `stale`. `maxAgeMs` lets the cache owner choose a
  stricter age. Missing, invalid, future, expired and explicitly stale
  observations never show an available status. `now` is a deterministic
  fixture/controlled-clock override; ordinary consumers should omit it.
- Open callbacks are navigation only, enabled for fresh available/changed/
  archived references in the current project. Moved and foreign references
  show read-only project context.
- `LinkList` is controlled. The source owner supplies versioned `onUnlink` and
  `onUpdateSnapshot` mutations only when persistence is supported. Each returns
  a `ReferenceUndo`. The latest successful action has one persistent Undo;
  there is no timeout. The source owner must handle version conflicts and
  reconcile unconfirmed failures before retrying. No target is written.
- Update snapshot requires a fresh, same-project available/changed observation,
  a valid proposed title and revision, and an actual difference. Only activating
  the button invokes the callback. The source owner supplies updated entries;
  rendering and search do not change envelopes.
- `LinkPicker` accepts only `Pick<ReferencePort, 'find'>`. Searches use the
  current project and limit 30. Results are parsed, scoped and deduplicated;
  late responses are ignored, and closing unmounts the search session.
  Existing links and the 30-link limit block selection. The source owner gates
  creation capability and implements persistence and creation Undo in
  `onSelect`; the fixture demonstrates that wiring. The component provides
  search, not a serialized-envelope paste/drop editor.

## Checks

Node `v24.19.0`; `npm ci --no-audit --no-fund` passed, lock unchanged.
All tests ran serially with `--maxWorkers=1 --no-file-parallelism`.
Fresh admission samples before each check allowed one serial test process;
observed CPU ranged from 6.94% to 21.23%, available RAM from 42.64 to
43.35 GiB, with one core representing 6.25% of host capacity.

| Command | Result |
| --- | --- |
| `npx vitest run packages/hq-ui --maxWorkers=1 --no-file-parallelism` | 7 files, 68 tests passed; 47 existing kit tests plus 21 reference tests |
| `npx vitest run --project dom packages/hq-ui/test/references --maxWorkers=1 --no-file-parallelism` | Final affected scope: 1 file, 21 tests passed |
| `npm run build` | Passed root typecheck, Electron typecheck, renderer production build and Electron emit |
| `npx vite build --config packages/hq-ui/test/references/preview/vite.config.ts` | Passed; static fixture built from clean implementation commit |
| `git diff --check` | Passed |

The first build attempt found a test-only `Promise<unknown>` inference error.
An explicit generic corrected it; the build and affected tests above passed
afterward. No failing check was skipped. The full repository test suite was
not run. The existing renderer bundle-size warning remains for the root to
assess; no unrelated chunking changes were made.

## Browser evidence

Jones Code collaborative Browser exercised the built static fixture under the
exact `apps/desktop/index.html` CSP, including `style-src 'self'` and
`connect-src 'none'`. No inline styles or console errors were observed.
The only observed network resources were the fixture HTML, CSS and JS.

All fixtures are synthetic. The fixed fixture clock makes screenshots
reproducible; elapsed freshness and timer cleanup are separately tested in DOM.
Viewport was 1280 × 1500 CSS pixels, reported device pixel ratio 2; saved PNGs
are 1280 × 1500. This does not establish native high-DPI app qualification.

- [Light statuses](light-statuses.png) and [dark statuses](dark-statuses.png):
  all eight labels, snapshots, observation times, expired and unresolved states.
- [Light picker](light-picker.png) and [dark picker](dark-picker.png):
  keyboard focus ring, active result, project scope and unresolved result label.
- [Explicit update and Undo](dark-update-undo.png): updated title, Undo focused.
- [Browser action/readback record](browser-evidence.json): actual keyboard
  actions, focus trap, Escape return, unlink/restore, update/restore, selection
  and creation Undo. Screenshots alone are not the keyboard proof.
- [Build correspondence](build-receipt.json) and [capture hashes](captures.json).

The preview's “Execution calls: 0” is explanatory fixture text, not an
instrumented production counter. DOM tests assert zero calls on an injected
execution spy and assert that search uses no resolve/open capability. The UI's
port and action surfaces contain no execution operation.

## Remaining qualification

Root owns hosted CI, source integration, canonical structural assignability,
cross-domain open/return, persistence capability gating and any final candidate
refresh. Native Electron/macOS, screen readers and forced colours were not
verified. No live service, private data, global reference store or deployment
was used. No independent review was performed and no reviewer bots were invoked.
