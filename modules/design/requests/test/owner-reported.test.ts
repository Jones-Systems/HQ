import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { IdKind, IdPort } from '../src/contract.ts';
import { reviewCandidate } from '../src/review.ts';
import { RequestStore } from '../src/store.ts';
import { ValidationError, parseReturnedCandidate } from '../src/validate.ts';
import { StepClockFake } from '../src/fakes.ts';
import { env, frozenWithDestination, handoffKey, sendKey, versionless } from './fixtures.ts';

const candidateKey = (requestId: string, id: string) => `design/requests/${requestId}/candidates/${id}`;
const decoder = new TextDecoder();

test('an owner-reported return is labelled, versionless and limited to agent-reported claims', async () => {
  const { session, packet } = await frozenWithDestination();
  const stored = (await session.reportReturn({ packetId: packet.packetId, claims: ['I got a new heading screenshot.'], artifacts: [{ kind: 'note', label: 'Screenshot saved outside HQ' }], host: 'my-host' }))!;
  assert.equal(stored.provenance?.origin, 'owner-reported');
  assert.equal(stored.provenance?.host, 'my-host');
  assert.equal(stored.provenance?.model, undefined, 'a model the owner did not give is not filled in');
  assert.equal(stored.observedStatus, 'owner-reported');
  assert.equal(stored.candidateVersionId, null);
  assert.deepEqual(stored.claims.map((claim) => claim.level), ['agent-reported']);
  assert.deepEqual(stored.evidence.map((item) => item.kind), ['note']);
  const review = reviewCandidate(stored, session.state.reviews);
  assert.equal(review.claims.observed.length, 0);
  assert.equal(review.claims['owner-judged'].length, 0);
  assert.equal(session.inbox[0]!.origin, 'owner-reported');
});

test('the validator refuses every attempt to assert an observed, owner-judged or native claim', () => {
  const link = { packetId: 'p', authoringDigest: `sha256:${'a'.repeat(64)}` };
  const base = {
    candidateId: 'c', packet: link, baselineVersionId: 'v1', candidateVersionId: null,
    claims: [{ claimId: 'k1', text: 'Done.', level: 'agent-reported', evidence: [] }],
    observedStatus: 'owner-reported', observedAt: '2026-01-01T00:00:00.000Z', evidence: [],
    provenance: { origin: 'owner-reported' },
  };
  assert.ok(parseReturnedCandidate(base));
  const evidenceOf = (kind: string) => ({ evidenceId: 'e1', kind, label: 'x', digest: 'sha256:x' });
  const refused: [string, unknown, RegExp][] = [
    ['observed claim', { ...base, claims: [{ ...base.claims[0], level: 'observed' }] }, /cannot assert observed or owner-judged/u],
    ['owner-judged claim', { ...base, claims: [{ ...base.claims[0], level: 'owner-judged' }] }, /cannot assert observed or owner-judged/u],
    ['observation evidence', { ...base, evidence: [evidenceOf('observation')] }, /cannot carry observation or candidate evidence/u],
    ['candidate evidence', { ...base, evidence: [evidenceOf('candidate')] }, /cannot carry observation or candidate evidence/u],
    ['observation evidence inside a claim', { ...base, claims: [{ ...base.claims[0], evidence: [evidenceOf('observation')] }] }, /cannot carry observation/u],
    ['native status', { ...base, observedStatus: 'returned' }, /status owner-reported/u],
    ['a comparable version', { ...base, candidateVersionId: 'v2' }, /no comparable version/u],
  ];
  for (const [name, input, pattern] of refused) assert.throws(() => parseReturnedCandidate(input), pattern, name);
  // The same claims are fine for a connector return: the limits belong to owner-reported data only.
  assert.ok(parseReturnedCandidate({ ...base, provenance: { origin: 'connector' }, observedStatus: 'returned', claims: [{ ...base.claims[0], level: 'observed' }], evidence: [evidenceOf('observation')] }));
});

test('owner-reported returns are write-once: a colliding id never overwrites, and a new report is a new record', async () => {
  const { session, packet } = await frozenWithDestination();
  const first = (await session.reportReturn({ packetId: packet.packetId, claims: ['First report.'] }))!;
  assert.ok(first);
  const second = (await session.reportReturn({ packetId: packet.packetId, claims: ['Second report.'] }))!;
  assert.notEqual(second.candidateId, first.candidateId);
  assert.equal(session.state.candidates.length, 2);

  // Force an id collision at the store: the stored bytes must stay as first written.
  const e = env();
  const collision: IdPort = { next: (kind: IdKind) => (kind === 'candidate' ? 'cand-fixed' : `fx-${kind}-${Math.random()}`) };
  const ready = await (async () => {
    const created = await e.store.createRequest({ title: 'T', sources: [{ projectId: 'p' as never, viewId: 'v' as never, versionId: 'v1' as never, sourceRevision: 'r' }] });
    const s = await e.open(created.requestId);
    s.edit({ type: 'set-intent', intent: 'I' });
    const frozen = (await s.freeze())!;
    return { requestId: created.requestId, frozen };
  })();
  const store = new RequestStore({ storage: e.storage, clock: new StepClockFake(), ids: collision });
  await store.open(ready.requestId);
  const link = { packetId: ready.frozen.packetId, authoringDigest: ready.frozen.authoringDigest };
  await store.reportOwnerReturn({ requestId: ready.requestId, packet: link, claims: ['Only this.'] });
  const bytes = e.storage.peek('workspace', candidateKey(ready.requestId, 'cand-fixed'))!;
  await assert.rejects(store.reportOwnerReturn({ requestId: ready.requestId, packet: link, claims: ['Overwrite attempt.'] }), /write-once/u);
  assert.deepEqual(e.storage.peek('workspace', candidateKey(ready.requestId, 'cand-fixed')), bytes);
});

