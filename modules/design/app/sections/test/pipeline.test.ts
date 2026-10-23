import assert from 'node:assert/strict';
import test from 'node:test';
import { navigate } from '../../../requests/src/intents.ts';
import { parseReturnedCandidate } from '../../../requests/src/validate.ts';
import { returnCounts, SIMULATION_LABEL } from '../runs/pipeline.ts';
import { frozen, sent } from './doubles.ts';

test('durable draft → clarify → freeze → guarded CAS → fake → evidence → inbox → accept/revise', async () => {
  const { d, runs, session, packet, dispatchId } = await sent();
  assert.equal(packet.clarifications[0]?.answer, 'Yes.');
  assert.equal(session.state.sends.length, 1);
  assert.deepEqual(d.writes, ['outbox:submitting', 'outbox:accepted']);
  const candidate = await runs.pipeline.simulateReturn(session, dispatchId);
  assert.ok(candidate);
  assert.equal(candidate.observedStatus, SIMULATION_LABEL);
  assert.equal(candidate.candidateVersionId, null);
  assert.equal(candidate.claims[0]?.level, 'agent-reported');
  assert.ok(d.writes.indexOf('evidence') < d.writes.indexOf('candidate'));
  assert.equal(session.handoffView(packet.packetId, d.clock.now())?.state, 'returned');
  assert.equal(session.inbox.length, 1);
  assert.equal((await runs.pipeline.review(session, candidate, 'accept'))?.decision, 'accept');
  assert.equal((await runs.pipeline.review(session, candidate, 'revise'))?.decision, 'revise');
  assert.equal(session.state.draft?.origin, 'revision');
  assert.equal(session.state.draft?.review?.candidateId, candidate.candidateId);
  assert.equal(session.state.sends.length, 1);
});

test('reject appends a decision but creates no draft or send', async () => {
  const { d, runs, session, dispatchId } = await sent();
  const candidate = await runs.pipeline.simulateReturn(session, dispatchId);
  assert.ok(candidate);
  const draft = session.draftBytes();
  const sends = session.state.sends;
  const from = d.storage.calls.length;
  const outboxWrites = d.writes.filter((entry) => entry.startsWith('outbox:')).length;
  assert.equal((await runs.pipeline.review(session, candidate, 'reject'))?.decision, 'reject');
  assert.deepEqual(session.draftBytes(), draft);
  assert.deepEqual(session.state.sends, sends);
  assert.equal(d.storage.calls.slice(from).filter((entry) => entry.key.endsWith('/draft') && entry.op === 'write').length, 0);
  assert.equal(d.writes.filter((entry) => entry.startsWith('outbox:')).length, outboxWrites);
});

test('freeze, selection, navigation, readback and cancelled confirmation make zero outbox writes', async () => {
  const { d, runs, session, packet } = await frozen();
  navigate({ navigate: () => {} }, { type: 'open-packet', requestId: session.state.requestId, packetId: packet.packetId });
  await runs.pipeline.selectPacket(session, packet.packetId);
  runs.controller.requestSend();
  runs.controller.cancel();
  await runs.controller.checkStatus();
  await runs.pipeline.refresh(session);
  assert.equal(await runs.pipeline.confirm(), null);
  assert.deepEqual(d.writes, []);
  assert.equal(session.state.sends.length, 0);
});

test('owner-reported return is separate, versionless and cannot claim native verification', async () => {
  const { runs, session, packet } = await frozen();
  const candidate = await runs.pipeline.reportOwnerReturn(session, {
    packetId: packet.packetId, claims: ['Owner saw a changed heading'], host: 'synthetic-owner-host', model: 'synthetic-owner-model',
  });
  assert.ok(candidate);
  assert.equal(candidate.provenance?.origin, 'owner-reported');
  assert.equal(candidate.candidateVersionId, null);
  assert.deepEqual(returnCounts(session.state.candidates), { simulated: 0, agentReported: 0, ownerReported: 1, realVerified: 0 });
  assert.throws(() => parseReturnedCandidate({
    ...candidate, claims: [{ ...candidate.claims[0], level: 'observed' }],
  }));
  assert.throws(() => parseReturnedCandidate({ ...candidate, candidateVersionId: 'claimed-native-version' }));
  runs.controller.requestSend();
  assert.equal((await runs.controller.confirm())?.outcome, 'refused');
  assert.equal(session.state.sends.length, 0);
});

test('double confirmation cannot create two attempts or sends', async () => {
  const { d, runs, session } = await frozen();
  runs.controller.requestSend();
  await Promise.all([runs.pipeline.confirm(), runs.controller.confirm()]);
  assert.equal(session.state.sends.length, 1);
  assert.equal(d.writes.filter((entry) => entry === 'outbox:submitting').length, 1);
  assert.equal(d.writes.filter((entry) => entry === 'outbox:accepted').length, 1);
});

test('saved-result refresh preserves unsaved continuation edits', async () => {
  const { runs, session, dispatchId } = await sent();
  session.edit({ type: 'set-intent', intent: 'Unsaved follow-up intent' });
  const before = session.draftBytes();
  await runs.pipeline.simulateReturn(session, dispatchId);
  await runs.pipeline.refresh(session);
  assert.deepEqual(session.draftBytes(), before);
  assert.equal(session.state.save, 'unsaved');
});
