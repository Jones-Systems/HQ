import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluateDestination } from '../../../connector/src/eligibility.ts';
import { createFakeReceiver, syntheticIdentity } from '../../../connector/src/fakes.ts';
import { createReferencesEnvironment } from '../references/env.ts';
import { SIMULATION_LABEL } from '../runs/pipeline.ts';
import { compareSlot, doubles, frozen } from './doubles.ts';

test('environment opening creates no requests, sends or reference documents', async () => {
  const d = doubles();
  const { requests } = await d.open();
  const refs = await createReferencesEnvironment({
    storage: d.referenceStorage, clock: d.clock, ids: d.ids, compareSlot, previewUrl: () => null,
  });
  assert.deepEqual(await requests.store.listRequests(), []);
  assert.deepEqual(d.writes, []);
  assert.equal(d.referenceStorage.operations.filter((op) => op.op === 'writeDocument').length, 0);
  assert.equal(refs.compareSlot, compareSlot);
  assert.equal(requests.compareSlot, compareSlot);
  assert.equal(refs.previewUrl('synthetic' as never), null);
  await assert.rejects(() => requests.open('invalid/id'));
});

test('clock and ID adapters are deterministic and only one simulated destination is eligible', async () => {
  const { d, runs, packet, session } = await frozen();
  assert.equal(runs.catalog.destinations.length, 1);
  const destination = runs.catalog.destinations[0]!;
  assert.equal(destination.label, SIMULATION_LABEL);
  assert.equal(destination.endpoint.transport, 'fake-receiver');
  const receiver = createFakeReceiver({ clock: { now: () => Date.parse(d.clock.now()) }, identity: syntheticIdentity() });
  assert.equal(evaluateDestination(destination, { 'fake-receiver': receiver }).eligible, true);
  assert.equal(packet.frozenAt, d.clock.now());
  assert.match(session.state.requestId, /^synthetic-request-/);
  runs.controller.requestSend();
  const result = await runs.controller.confirm();
  assert.equal(result?.outcome, 'attempted');
  if (result?.outcome === 'attempted') {
    assert.equal(result.attempt.createdAt, d.clock.now());
    assert.match(result.attempt.confirmationId, /^cfm_synthetic-confirmation-/);
    assert.match(result.attempt.sessionId, /^synthetic-connector-session-/);
  }
});
