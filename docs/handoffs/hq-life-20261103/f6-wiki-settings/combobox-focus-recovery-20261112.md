# Wiki combobox focus fixture recovery, 2026-11-12

Artifact type: diagnostic-receipt
Artifact ID: receipt.hq-wiki-combobox-focus-20261112
Purpose: Repair the source-evidenced focus precondition without claiming the cancellation's exact cause.
Owner: Scoped Wiki debugger/builder; explicit implementation-agent fallback; sole Git owner: Codex
Consumers: Recovery coordinator and hosted Foundation verifier
Authority effect: none

## Binding and guidance

The assigned isolated worktree was clean at exact base
`6e933a2dfeb859e8a9bef289f181e9b58c841a4f`, on
`work/hq-recovery-wiki-combobox-focus-20261112`, with canonical origin
`https://github.com/Jones-Systems/HQ.git`. Only these paths change:

- `modules/wiki/ui/test/combobox.test.ts`
- `docs/handoffs/hq-life-20261103/f6-wiki-settings/combobox-focus-recovery-20261112.md`

Requested selection: Blended Frontier Max revision 11, Sol/max, default tier,
no Fast. Local preference status confirms the inherited mode/revision, not
effective provider execution. No children were launched; other worktrees remain
read-only and other owners' source is preserved.

Read HQ agreements, bootstrap, current recovery Work Note and recovery amendment,
the prior combobox diagnosis, Wiki UI map/shared consumers and shared test-value,
performance and scratch rules. The local shared-guidance bridge is absent;
no bridge or enrollment was installed. Current canonical Frontend-Development
main resolves to `b59d310cae8472ae8ed42d4d8562d08c362379d8`; its agent instructions,
README, custody and UI view-map guidance were read at that revision. This
test-only change alters no accepted presentation or production focus behavior.

## Supplied hosted evidence and its limit

The assignment supplies [Foundation run 43261322245, job 131333083038](https://github.com/Jones-Systems/HQ/actions/runs/43261322245/job/131333083038)
at exact `6e933a2dfeb859e8a9bef289f181e9b58c841a4f`: build and root Vitest pass;
Wiki reports 825 passed, zero failed and one cancelled. Design, Social, Planner
and CLI pass. These are supplied results, not a fresh CI execution or live
readback by this task, and do not qualify this candidate.

The supplied ordered trace contains only:

```text
[combobox-await] keyboard:start
[combobox-await] ctrl-enter:launch:before
[combobox-await] ctrl-enter:launch:after
[combobox-await] ctrl-enter:suggest:before
[combobox-await] ctrl-enter:suggest:after
[combobox-await] ctrl-enter:down-first:before
[combobox-await] ctrl-enter:down-first:after
```

There is no `ctrl-enter:up-wrap:before` or `finally` restore label. The file
cancels after `38513ms`, reporting a promise still pending after the event loop
resolved. `press(field, 'ArrowDown')` has returned at the last observed label.
The next source region is synchronous: selected index equals zero, active
descendant equals the first option's ID, then strict DOM object identity between
`activeElement` and `field`. This locates an assertion region rather than an
entered next await; it does not prove which assertion or internal operation
caused cancellation. React/DOM object assertion formatting remains an unverified
hypothesis. The earlier clock-before-unmount candidate did not resolve the
supplied cancellation and is not its established cause.

## Source-supported fixture candidate

`render.ts:typeInto` sets the input value and dispatches input inside React
`act`, without focusing it. `chrome.ts:press` dispatches a key inside `act`,
without focusing its target. `SearchBox`'s arrow handler changes selection and
ARIA state, without moving DOM focus. `view.ts` deliberately skips navigation
focus on first mount. The existing keyboard fixture never called `field.focus()`.
It therefore omitted the user-focus precondition for its focus-retention oracle.

The first keyboard fixture now focuses its exact captured field synchronously
before typing. That input has no focus handler, and the top-bar ancestors have
no focus handler; its blur handler only closes suggestions. No additional React
state interaction or `act` wrapper is introduced. Typing and key handling keep
their existing `act` helpers. An exact-identity boolean assertion immediately
before ArrowDown checks the precondition survives suggesting; another after
ArrowDown preserves the original exact-field identity oracle. Both compare
`activeElement === field`, rather than passing DOM objects to assertion
formatting. They do not accept any other input as the focused element.

There is one focus call, before typing, and none after ArrowDown. A production
focus regression is not masked by refocusing. Selection, wrap, active-descendant,
canonical navigation, handled-key guards and all four original keyboard fixture
lifecycles remain. No production, helper, workflow, root or dependency edit is
needed. No timer workaround, timeout increase, retry, keepalive, skip, assertion
removal or error suppression is added.

Separately, all 54 broad diagnostic lines are removed; no labels remain. Static
reversal of just the focus call, added precondition and boolean reformulation
reproduces the base test byte-for-byte after stripping its 54 labels. The other
seven tests and all remaining keyboard behavior/cleanup source are unchanged.
The focus-fixture gap is supported by source; whether this candidate resolves
the hosted cancellation, and its exact runtime cause, remain unverified.

## Static checks and execution owner

- `git diff --check` succeeds; final scope/diff inspection covers the two granted paths.
- `node --check modules/wiki/ui/test/combobox.test.ts` succeeds with existing local
  Node `v26.12.1`, without imports or test/application execution. This is syntax
  evidence, not CI Node `24.19.0` behavior or typechecking.
- Static byte reversal confirms all eight test declarations, all four keyboard
  fixtures and every other assertion/control-flow line are retained.
- Base test SHA-256: `1f074df0910680c63f33385d06d176761622adb2d8d6f2a38ea539059eb20c46`.
- Candidate test SHA-256: `7d8422ddfebb1e7f877704ed3c5b600254088ded6ea3e4b37f93c2e4673c81de`.

Existing execution owner is `.github/workflows/foundation.yml`, job
`Foundation typecheck, tests and build`, step `Test Wiki with the Node test
runner`: `npm test --workspace @hq/wiki`. The package's existing
`ui/test/*.test.ts` glob discovers this file. Node `24.19.0`, full discovery,
six-minute job timeout, preceding build/root Vitest and following portable
acceptance/storage stages remain unchanged. No new inventory row or hook is
needed. Parent owns composition into recovery PR #213 and fresh composed-head
CI; this lane creates no PR, watch or manual other-thread message.

No tests, typechecks, builds, compilers, installs, runtime downloads, services,
browser/native actions, private-data access or shared-lock operations ran. No
scratch or build output was created. Other-lane runtime preparation stays at
version probes only; no private runtime was reused. The ordinary controller's
two gating P1 holds and executable qualification remain unchanged. All recorded
P2-P4 findings stay unselected and unwaived. Full required CI and later admitted
Mini/native, accessibility, layout and assembled-head journeys remain outstanding;
no candidate behavior pass is claimed. Preserve private Wiki, live posting,
export/generation/component enablement, signing, installation, deployment,
activation, integration-owner, foundation-to-main and all original merge holds.
