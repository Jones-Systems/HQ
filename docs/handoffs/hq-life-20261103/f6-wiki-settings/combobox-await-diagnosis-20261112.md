# Wiki combobox pending-await diagnosis, 2026-11-12

Artifact type: diagnostic-receipt
Artifact ID: receipt.hq-wiki-combobox-await-20261112
Purpose: Locate the unfinished keyboard-test await before selecting another repair.
Owner: Scoped Wiki source-diagnosis specialist; sole Git owner: Codex
Consumers: Recovery coordinator and hosted Foundation verifier
Authority effect: none

## Source binding and scope

The isolated task worktree was clean at exact base
`212e5bb068c78a261e9f94b3540c0a40cefce3fd`, on
`work/hq-recovery-wiki-combobox-await-20261112`, with canonical origin
`https://github.com/Jones-Systems/HQ.git`. Only these two paths change:

- `modules/wiki/ui/test/combobox.test.ts`
- `docs/handoffs/hq-life-20261103/f6-wiki-settings/combobox-await-diagnosis-20261112.md`

The assigned codex-v3-debugger role uses an explicit implementation-agent
fallback. Requested workstream selection is Blended Frontier Max, revision 11,
Sol/max, default tier, no Fast; the local preference readback confirms the mode
and revision, not effective provider execution. No subagents were launched.

Read HQ agreements, bootstrap, current recovery Work Note and recovery amendment,
Wiki UI map and shared consumers, and shared test-value/scratch/performance rules.
The local shared-guidance bridge is absent; no enrollment was changed. Canonical
Frontend-Development main resolved to
`b59d310cae8472ae8ed42d4d8562d08c362379d8`; its agent instructions, README,
custody and UI view-map guidance were read. This test-only diagnostic changes no
presentation or accepted layout and establishes no UI journey qualification.

## Existing execution evidence

