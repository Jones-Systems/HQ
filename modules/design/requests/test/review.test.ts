import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ClaimId } from '../src/contract.ts';
import { linkOf } from '../src/draft.ts';
import { reviewCandidate } from '../src/review.ts';
import { candidate, env, evidence, readyDraft } from './fixtures.ts';

const packetKey = (requestId: string) => `design/requests/${requestId}/packets/000001`;
const draftKey = (requestId: string) => `design/requests/${requestId}/draft`;

async function frozen() {
  const e = env();
  const ready = await readyDraft(e);
  const packet = (await ready.session.freeze())!;
  return { e, ...ready, packet, returned: candidate(linkOf(packet)) };
}

test('freezing and reviewing never trigger dispatch; only an explicit send reaches the spy', async () => {
  const { e, session, packet, returned } = await frozen();
  assert.equal(e.dispatch.calls.length, 0, 'freeze: zero connector calls');
  await session.review(returned, 'defer', 'Later');
  assert.equal(e.dispatch.calls.length, 0, 'review: zero connector calls');
  e.dispatch.requestSend(linkOf(packet)); // what the explicit Send button does
  assert.deepEqual(e.dispatch.calls, [linkOf(packet)]);
});

test('claim levels stay distinct and owner judgments are additive', async () => {
  const { session, returned } = await frozen();
  const initial = reviewCandidate(returned, session.state.reviews);
  assert.deepEqual(initial.claims['agent-reported'].map((claim) => claim.claimId), ['claim-spacing']);
  assert.deepEqual(initial.claims.observed.map((claim) => claim.claimId), ['claim-capture']);
  assert.equal(initial.decision, null);

  await session.review(returned, 'defer', 'Check on mobile first.', [{ claimId: 'claim-spacing' as ClaimId, judgment: 'disputed' }]);
  await session.review(returned, 'accept', 'Looks right.');
  const folded = reviewCandidate(returned, session.state.reviews);
  assert.equal(folded.decision, 'accept');
  assert.deepEqual(folded.history.map((event) => event.decision), ['defer', 'accept'], 'decisions are appended, not replaced');
  const judged = folded.claims['owner-judged'][0]!;
  assert.equal(judged.claimId, 'claim-spacing');
  assert.equal(judged.reportedLevel, 'agent-reported');
  assert.equal(judged.judgment, 'disputed');
  assert.equal(folded.claims['agent-reported'].length, 0);
});

test('decision events are durable across restart', async () => {
  const { e, requestId, session, returned } = await frozen();
  await session.review(returned, 'accept', 'Ship it.');
  const { session: reopened } = await e.restart(requestId);
  assert.deepEqual(reopened.state.reviews.map((event) => event.decision), ['accept']);
  assert.deepEqual(reopened.state.candidates, [returned]);
});

test('revise creates a linked new draft and keeps the original evidence', async () => {
  const { e, requestId, session, packet, returned } = await frozen();
  const packetBytes = e.storage.peek('workspace', packetKey(requestId))!;
  session.edit({ type: 'set-intent', intent: 'Unsent note kept through revise.' });
  const event = (await session.review(returned, 'revise', 'Spacing still too loose on mobile.'))!;
  const draft = session.state.draft!;

  assert.equal(draft.origin, 'revision');
  assert.equal(draft.draftId, event.revisionDraftId);
  assert.deepEqual(draft.continuesFrom, linkOf(packet));
  assert.deepEqual(draft.review, { reviewEventId: event.eventId, candidateId: returned.candidateId });
  assert.equal(draft.intent, 'Unsent note kept through revise.', 'unsent edits carry forward');
  const ids = draft.evidence.map((item) => item.evidenceId);
  assert.deepEqual(ids.slice(0, packet.evidence.length), packet.evidence.map((item) => item.evidenceId), 'original evidence first and intact');
  assert.ok(ids.includes(`candidate.${returned.candidateId}` as never) && ids.includes(evidence('ev-cand-capture').evidenceId));
  assert.deepEqual(e.storage.peek('workspace', packetKey(requestId)), packetBytes, 'reviewed packet unchanged');

  const next = (await session.freeze())!;
  assert.equal(next.lineage.origin, 'revision');
  assert.deepEqual(next.lineage.review, draft.review);
  assert.deepEqual(next.supersedes, linkOf(packet));
});

test('an interrupted revise is rebuilt to the same draft on reopen', async () => {
  const { e, requestId, session, returned } = await frozen();
  e.storage.crashAt({ op: 'write', stage: 'rename', key: (key) => key === draftKey(requestId) });
  const event = (await session.review(returned, 'revise', 'Again'))!;
  assert.ok(event, 'the appended event is authoritative');
  const { session: reopened } = await e.restart(requestId);
  assert.equal(reopened.state.draft!.draftId, event.revisionDraftId);
  assert.equal(reopened.state.draft!.origin, 'revision');
  assert.match(reopened.state.recovered.join(' '), /interrupted revise/u);
});

test('a candidate for another packet digest is rejected and nothing is appended', async () => {
  const { session, packet, returned } = await frozen();
  const forged = { ...returned, packet: { packetId: packet.packetId, authoringDigest: `sha256:${'0'.repeat(64)}` as never } };
  assert.equal(await session.review(forged, 'accept'), null);
  assert.match(session.state.error ?? '', /does not match a frozen packet/u);
  assert.equal(session.state.reviews.length, 0);
});

test('a superseded packet can be accepted or deferred but not revised', async () => {
  const { session, returned } = await frozen();
  session.edit({ type: 'set-title', title: 'Second pass' });
  await session.freeze();
  assert.equal(await session.review(returned, 'revise'), null);
  assert.match(session.state.error ?? '', /latest packet/u);
  assert.ok(await session.review(returned, 'defer'));
});
