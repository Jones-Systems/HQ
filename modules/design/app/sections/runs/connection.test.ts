import assert from 'node:assert/strict';
import test from 'node:test';
import type { EvidenceReadbackPort, TransportPort, TransportQualification } from '../../../connector/src/contract.ts';
import { createFakeReceiver, syntheticCatalog, syntheticDestination, syntheticEvidence, syntheticIdentity } from '../../../connector/src/fakes.ts';
import { latestAttempt } from '../../../connector/src/dispatch.ts';
import { createRequestsEnvironment } from '../requests/env.ts';
import { doubles, compareSlot, source } from '../test/doubles.ts';
import { createRunsEnvironment, type RunsConnection } from './env.ts';
import { AGENT_REPORTED_LABEL, DISCONNECTED_LABEL, SIMULATION_LABEL, returnCounts } from './pipeline.ts';

// This real-shaped port is an in-memory source fixture, not host qualification.
async function fixture(qualification: TransportQualification = { level: 'qualified', evidenceRef: 'fixture-only' }) {
  const d = doubles();
  const requests = createRequestsEnvironment({ ...d, storage: d.storage, compareSlot });
  const clock = { now: () => Date.parse(d.clock.now()) };
  const receiver = createFakeReceiver({ clock, identity: syntheticIdentity() });
  const destination = syntheticDestination({ endpoint: { transport: 'jones-code', locator: 'fixture:existing-thread' }, label: 'Fixture existing thread' });
  let lookupAbsent = false;
  const transport: TransportPort = {
    descriptor: { kind: 'jones-code', provenance: 'jones', label: 'Qualified label alone proves nothing', qualification },
    identify: (endpoint, signal) => receiver.identify(endpoint, signal),
    async send(handoff, endpoint, signal) {
      assert.equal(latestAttempt((await d.outbox.get(handoff.dispatchId))!.record)?.state, 'submitting');
      const result = await receiver.send(handoff, endpoint, signal);
      return result.kind === 'rejected' ? result : { ...result, receipt: { ...result.receipt, provenance: 'jones' } };
    },
    async lookup(query, signal) {
      const result = await receiver.lookup(query, signal);
      if (lookupAbsent) return { kind: 'not-found' };
      return result.kind === 'found' ? { ...result, receipt: { ...result.receipt, provenance: 'jones' } } : result;
    },
  };
  let reads = 0;
  const readback: EvidenceReadbackPort = {
    descriptor: transport.descriptor,
    async readEvidence(query) {
      reads++;
      const record = (await d.outbox.get(query.dispatchId))!.record;
      const attempt = latestAttempt(record)!;
      const raw = syntheticEvidence({ dispatchId: query.dispatchId, attemptId: attempt.attemptId, receipt: attempt.receipt!, packet: record.packet, model: attempt.receipt!.observedModel });
      return { kind: 'found', documents: [{ ...raw, provenance: 'jones' }] };
    },
  };
  const connection: RunsConnection = {
    getCatalog: () => ({ ...syntheticCatalog(), destinations: [destination] }),
    transports: { 'jones-code': transport }, readback: { 'jones-code': readback },
  };
  const open = () => createRunsEnvironment({ ...d, requests, compareSlot, connection });
  const runs = await open();
  const session = await requests.create({ title: 'Source fixture', sources: [source] });
  session.edit({ type: 'set-intent', intent: 'Update fixture spacing' });
  session.edit({ type: 'set-destination', destination: { kind: 'existing-thread', destinationId: destination.destinationId, label: destination.label } });
  const packet = await runs.pipeline.freeze(session);
  assert.ok(packet);
  await runs.pipeline.selectPacket(session, packet.packetId);
  return { d, requests, runs, session, packet, receiver, open, reads: () => reads, connection, setLookupAbsent: (value: boolean) => { lookupAbsent = value; } };
}

