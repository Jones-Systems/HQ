# Shared shell recovery candidate

Artifact Type: work-note
Artifact ID: work.hq-shell-recovery
Authority effect: none

This candidate recovers the settled shell and saved cross-HQ flows onto foundation
`8945d156585510fbdf1515fad01798f416146b4e`. It is source-only and untested.
No installation, runtime activation, PR, or integration merge is implied.

## Successor checkpoint

The SHL integration successor consumes INT `6cfbaf28964eb8376244e1ab14e6efc6a1d73301`
by ordinary merge. Social/Work reference providers now share the cached choice
and exact port used by their mounted service domains. Reads do not mount Work;
failed live reads never fall back to examples. The source-only receipt and
pending module/test hunks are in
`docs/handoffs/hq-life-20261103/SHL/shell-checkpoint-20261112.md`.

The dependencies below describe the earlier checkpoint. Work's no-op shortcut
and Social's stored example reference scope still require module-owned hunks;
no mounted journey or test pass is claimed by this successor.

## Sources and integration

Normal merge ancestry retains these source branches and their handoffs:

- Shell spine: `work/hq-shl-scope-20261110` at `71ecf0c`, including the
  motion primitives, observed status and #208 workspace scope fixes.
- F1 kit: `work/hq-life-system-kit-20261103` at `450c094`; toast announcements,
  folded-toast cleanup, focus return, exit geometry and interrupted list motion
  fixes are retained. The kit demo now uses `PAGE_TRANSITION_CLASS` and
  `navigateWithTransition`, matching the shell's current API.
- Navigation: `work/hq-life-flow-nav-20261103` at `482e51f`.
- Onboarding: `work/hq-life-flow-onboarding-20261103` at `90ad5fe`.
  Its retained captures and UI-map observations are historical, not evidence
  for this composition. The evidence-only mounted branch was not merged.

The shell mounts one command palette, a workspace ReturnPill, global shortcut
and title hooks, a top-bar search trigger, and GettingStarted inside the shared
DataSourcesProvider. The original TopBar Back slot receives no return label,
so the ReturnPill is the only reference-return control. The named read-only
notice and dismiss action remain. Settings hides onboarding without unmounting it.
Design's handled keyboard events suppress the shell palette. Explicit shell
navigation still uses remembered destinations and never launches work.

Onboarding now reads the retained observed-status vocabulary instead of the
removed `checkedServiceStatus` helper. Observed timestamps remain visible.
An unreachable observation after setup keeps the configuration checklist ticked
and shows the inline unreachable notice; it does not claim connectivity or retry.
The existing state/component tests were adapted to this API; a real-shell mount
fixture covers palette ownership, onboarding reopening and navigation restoration.
All these tests remain unexecuted.

No new dependencies were introduced. The retained lockfile change records the
shell's existing `react-dom` dependency for synchronous transition updates.
Newer Design/Wiki reference providers survive the merge. Electron, preload,
Work, Wiki and Social implementation files were not edited by this recovery.
The authorized shell ancestor also retains its original Settings vocabulary,
Design import-scan tests, token-source docs and corresponding tests.

Frontend guidance was read at
`Jones-Systems/Frontend-Development@b59d310cae8472ae8ed42d4d8562d08c362379d8`.
This is recovery of accepted component designs, with no new product design.
The project-local shared-guidance bridge was absent. No gallery export or
publication was attempted under the source-only assignment.

## Dependencies for the coordinator

- Work: `modules/work/board/moves.ts` returns null for Alt-left in the leftmost
  column; `StatusBoard.tsx` returns before preventing that key's default.
  With a reference trail, the shell's non-Mac Alt-left return can therefore run.
  The Work owner should consume the chord even for a no-op move. This candidate
  does not change the Work module or certify that journey.
- Historical F1 handoff reports a Wiki Alt-left conflict. No matching listener
  was found in the current Wiki source or desktop shell during source inspection;
  the serial verifier must qualify the mounted journey, including listener order.
- Production reference providers retain their separate live Planner/Social read
  clients. This recovery does not fabricate sample providers for real services.
  Example-mode cross-domain reference resolution and shared live-client custody
  remain a bounded integration question for the service/Work owners, before
  claiming those journeys work. No contract or module expansion was made here.
- Settings Updates targeting and selecting an already-open category remain the
  navigation handoff's existing limitations; broad Settings recovery is separate.

## Deferred verification

Only source inspection and Git whitespace/diff/ancestry checks were performed.
No tests, typechecks, builds, dependency installs, servers, browser/app launches,
signing or runtime activation ran. Allocate the Mini serial verifier and its
capacity gate before executing any commands below. Use Node 24.19.0 and
Python 3.13.5; dependency provisioning, if needed, needs that allocation too.

From the candidate repository root, serially:

```sh
npm run typecheck
npm run build:electron
node_modules/.bin/vitest run packages/hq-ui apps/desktop/src
npm run build
```

Full root Vitest discovery and the required Wiki, acceptance/storage, CLI/Planner
and Design check families still need current-head qualification before any
ordinary source integration. Follow the repository's required-check commands
and workflows; a source inspection is not a passing check.

After source checks, explicitly allocated native/synthetic journeys should cover
Design's own Cmd/Ctrl-K, shell palette from other domains and the rail, all
Cmd/Ctrl-1–4 and comma chords, reference return including Mac Cmd-[ and non-Mac
Alt-left, read-only dismiss, per-domain restoration, Settings entry/exit,
onboarding Hide/Undo/reopen/restart, observed status transitions, unknown outcome
notices, reduced motion, light/dark, narrow layout and keyboard focus. No current
visual, accessibility, native, package or installed-app evidence is claimed.