The assignment supplies [Foundation run 43258837891, job 131324463849](https://github.com/Jones-Systems/HQ/actions/runs/43258837891/job/131324463849)
at exact base `212e5bb068c78a261e9f94b3540c0a40cefce3fd`:

- Foundation build and root Vitest pass; Wiki reports 825 pass, 0 fail,
  1 cancelled, 0 skip. The reader/stale corrections pass.
- The combobox file cancels after `36353ms` with a pending-promise/event-loop
  cancellation. Its first two tests pass; the third combined keyboard test does
  not complete. This does not identify which await is pending.

These are supplied hosted results, not a new execution or live CI readback by
this task. Source inspection confirms that
`f6746f5fd7360e951684e22a4cf18038786aab46` moved the first keyboard fixture's
`await app.unmount()` into `finally`, after `clock.restore()`. That consistent
cleanup change is already in the base and did not resolve the supplied
cancellation. It is not presented as a proven cause or fix.

## Static call-chain facts and remaining hypotheses

Read `view-combobox.ts`, `view-search.ts`, `view.ts`, `search-data.ts`, both
production/test `chrome.ts`, and test `render.ts`, `support.ts`, `dom.ts`.
The exact lockfile versions are React `19.3.1`, React DOM `19.3.1`, happy-dom
`21.0.3` and scheduler `0.28.0`. Lockfile versions do not prove installed or
runtime behavior.

- `launch()` awaits mounting through async React `act`, then `settle()`.
  `settle()` awaits a global `setTimeout(0)`. Each keyboard fixture enables its
  fake clock only after launch, and restores it before unmounting and launching
  the next fixture. The keyboard test does not directly call `settle()` under
  its active fake clock.
- `suggest()` awaits `typeInto()`'s async `act`, then `clock.advance(150)`.
  The clock mocks only global `setTimeout`; advance awaits an `act` around the
  tick, then `flush()`'s async `act` with promise turns and `setImmediate`.
- `press()` dispatches the key inside async React `act` and returns its handled
  flag; it does not call `settle()`. Arrow keys change selection. Ctrl+Enter and
  plain Enter navigate to results; active-option Enter navigates to the reader.
  Escape first closes suggestions, then clears the draft.
- Navigation updates shell/session state and mounts content. The view's focus
  effect may focus a heading or create a mutation observer and a 4000 ms cleanup
  timer. Debounce/idle paths contain 150/200/600 ms timers. Their presence does
  not prove any of these timers blocks the reported await.
- `Launched.unmount()` delegates to `Mounted.unmount()`, which awaits async
  `act` around `root.unmount()` and then removes the container; no `settle()` is
  called there. All four existing clock-before-unmount orders are preserved.

React/DOM internal scheduling during navigation/focus remains a hypothesis,
alongside launch, suggestion, key-dispatch and teardown boundaries. Static
inspection has not proved the pending await or a source-level cause. No
production/helper fix or out-of-cone literal hunk is justified yet.

## Diagnostic checkpoint

Only the third test receives direct fixed-string `console.error` calls: a start
and completion label plus 26 before/after pairs. They bracket all 22 existing
top-level awaits and the four synchronous clock restores. Fixture prefixes are
`ctrl-enter`, `active-enter`, `plain-enter` and `escape`; arrow first/wrap/next,
Enter, Escape close/clear, launch, suggest, restore and unmount are distinguished.
All lines share `[combobox-await]`. A complete third test emits at most 54 label
lines, with 2251 payload bytes including newlines before reporter decoration.

The calls write directly as each boundary is reached, rather than relying on
test-context diagnostics buffered until completion. No async wrapper, new yield,
timer, watchdog, keepalive, timeout change, retry, skip or error suppression was
added. All original assertions and control flow remain: debounce counts, ARIA
focus and selection, exact canonical navigation requests, handled/cancel guards,
history and all other tests. Shared helpers and production source are unchanged.

For the later hosted trace:

1. Preserve ordered labels and the Node failure details on the exact composed
   head. A `:before` without its matching `:after` identifies the entered call
   that did not return normally; distinguish rejection/assertion failure from
   the pending-promise cancellation using the failure record and cleanup labels.
2. A pending `:launch` still contains mount/settle, and a pending `:suggest`
   contains type/advance; it would justify narrowly instrumenting that specific
   nested boundary under a new grant, not guessing which internal await blocked.
   A missing restore `:after` concerns a synchronous operation, not an await.
3. `keyboard:done` means all four fixture lifecycles returned. It does not prove
   the rest of the file/suite passes. If the failure moves or disappears, report
   that observation without claiming a root cause or repair.

## Source-only checks and verifier obligations

`git diff --check` passes. A static byte comparison strips exactly the 54 new
fixed-label lines and reproduces the base test file byte-for-byte; it also
confirms unique labels, paired boundaries, confinement to the third test and
immediate labels around every existing top-level await. SHA-256 values:

- Base test: `5582f8bd061cd69af90410d75904d6094622d1c308cedd5046337ae8b74eb718`
- Diagnostic test: `1f074df0910680c63f33385d06d176761622adb2d8d6f2a38ea539059eb20c46`

`node --check modules/wiki/ui/test/combobox.test.ts` passes with local Node
`v26.12.1`, without importing or executing the test or application. This is
syntax-only evidence, distinct from the required CI Node `24.19.0` runtime,
typechecking and behavior. Final diff/scope checks cover only the two granted
paths. No new scratch, test resource or retained build was created.

No tests, regressions, typechecks, builds, compilers, dependency installs,
services, browser/native actions or shared-lock operations ran. Hosted CI is
the current execution evidence. The ordinary Mini controller remains nonpass
under the assignment's escaped-pipe evidence; its separate repair does not
qualify an HQ local producer here.

The parent owns composition into the existing recovery PR and the next hosted
Foundation run. Capture this trace before selecting a minimal repair. All
required fast checks, full Wiki discovery and portable acceptance/storage
stages still need exact composed-head results; existing pass evidence cannot
qualify this new head. Local serial/native/UI qualification remains separately
admitted and outstanding. No PR/watch or manual peer message is created here.
Recorded P2-P4 findings remain unselected. Private Wiki, live posting, export,
generation/component enablement, signing, installation, deployment, main and
merge holds remain in force.
