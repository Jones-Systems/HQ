# Work durable capture source checkpoint

Artifact type: work-note
Artifact ID: note.hq-work-durable-capture-20261112
Purpose: Adopt registered device persistence for HQ capture drafts.
Consumers: Recovery coordinator, independent correctness reviewer, serial Mini verifier
Authority effect: none

Base: `3bb13af3b3872bf52ad04606be9d0540d84810b3`.
Branch: `work/hq-recovery-work-durable-drafts-20261112`.
Canonical repository: Jones-Systems/HQ, existing HTTPS origin preserved.
Dedicated non-main worktree, clean base and sole Git ownership were bound before
writes. No ancestry merge was needed. Implementation-role fallback uses the
codex-v3-builder scope, no subagents. Requested Blended Frontier Max, explicit
owner pin, captured personal preference revision 11, Sol/high, default tier,
no Fast; these are requested settings, not runtime/tier attestation.

Accepted amendment and current Work Note read at
`e9db4f61b0688f3727e4be4e37d00521131fc6f3`; SHL module-wiring and WRK-Q selected
P1 repair receipts read. Shared bridge is absent; no enrollment was installed.
Canonical Frontend-Development main was read and re-resolved at
`b59d310cae8472ae8ed42d4d8562d08c362379d8`; only guidance was consumed.
No private source was copied.

## Owned implementation

- `modules/work/capture/drafts.ts`: optional `durableDrafts` slot, eager single
  claim with `ready()`, synchronous add/discard refusal before restore, explicit
  send waiting for restore, preserved no-slot synchronous memory behavior.
  Validate stored draft IDs, timestamps, error/handoff metadata and Planner
  fields without normalizing user input or allocating Planner intent IDs.
  Any malformed/duplicate row blocks mutation and keeps the hub's raw rows;
  unreadable data never falls back to an empty writable store.
- Restored numeric IDs advance allocation, with a renderer counter shared by
  durable handles so separate projects cannot generate the same new ID.
  Hub first-claim behavior is unchanged; stored drafts are not duplicated into
  every project. Restored drafts sort by creation timestamp.
- Status distinguishes loading, blocked, pending save, failed save, saved and
  session-only. `settle()` supplies an explicit observation boundary. Hub
  failure notifications never certify a save; only the current save generation's
  settled success does. Failed saves retain draft input in memory.
- Durable explicit send first saves a `handoff: true` marker, then calls core
  create. A stale on-disk copy after crash or failed removal cannot issue a
  fresh create on restart. A held copy is visibly explained and never replayed.
  Known Planner refusals clear the marker; saved/unknown outcomes remove the
  local draft. Unknown create remains owned by core with its existing intent ID.
  There is no automatic send, reconnect-send, replay or new Apply authorization.
- `modules/work/capture/QuickCapture.tsx`, `DraftsPanel.tsx`, `index.ts`:
  truthful scope/status text, guarded unavailable actions, associated persistent
  reasons, and full-dialog text retained on restore refusal. Existing layout,
  CSS, gutters, motion and accepted components remain.
- `modules/work/nav/session.ts`: passes `durableDrafts(port)` to createDraftStore
  and corrects stale session-only documentation. No desktop hunk needed.
- Exact additive core grant: `DurableDrafts` gains `settle`, `status`, `onStatus`;
  `hub.drafts()` delegates those to the existing hub save/status/listener paths.
  No pump, queue aggregation, parsing, claim ordering, store, adapter, live,
  Planner queue hold or quit-drain algorithm was edited.

A crash between the handoff-marker save and core's create may conservatively
hold a copy even if no create started. No inference authorizes retry: inspect
core recovery and Planner state before manually disposing of that copy. This
tradeoff prevents accidental duplicate creates without inventing a replay API.

## Source regression files (all UNRUN)

- `modules/work/capture/test/durable-drafts.test.ts`: delayed restore mutation
  refusal and send ordering; restart restore/discard and ID collision; shared
  project first claim and unique IDs; malformed/duplicate rows; unreadable load;
  delayed/failed save retaining text and no dispatch; unknown core handoff with
  failed removal save, restart and no second create; no-slot compatibility.
