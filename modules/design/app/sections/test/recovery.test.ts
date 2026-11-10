import assert from 'node:assert/strict';
import test from 'node:test';
import { returnCounts, SIMULATION_LABEL } from '../runs/pipeline.ts';
import { frozen, sent } from './doubles.ts';

test('full-loop restart retains provenance, decisions and the send fence', async () => {
  const { d, runs, session, packet, dispatchId } = await sent();
  const candidate = await runs.pipeline.simulateReturn(session, dispatchId);
  assert.ok(candidate);
  await runs.pipeline.review(session, candidate, 'accept');
  session.dispose();
  d.storage.restart();
  const rebuilt = await d.open();
  const fresh = await rebuilt.requests.open(session.state.requestId);
  await rebuilt.runs.pipeline.selectPacket(fresh, packet.packetId);
  await rebuilt.runs.pipeline.refresh(fresh);
  await rebuilt.runs.pipeline.simulateReturn(fresh, dispatchId);
  assert.equal(fresh.state.candidates.length, 1);
  assert.equal(fresh.state.candidates[0]?.observedStatus, SIMULATION_LABEL);
  assert.equal(fresh.state.reviews.length, 1);
  assert.deepEqual(returnCounts(fresh.state.candidates), { simulated: 1, agentReported: 0, ownerReported: 0, realVerified: 0 });
  rebuilt.runs.controller.requestSend();
  assert.equal(await rebuilt.runs.controller.confirm(), null);
  assert.equal(d.writes.filter((entry) => entry === 'outbox:submitting').length, 1);
});

for (const stage of ['temp-write', 'ack'] as const) {
  test(`T6 send crash at ${stage}: no outbox/dispatch; durable acknowledgement loss stays fenced`, async () => {
    const { d, runs, session, packet } = await frozen();
    d.storage.crashAt({ op: 'create', stage, key: (key) => key.includes('/sends/') });
    runs.controller.requestSend();
    assert.equal((await runs.controller.confirm())?.outcome, 'persist-failed');
    assert.deepEqual(d.writes, []);
    d.storage.restart();
    const rebuilt = await d.open();
    const fresh = await rebuilt.requests.open(session.state.requestId);
    await rebuilt.runs.pipeline.selectPacket(fresh, packet.packetId);
    if (stage === 'ack') {
      assert.equal(fresh.handoffView(packet.packetId, d.clock.now())?.state, 'unknown');
      rebuilt.runs.controller.requestSend();
      assert.equal((await rebuilt.runs.controller.confirm())?.outcome, 'refused');
      assert.deepEqual(d.writes, []);
    } else {
      assert.equal(fresh.state.sends.length, 0);
    }
  });
}

for (const fault of ['throw-before-write', 'throw-after-write'] as const) {
  test(`outbox ${fault} between send record and dispatch never resends after restart`, async () => {
    const { d, runs, session, packet } = await frozen();
    d.outbox.failNextPut(fault, 'submitting');
    runs.controller.requestSend();
    assert.equal((await runs.controller.confirm())?.outcome, 'persist-failed');
    assert.equal(d.writes.filter((entry) => entry === 'outbox:accepted').length, 0);
    const rebuilt = await d.open();
    const fresh = await rebuilt.requests.open(session.state.requestId);
    await rebuilt.runs.pipeline.selectPacket(fresh, packet.packetId);
    await rebuilt.runs.pipeline.refresh(fresh);
    const before = d.writes.length;
    rebuilt.runs.controller.requestSend();
    await rebuilt.runs.controller.confirm();
    await rebuilt.runs.controller.checkStatus();
    assert.equal(d.writes.length, before);
    assert.equal(fresh.handoffView(packet.packetId, d.clock.now())?.state, 'unknown');
  });
}

test('lost final outbox write recovers to unknown and status checks never clear it', async () => {
  const { d, runs, session, packet } = await frozen();
  d.outbox.failNextPut('throw-before-write', 'accepted');
  runs.controller.requestSend();
  const result = await runs.controller.confirm();
  assert.equal(result?.outcome, 'attempted');
  if (result?.outcome === 'attempted') assert.equal(result.persisted, false);
  const rebuilt = await d.open();
  const fresh = await rebuilt.requests.open(session.state.requestId);
  await rebuilt.runs.pipeline.selectPacket(fresh, packet.packetId);
  await rebuilt.runs.pipeline.refresh(fresh);
  const before = d.writes.length;
  await rebuilt.runs.controller.checkStatus();
  rebuilt.runs.controller.requestSend();
  assert.equal(await rebuilt.runs.controller.confirm(), null);
  assert.equal(d.writes.length, before);
  assert.equal(fresh.handoffView(packet.packetId, d.clock.now())?.state, 'unknown');
});

for (const failure of ['before', 'after'] as const) {
  test(`evidence ${failure}-write failure: no inbox before durability; saved evidence replays once`, async () => {
    const { d, runs, session, dispatchId } = await sent();
    d.crashEvidence(failure);
    await assert.rejects(() => runs.pipeline.simulateReturn(session, dispatchId));
    assert.equal(session.state.candidates.length, 0);
    const rebuilt = await d.open();
    const fresh = await rebuilt.requests.open(session.state.requestId);
    await rebuilt.runs.pipeline.refresh(fresh);
    assert.equal(fresh.state.candidates.length, failure === 'after' ? 1 : 0);
    await rebuilt.runs.pipeline.simulateReturn(fresh, dispatchId);
    await rebuilt.runs.pipeline.refresh(fresh);
    assert.equal(fresh.state.candidates.length, 1);
    assert.equal(d.evidence.entries.length, 1);
    assert.equal(d.writes.filter((entry) => entry === 'outbox:accepted').length, 1);
  });
}