for (const qualification of [
  { level: 'unqualified', reason: 'No native evidence' },
  { level: 'qualified', evidenceRef: '  ' },
] as const) {
  test(`a ${qualification.level} transport without evidence remains disconnected`, async () => {
    const f = await fixture(qualification);
    assert.equal(f.runs.pipeline.connectionLabel, DISCONNECTED_LABEL);
    assert.equal(f.runs.controller.view().sendEnabled, false);
    f.runs.controller.requestSend();
    assert.equal(await f.runs.pipeline.confirm(), null);
    assert.equal(f.receiver.calls.send, 0);
    assert.equal(f.session.state.sends.length, 0);
  });
}

test('qualified injection sends only on explicit confirmation; receipt and agent report survive reopen', async () => {
  const f = await fixture();
  await f.runs.pipeline.refresh(f.session);
  assert.equal(f.receiver.calls.send, 0);
  assert.equal(await f.runs.pipeline.confirm(), null);
  f.runs.controller.requestSend();
  assert.equal(f.receiver.calls.send, 0);
  const result = await f.runs.pipeline.confirm();
  assert.equal(result?.outcome, 'attempted');
  assert.equal(f.receiver.calls.send, 1);
  assert.equal(f.session.state.sends.length, 1);
  assert.deepEqual(f.d.writes, ['outbox:submitting', 'outbox:accepted']);
  await f.runs.pipeline.refresh(f.session);
  assert.equal(f.reads(), 1);
  const candidate = f.session.state.candidates[0]!;
  assert.equal(candidate.observedStatus, AGENT_REPORTED_LABEL);
  assert.equal(candidate.candidateVersionId, null);
  assert.equal(candidate.claims[0]?.level, 'agent-reported');
  assert.deepEqual(returnCounts(f.session.state.candidates), { simulated: 0, agentReported: 1, ownerReported: 0, realVerified: 0 });
  assert.equal(await f.runs.pipeline.simulateReturn(f.session, f.runs.controller.view().status!.dispatchId), null);
  const reopened = await f.open();
  const session = await f.requests.open(f.session.state.requestId);
  await reopened.pipeline.selectPacket(session, f.packet.packetId);
  await reopened.pipeline.refresh(session);
  assert.equal(session.state.candidates.length, 1);
  assert.equal(reopened.controller.view().status?.state, 'accepted');
  reopened.controller.requestSend();
  assert.equal(await reopened.pipeline.confirm(), null);
  assert.equal(f.receiver.calls.send, 1);
});

test('unknown effect remains lookup-only across a new session; absence never permits resend', async () => {
  const f = await fixture();
  f.receiver.failNextSend('throw-after-effect');
  f.runs.controller.requestSend();
  await f.runs.pipeline.confirm();
  assert.equal(f.runs.controller.view().status?.state, 'unknown');
  f.setLookupAbsent(true);
  const reopened = await f.open();
  await reopened.pipeline.selectPacket(f.session, f.packet.packetId);
  await reopened.pipeline.refresh(f.session);
  assert.equal(reopened.controller.view().status?.state, 'unknown');
  assert.equal(reopened.controller.view().resolveUnknown.available, false);
  reopened.controller.requestSend();
  assert.equal(await reopened.pipeline.confirm(), null);
  assert.equal(f.receiver.calls.send, 1);
  assert.equal(f.receiver.calls.lookup, 1);
  f.setLookupAbsent(false);
  await reopened.pipeline.refresh(f.session);
  assert.equal(reopened.controller.view().status?.state, 'accepted');
  assert.equal(f.receiver.calls.send, 1);
});

test('explicit example mode remains simulated and never accepts production wiring', async () => {
  const f = await fixture();
  const example = await createRunsEnvironment({ ...f.d, requests: f.requests, compareSlot, mode: 'example' });
  assert.equal(example.pipeline.connectionLabel, SIMULATION_LABEL);
  assert.equal(example.catalog.destinations[0]?.endpoint.transport, 'fake-receiver');
  await assert.rejects(() => createRunsEnvironment({ ...f.d, requests: f.requests, compareSlot, mode: 'example', connection: f.connection }));
  assert.equal(f.receiver.calls.send, 0);
});
