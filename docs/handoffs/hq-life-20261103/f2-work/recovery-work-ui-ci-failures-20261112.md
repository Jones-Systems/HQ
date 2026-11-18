# Work CI repair source checkpoint

Authority effect: none. Source only; no behavior qualification.

Code checkpoint: `8c9011b72187e118dc34a351a44a4f134098c7bc`.
Base: `9fc113c2d3ee9b8168f48f5e9f1eea636f143068`.
Branch: `work/hq-recovery-work-ui-ci-failures-20261112`.
Canonical repository: `Jones-Systems/HQ`; existing HTTPS origin preserved.
Accepted recovery amendment read at `e9db4f61b0688f3727e4be4e37d00521131fc6f3`.
Frontend guidance main resolved to `b59d310cae8472ae8ed42d4d8562d08c362379d8`.
Local shared bridge absent; no enrollment attempted. Assigned builder scope,
explicit Blended Frontier Max pin, Sol/high, default tier, no Fast; no children.

## Failure evidence and dispositions

Read the failed log for PR213 Foundation run `43246977249`, exact job
`131282152643`, once using bounded `gh run view --job --log-failed`.
The reported root build/typecheck success is upstream evidence, not a local run.
No latest-run polling, reruns or CI dispatches were performed.

| Failure | Source diagnosis and disposition |
| --- | --- |
| Board Done; capture confirmation; nav Undo; detail Saved/Undo; views success text | Shared viewport intentionally has visible toast text plus a dedicated live announcement. Visible content has group semantics, not a second live region. Assertions now select the named toast group, retaining exact text and existing write/inverse assertions. No blanket multiple-match query introduced. |
| Board plain Escape ghost | The explicitly unsupported-animation scenario did not establish absence of `animate`. It now explicitly supplies that missing capability. Other animation scenarios still install their recording stand-in and verify actual animation requests; no general animation bypass. |
| Board Alt+arrows | Exact failure is the glide assertion, not `preventDefault` or write count. happy-dom supplies zero geometry unless the test installs synthetic layout. Keyboard scenario now installs it; the fixture measures keyed card slots as well as card faces. The WAAPI stand-in exposes `finished`. Default prevention, one write, target status, focus and transform animation assertions are unchanged. |
| Board Undo toast removal | Shared dependency retained: ToastViewport keeps an inert exiting record whose old Undo remains discoverable in the test environment. Existing assertion remains strict. Kit owner must remove exited actions from accessibility/activation immediately while retaining visual exit. |
| Detail Why | Accepted design explicitly replaces native select with ChipPicker/Menu. Both conflict and Undo tests now open the named Why button and select the Need radio menu item. Patch/revision/value assertions retained. |
| Detail Area | Input now has a datalist and therefore combobox semantics. Tests use the accessible Area combobox, retaining blur save and conflict assertions. |
| Detail HQ provenance | Accepted source renders human-readable `Social · Draft`, not raw `HQ · social · draft`. Assertion follows that wording while retaining unresolved/read-only provenance, external link isolation and zero-port-call checks. Product wording itself is unchanged. |
| Toolbar eight-second expiry | At 8000ms a shared toast intentionally enters its inert exit; DOM removal follows animation completion. Tests require exit phase and inertness, dispatch animationend, then require removal. Ctrl/Meta inverse-once assertions remain. |
| Calendar Undo; views Undo | Accepted shared feedback names the undone action with `Undone: ...`, replacing the older generic `Undone.`. Tests target the named group and keep exact inverse patches/write counts. |
| Views error | The viewport contains a dedicated alert live region, including when empty. Test identifies the actual error StateView by its title then verifies its alert role and error state, rather than assuming only one alert exists in the whole document. |
| Views Saving/Saved | Shared StatusIndicator nests its label below the status container. Test verifies the Saving label's status ancestor is busy and the Saved label has a status ancestor, preserving the held-write transition. |
| Views unknown | Accepted persistent state is `1 unconfirmed` with contextual Check instructions. Test verifies no Saved claim, item Unconfirmed, instructions, and activates Check now with the original one-write count unchanged. No blind resend is introduced. |
| Views refused Undo persistence | The old first-text selector observed a departing success toast. Test now selects the named refusal, requires the newer-value-kept explanation, and verifies that same refusal after 16 seconds. |
| Work package boundary | Existing direct createPortal import is outside the package boundary. No allowlist weakening or shared-package edit performed; exact root-owner request below. |

Work feedback now explicitly retains its eight-second informational/success
lifetime rather than inheriting shared tone defaults (4/5 seconds without an
action). Danger, warning and unknown remain indefinite; unknown retains Check.
The existing toolbar persistence regression additionally covers unknown after
16 seconds with Check and no Retry/Apply. Pinned test names are unchanged.
No tests were removed, skipped, loosened with retries or given longer timeouts.
Recorded P2–P4 findings, durable capture and queue gates remain unmodified.

## Files and static evidence

Only `board/WorkToasts.tsx` changes production behavior. Matching tests changed:
`board/test/{board-alive,board}.test.tsx`, `board/test/host.tsx`,
`capture/test/capture.test.tsx`, `detail/test/detail.test.tsx`,
`nav/test/{toolbar-polish,undo}.test.tsx`,
`views/test/{calendar-timeline,views}.test.tsx`.

- `git diff --check`: pass.
- Allowed path and protected exclusion scan: pass.
- Changed-source relative import existence and conflict-marker scan: pass.
- Protected desktop/packages/core/live/session/capture/root/workflow paths compared
  to base: unchanged. No merge or history rewrite performed.
- TypeScript parser unavailable at the checkout dependency path; syntax parsing
  and semantic typecheck remain unrun. Text/import checks do not establish either.
- All tests/builds, package installs, servers, browser/native launches, private
  data, screenshots, exports/gallery, activation, signing, installation,
  deployment, PRs and foundation/main merges remain unrun or unperformed.

The serial verifier must run full Work/shared-UI tests and root checks on the
assembled head after admission. Specifically retain board Undo removal and
exit activation checks; keyboard glide/focus; chip-menu conflict and Undo;
Check without duplicate writes; expiry with animation completion; warning,
danger and unknown persistence. Layout, accessibility, reduced motion,
responsive/native fidelity and gallery/export evidence remain unverified.

## Exact shared-owner requests

1. ToastViewport: an exiting record must retain its visual animation while its
   content is hidden from accessibility and all actions are disabled/guarded.
   Keep the board Undo-removal oracle. Do not delete the live regions to resolve
   duplicate text assertions: the visible group and its one announcement are
   intentional. Confirm live-region revision updates do not double-announce.
2. Root/shared kit: provide the existing shared portal abstraction or an exported
   `Portal` wrapper around the package-owned React DOM portal. Apply this exact
   Work substitution only after that API exists (no package allowlist edit):

```diff
-import { createPortal } from 'react-dom';
-import { animateElement, prefersReducedMotion, StateView, useListMotion } from '@hq/ui';
+import { animateElement, Portal, prefersReducedMotion, StateView, useListMotion } from '@hq/ui';
@@
-      {ghostItem && createPortal(
+      {ghostItem && <Portal>
@@
-        </div>,
-        document.body,
-      )}
+        </div>
+      </Portal>}
```

No other desktop, root, contract or shared hunks requested. Source completion
of this bounded patch does not imply a green suite or assembled acceptance.