- `modules/work/capture/test/durable-capture.test.tsx`: typed text retained during
  pending/unreadable restore, disabled reason association and no Planner write.
- `modules/work/nav/test/durable-capture.test.ts`: production session adoption,
  per-project cache, single shared-hub load, no restore send or save.
- `modules/work/core/test/draft-hub.test.ts`: status/settlement wrappers and
  listener unsubscribe, including device refusal and subsequent explicit settle.

Existing assertions were not weakened, skipped or deleted. No failing-before
or passing behavior evidence is claimed; execution is explicitly held.

## Exact caller hunk requested before composition

`modules/work/nav/ToolbarCapture.tsx` is outside this capsule's write grant and
was not edited. Its existing synchronous `drafts.add(fields())` may refuse
while load is pending or unreadable. It also retains session-only scope copy.
The parent must assign the following bounded caller adaptation to its owner
before claiming the whole production capture flow complete:

```diff
-import { DRAFT_LABEL, DRAFT_SCOPE_NOTE, landCapture, suggestDate } from '../capture';
+import { DRAFT_LABEL, draftScopeNote, useDrafts, landCapture, suggestDate } from '../capture';
```

After the handler's existing `session` destructuring, add:

```tsx
const draftState = useDrafts(drafts);
const draftBlocked = draftState.durability === 'loading' || draftState.durability === 'blocked';
```

Inside `keepAsDraft`, replace the add and feedback lines, before clearing UI:

```tsx
if (ui.getState().capture.sending) return;
try { drafts.add(fields()); }
catch (cause) {
  ui.setCapture({ error: cause instanceof Error ? cause.message : 'Could not keep this draft. Keep your text open.' });
  return;
}
feedback.push({ message: `Kept “${title}” as an HQ draft`, meta: `${DRAFT_LABEL} · ${draftScopeNote(drafts.getState())}`, tone: 'info' });
```

Replace its unavailable banner span/button with:

```tsx
<span id={`${id}-draft-reason`}>You can keep this capture as an HQ draft. {draftScopeNote(draftState)}</span>
<Button size="sm" variant="primary" type="submit" aria-disabled={draftBlocked || capture.sending} aria-describedby={`${id}-draft-reason`}>Keep as HQ draft</Button>
```

Add the matching toolbar regression in its owner's cone: refusal preserves UI
text and shows the reason; success reports saving before settlement, saved
only after settlement, and failure leaves the local draft. This requested
caller hunk is a real integration gap, not a source-completion claim.
No further core API or shared desktop/configuration/contracts hunk is requested.

## Verification and review hold

`git diff --check` and Node v26.12.1 `--check` on changed/new `.ts` files pass
without importing application or test code. This syntax evidence is not pinned
CI evidence. TSX parser prerequisites are absent locally; TSX syntax, semantic
typechecking, tests, builds and runtime behavior remain UNRUN.
Final diff and write cone inspected. No root/lock/config/workflows, desktop,
planning views/board/detail, acceptance or unselected findings were changed.
No builds, tests, dependency installs, servers, app/browser/native launches,
real/private data, posting, activation, signing, installation, deployment,
PRs or foundation/main merges occurred.

Independent correctness review is requested through the parent before
composition, particularly restore/mutation races, shared-hub first claim and ID
allocation, failure truthfulness, and interrupted/unknown handoff safety. The
serial Mini verifier owns subsequent focused tests, root typecheck/required
checks, real persistence/restart and assembled-head qualification. Layout,
responsive states, enlarged text, accessibility, keyboard/focus, reduced motion,
native behavior, fidelity, presentation export and gallery/captures remain
unverified. No fake screenshots or export completion is claimed.
The recorded P2 E2E cleanup race and historical B1 baseline/older-state/
quit-drain/hash/G11 findings remain unselected and unwaived.