test('a manual return writes no send record and no handoff status, so it cannot stand in for a send', async () => {
  const { e, requestId, session, packet } = await frozenWithDestination();
  await session.reportReturn({ packetId: packet.packetId, claims: ['Handled by hand.'] });
  assert.equal(e.storage.peek('workspace', sendKey(requestId, packet.packetId)), null);
  assert.equal(e.storage.peek('workspace', handoffKey(requestId, packet.packetId)), null);
  assert.equal(session.handoffView(packet.packetId, '2026-01-01T01:00:00.000Z')?.state, 'not-sent');
  assert.equal(e.connector.sends.length, 0);
});

test('manual history cannot bypass the send fence: a recorded manual return blocks a later send', async () => {
  const { e, session, packet } = await frozenWithDestination();
  await session.reportReturn({ packetId: packet.packetId, claims: ['Handled by hand.'] });
  const view = session.handoffView(packet.packetId, '2026-01-01T01:00:00.000Z')!;
  assert.equal(view.canSend, false);
  assert.ok(view.blockers.some((reason) => /manual return/u.test(reason)));
  assert.equal(await session.send(e.connector.dispatch, packet.packetId, 'dest-1'), 'blocked');
  assert.equal(e.connector.sends.length, 0);
});

test('manual history cannot clear an unknown handoff: the packet stays unknown and cannot be resent', async () => {
  const { e, session, packet } = await frozenWithDestination();
  e.connector.failTransport = 'link dropped';
  await session.send(e.connector.dispatch, packet.packetId, 'dest-1');
  await session.reportReturn({ packetId: packet.packetId, claims: ['It came back, I think.'] });
  const view = session.handoffView(packet.packetId, '2026-01-01T01:00:00.000Z')!;
  assert.equal(view.state, 'unknown');
  assert.equal(view.canSend, false);
  assert.equal(view.ownerReportedReturns, 1);
  e.connector.failTransport = null;
  assert.equal(await session.send(e.connector.dispatch, packet.packetId, 'dest-1'), 'blocked');
  assert.equal(e.connector.sends.length, 1);
});

test('a stored owner-reported return that was tampered into an observed claim opens read-only', async () => {
  const { e, requestId, session, packet } = await frozenWithDestination();
  const stored = (await session.reportReturn({ packetId: packet.packetId, claims: ['Plain claim.'] }))!;
  const key = candidateKey(requestId, stored.candidateId);
  const tampered = decoder.decode(e.storage.peek('workspace', key)!).replace('"level":"agent-reported"', '"level":"observed"');
  e.storage.corrupt('workspace', key, new TextEncoder().encode(tampered));
  const reopened = (await e.restart(requestId)).session;
  assert.match(reopened.state.readOnly ?? '', /cannot assert observed or owner-judged/u);
});

test('a report for an unknown or foreign packet is refused and writes nothing', async () => {
  const { e, requestId, session, packet } = await frozenWithDestination();
  const before = e.storage.calls.length;
  await assert.rejects(e.store.reportOwnerReturn({
    requestId, packet: { packetId: packet.packetId, authoringDigest: `sha256:${'9'.repeat(64)}` as never }, claims: ['x'],
  }), ValidationError);
  assert.equal(await session.reportReturn({ packetId: 'nope' as never, claims: ['x'] }), null);
  assert.deepEqual(e.storage.calls.slice(before).filter((call) => ['write', 'create', 'event'].includes(call.op)), []);
});

test('an owner-reported return can still be judged, rejected or revised by the owner, appended as events', async () => {
  const { session, packet } = await frozenWithDestination();
  const stored = (await session.reportReturn({ packetId: packet.packetId, claims: ['Heading is tighter.'] }))!;
  await session.review(stored, 'defer', 'Check later', [{ claimId: stored.claims[0]!.claimId, judgment: 'confirmed' }]);
  const folded = reviewCandidate(stored, session.state.reviews);
  assert.equal(folded.claims['owner-judged'][0]!.reportedLevel, 'agent-reported', 'the owner judgment is a review event, not part of the return');
  assert.equal(stored.claims[0]!.level, 'agent-reported');
  await session.review(stored, 'reject', 'No.');
  assert.deepEqual(session.state.reviews.map((event) => event.decision), ['defer', 'reject']);
});

test('versionless fixture shape is the same shape the owner-reported path produces', async () => {
  const { session, packet, link } = await frozenWithDestination();
  const bare = versionless(link);
  const stored = (await session.reportReturn({ packetId: packet.packetId, claims: ['x'] }))!;
  assert.equal(bare.candidateVersionId, stored.candidateVersionId);
});
