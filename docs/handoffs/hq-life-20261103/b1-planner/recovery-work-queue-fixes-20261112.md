# WRK-Q selected P1 repair source receipt

Artifact Type: work-note
Artifact ID: note.hq-work-queue-fixes-20261112
Purpose: Supply the selected P1 repairs for independent fix-scoped re-review.
Decision owner: M Jones
Consumers: Recovery coordinator, independent correctness reviewer, Mini serial verifier
Authority effect: none

Base reviewed checkpoint: `8548eb89283bd9f44608da9489ae23db133da885`.
Task branch: `work/hq-recovery-work-queue-fixes-20261112`.
Accepted recovery amendment read at `e9db4f61b0688f3727e4be4e37d00521131fc6f3`.
Implementation uses the bounded codex-v3-builder role fallback; no child agents.

## Review responses and causal evidence

1. P1 health entry point: the prior checkpoint receipt specifies direct
   `live/health` imports and retains the WSP-owned live index. No consumed
   contract requires a barrel export. Remove the contrary `live.probePlanner`
   assertion and index import; keep the complete synthetic version-route and
   no-mutation/no-replay behavior assertions and all outcome cases. No change
   to health source or `live/index.ts` is requested.
2. P1 queue hold: previously, `request_id_reused` rejected A and returned
   `stop` only for that flush. Both `flush` and `nextSendable` ignored the hold,
   so B could drain on the next call/reconnect. Restore kept rejected A but
   never reconstructed `state.held`. Now drain admission, selection and each
   send attempt honor the hold, including after the persistence await. If a
   hold arrives while the sending marker saves, the unsent entry returns to
   its original queued body and identity, then its durable save settles.
   Restore reconstructs the hold from the already-persisted v1 rejected
   `request_id_reused` entry; no persistence schema/interface change is needed.
   Existing explicit discard and unconfirmed-dismiss release paths remain.

## Authored regression coverage, UNRUN

- Extend the existing A/B rejection case with repeated explicit flushes and
  offline/reconnect, asserting no B send, no changed queue identity and no
  request-ID allocation while held. Explicitly discard A, then assert B sends
  once with a distinct identity.
- Round-trip the rejected A/queued B document through a fresh durability hub
  and store. Load, flush repeatedly and reconnect; assert no writes or new
  identities while held. Discard A and assert exactly one B send.
- Gate the durable sending-marker save, obtain a reused-ID recovery answer
  concurrently, then release the save. Assert no dispatch, original queued
  identities persisted, and explicit dismiss permits exactly one send per
  queued entry with distinct IDs.

Failing-before execution is UNAVAILABLE under the held Mini serial slot.
These scenarios are causal source regressions, not measured passing behavior.
The serial verifier must run typecheck and focused Work core/live tests, then
follow the original checkpoint's assembled-head verification requirements.

## Static evidence and boundaries

`node --check` parses each of the four changed TypeScript files without
importing or executing application/test code. `git diff --check` passes;
final source/test diffs inspected. Typecheck, tests, builds, fixture execution,
servers and native/browser checks are UNRUN. No PR or integration merge.
No dependency, shell, main, contracts, workflows, root configuration, live index
or adapter edits. Durability and core index source remain unchanged.

The unselected P2 background-device-save cleanup in the desktop integration
test is unchanged. Historical B1 findings 3/4/5/7 and G11 retain their recorded
dispositions; no automatic P2-P4 repair or severity reinterpretation is claimed.
The historical restoration rule for unconfirmed recovery entries is unchanged;
this repair reconstructs the selected queued-rejection hold.

## Shared hunk requests

None added by this repair. SHL's durability-before-session wiring, direct health
import and Planner wording hunks remain exactly those in
`recovery-work-queue-20261112.md`; INT's WorkLocal main registration remains in
WSP's receipt. No live-index grant is needed. Independent fix-scoped Sol/max
re-review is still required; this source checkpoint does not qualify behavior.
