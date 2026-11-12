# Getting started panel

Product entry: first launch of HQ, any domain. A non-modal card at the bottom-left of the workspace welcomes the user,
names the four domains with their live data-source status, and offers a five-step checklist. It folds into a pill, can
be hidden with Undo, and reopens from the command palette.

| Item | Detail |
| --- | --- |
| Source | `apps/desktop/src/onboarding/` (`GettingStarted.tsx`, `onboarding-state.ts`, `onboarding.css`); exported from `onboarding/index.ts` |
| Mounted by | The shell, as a direct child of the workspace column between the module and the footer, inside `DataSourcesProvider` |
| Reads | `useDataSources()` (Social, Work and Wiki status) and the shell's `StoragePort`; stores `hq.onboarding.v1` |
| Events in | `hq-show-welcome` reopens; `hq-open-command-palette` (and Ctrl/⌘K) marks the palette step used |
| Events out | `hq-open-settings` with `detail.source` of `work`, `social` or `wiki`; `hq-open-command-palette` |
| Placement | Zero-height row; `--gs-inset-inline`, `--gs-inset-block` and `--gs-max` move or size the card; `className` reaches the row |
| Narrow | Below 900 px of workspace width it rests as the pill; opening it there is session-only and the stored state is kept |

Checks: `npx vitest run apps/desktop/src/onboarding` covers state parsing and checklist derivation (unit) and the panel
(render, persistence, Hide with Undo, reopen, Escape, narrow, completion, unreachable source). Real-app captures for the
first launch, both themes, the pill, Hide, restart, reopen, reduced motion, 760×560 and an unreachable service are in
[`docs/design/hq-cross-app-flow-assessment-20261103/b2`](../design/hq-cross-app-flow-assessment-20261103/b2/README.md).

Unverified: native macOS, a screen reader, forced-colors rendering, a real Wiki repository, Design's own palette
sharing Ctrl/⌘K, and any F1 layout other than the evidence-only mount that produced the captures.
