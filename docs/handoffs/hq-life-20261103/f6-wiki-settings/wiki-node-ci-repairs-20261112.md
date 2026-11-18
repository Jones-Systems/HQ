# Wiki Node CI repairs — source receipt

Artifact Type: implementation-receipt
Artifact ID: receipt.hq-wiki-node-ci-repairs-20261112
Authority effect: none

## Binding and scope

Repository: `Jones-Systems/HQ`. Branch:
`work/hq-recovery-wiki-node-ci-repairs-20261112`. Exact initial base:
`ef1d0395efef1786d22a7c04f47fe55a40fbebdc`. Initial status was clean in the
assigned isolated worktree; this builder is its sole Git owner. Other worktrees
and unrelated source are preserved. Explicit builder role fallback; no children.
Captured Blended Frontier Max preference revision 11; source building uses the
assigned Sol/high/default selection without Fast. Preference status is routing
metadata, not observed provider execution proof.

Read the repository agreements, bootstrap, progressive integration spec recovery
amendment, current recovery Work Note, Wiki UI map and accepted Wiki design.
The local `.agents/shared-guidance.md` bridge is absent; local shared enrollment
is unavailable and no replacement was installed. Maintained frontend guidance
was read at `b59d310cae8472ae8ed42d4d8562d08c362379d8`. This change updates test
source inside the accepted design; it creates no new presentation or layout.

## Failure diagnosis and source changes

Reported evidence: Foundation run `43255778224`, job `131313542934` passed
build and root Vitest, then reported three failed Wiki tests and one cancelled
file. Those supplied results describe the earlier candidate, not this repair.

1. **Combobox cancellation.** The third test is the sole case in this file
   awaiting `app.unmount()` inside the fake-clock `try`, before restoration.
   Its subsequent three fixtures and all other clocked tests restore before
   teardown. Move that unmount into `finally`, after `clock.restore()`, also
   ensuring teardown occurs if an assertion throws. All arrow/wrap/Enter/
   Ctrl+Enter/Escape, debounce and invalid-input assertions remain intact.

   Timer-boundary inspection: `suggest` uses `typeInto` (async React `act`, no
   explicit timer), then `clock.advance` (tick inside `act`, then `flush`).
   `press` uses `act` without an explicit timer; `tap` and `historyLabels` use
   `flush`, which uses microtasks and `setImmediate`, outside the mocked API.
   `launch`, `external`, `rerenderAppearance`, `release`, `click` and `submit`
   use `render.settle`, whose zero-delay `setTimeout` would remain unresolved
   under the fake clock unless advanced. In this third test, initial `launch`
   precedes fake-clock creation and none of those other settle callers runs
   while the clock is active. `Launched.unmount` delegates directly to
   `Mounted.unmount`: async React `act(root.unmount)`, then container removal;
   **it does not call `settle`**. Production debounce cleanup clears timers,
   and view observer cleanup disconnects observers and clears expiry timers.

   The teardown clock-ownership inconsistency is corrected, but the supplied
   file-level cancellation has no await-level trace. Source alone does not
   identify which React/DOM internal promise remained pending, or prove that
   this was the runtime stall. That exact-await diagnosis and completion of all
   four keyboard fixtures remain verifier obligations. No dependency code is
   installed here; no timeout, retry or product liveness workaround is added.
   Actual production combobox path is `ui/src/view-combobox.ts`, not the offered
   `ui/src/combobox.tsx`; no production change is evidenced or made.

2. **Reader method set.** `view.ts` mounts `useWikiStatus`; `status.ts` reads
   `listSources` and `indexStatus` for repository chrome. The accepted design
   requires that status on the reader as well as Home. Keep a closed exact
   four-call list (one call each), with exact logical-key arguments for both
   page and backlinks and zero arguments for both status reads. Contract
   rejection assertions remain. Extra methods, raw/source-path arguments and
   mutation calls still fail; arbitrary service access is not allowed.

3. **Stale-search heading.** The accepted design's Results page explicitly
   names the heading `Results for “query”`; `view-search.ts` implements it, and
   current combobox tests already assert it. Update the one obsolete precise
   label. Keep both deferred response-order tests, exact retained hit-list
   equality and the new-query heading check after the old response resolves.

4. **Stale repository filter.** The accepted design uses toggle chips with
   `aria-pressed`; the obsolete checkbox selector cannot reach the current
   control. Use the existing `chrome.filterChip` helper. Keep the two deferred
   requests and newer-before-older resolution order, exact three-hit count and
   BusinessLessons-only assertion. Add exact outbound requests (unfiltered,
   then `namespaces: ['bl']`) and chip-state assertions, so a forged filtered
   response cannot conceal an incorrect production request.

## Exact changed paths and source checks

- `modules/wiki/ui/test/combobox.test.ts`
- `modules/wiki/ui/test/reader.test.ts`
- `modules/wiki/ui/test/stale.test.ts`
- `docs/handoffs/hq-life-20261103/f6-wiki-settings/wiki-node-ci-repairs-20261112.md`

Static source/call-chain inspection and final diff review completed.
`git diff --check` passed. No tests, syntax parser, compiler/typecheck, build,
dependency install/download, service, browser, app, native journey, private-data
execution or compiler-lock operation ran. No tests were added, removed, skipped
or retried; no timeout or assertion tolerance changed. Test titles/selectors
follow the accepted design while behavior oracles remain or become stricter.
The clock repair is a source candidate, not a claimed passing cancellation fix.

## Test ownership and later verification

Existing `.github/workflows/foundation.yml` owns the entire Wiki Node suite via
`npm test --workspace @hq/wiki`. `modules/wiki/package.json` already discovers
all UI tests; there is no new inventory row or workflow request. Helpers
`chrome.ts`, `render.ts` and `support.ts` remain unchanged.

Only the separately admitted Mini verifier may execute these commands, with
Node 24.19.0, installed locked prerequisites, fresh capacity admission and its
qualified process/lock controls. Run serially from the HQ candidate root:

```sh
node --test --test-concurrency=1 modules/wiki/ui/test/combobox.test.ts modules/wiki/ui/test/reader.test.ts modules/wiki/ui/test/stale.test.ts
```

Then full Wiki discovery, from `modules/wiki` in that same candidate:

```sh
node --test --test-concurrency=1 'contract/test/*.test.ts' 'core/test/*.test.ts' 'core/scripts/test/*.test.ts' 'ui/test/*.test.ts' 'app/test/*.test.ts'
```

These are future commands, not executed evidence or a grant to start them.
Confirm all keyboard subcases finish and no file/test is cancelled or skipped.
If cancellation persists, retain the original failure and capture the exact
await boundary under the verifier's authority before any further repair; do not
increase timeouts or retry blindly. Full required fast CI on the assembled head
remains the integration owner's responsibility.

## Limitations and shared hunk requests

No outside-cone hunk is needed. Exact async-stall attribution and executable
qualification remain outstanding. Source completion does not qualify behavior,
native layout, accessibility, reference return, activation, installation or
release. All UI map entry points and shared consumers remain unverified here.
Private Wiki, live posting, export/generation/component/native activation,
signing, install, deployment, main and merge holds remain. Recorded unselected
P2–P4 findings were not repaired. Parent retains the composition PR; this lane
creates no PR or watches. Earlier rejected reservations are not retried.
