import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { FenceOutcome, OutboxStorePort, TransportPort, TransportRegistry } from '../src/contract.ts';
import type { DispatchRecord } from '../src/dispatch.ts';
import { createConfirmation } from '../src/confirmation.ts';
import { latestAttempt, withLatest } from '../src/dispatch.ts';
import { evaluateDestination, NEW_THREAD_REASON } from '../src/eligibility.ts';
import { createFakeClock, createFakeReceiver, createMemoryOutboxStore, syntheticDestination, syntheticIdentity, syntheticPacket } from '../src/fakes.ts';
import type { FakeFenceMode } from '../src/fakes.ts';
import { createOutbox } from '../src/outbox.ts';
import { createResolveUnknownConfirmation } from '../src/resolve-unknown.ts';
import { destinationRow, newThreadControl } from '../src/view-model.ts';

async function setupUnknown(afterEffect = false) {
  const clock = createFakeClock();
  const receiver = createFakeReceiver({ identity: syntheticIdentity(), clock, modes: ['existing-thread', 'new-thread'] });
  const store = createMemoryOutboxStore();
  const transports: TransportRegistry = { 'fake-receiver': receiver };
  const packet = await syntheticPacket();
  const destination = syntheticDestination({ mode: 'new-thread' });
  const make = (overrides: { store?: OutboxStorePort; transports?: TransportRegistry } = {}) => createOutbox({
    store, transports, clock, sessionId: 'synthetic-resolution', probeTimeoutMs: 10, ...overrides,
  });
  const outbox = make();
  receiver.failNextSend(afterEffect ? 'throw-after-effect' : 'throw-before-effect');
  const result = await outbox.submit({ packet, destination, confirmation: createConfirmation({ packet, destination, clock }) });
  assert.equal(result.outcome, 'attempted');
  if (result.outcome !== 'attempted') throw new Error('Expected synthetic attempt');
  const record = (await outbox.get(result.dispatchId))!;
  const confirmation = createResolveUnknownConfirmation(record, clock);
  return { clock, receiver, store, transports, packet, destination, outbox, make, record, confirmation,
    request: { dispatchId: record.dispatchId, confirmation } };
}

test('new-thread requires qualification AND declared mode; control derives from selectable rows', () => {
  const clock = createFakeClock();
  const destination = syntheticDestination({ mode: 'new-thread' });
  for (const modes of [undefined, ['existing-thread'] as const, ['new-thread'] as const]) {
    const receiver = createFakeReceiver({ identity: syntheticIdentity(), clock, ...(modes ? { modes } : {}) });
    const registry = { 'fake-receiver': receiver };
    assert.equal(evaluateDestination(destination, registry).eligible, modes?.includes('new-thread' as never) ?? false);
    const control = newThreadControl([destinationRow(destination, registry)]);
    assert.equal(control.enabled, modes?.includes('new-thread' as never) ?? false);
    if (control.enabled) assert.equal(control.destinationId, destination.destinationId);
    else assert.equal(control.reason, NEW_THREAD_REASON);
    const qualified: TransportPort = { ...receiver, descriptor: { ...receiver.descriptor, kind: 'jones-code', provenance: 'jones', qualification: { level: 'qualified', evidenceRef: 'synthetic qualification fixture only' } } };
    const jones = { ...destination, endpoint: { transport: 'jones-code' as const, locator: 'synthetic:jones' } };
    assert.equal(evaluateDestination(jones, { 'jones-code': qualified }).eligible, modes?.includes('new-thread' as never) ?? false);
    assert.equal(evaluateDestination(jones, { 'jones-code': receiver }).eligible, false);
    const unqualified: TransportPort = { ...receiver, descriptor: { ...receiver.descriptor, qualification: { level: 'unqualified', reason: 'synthetic' } } };
    assert.equal(evaluateDestination(destination, { 'fake-receiver': unqualified }).eligible, false);
    assert.equal(newThreadControl([destinationRow({ ...destination, status: 'unreachable' }, registry)]).enabled, false);
  }
  assert.equal(newThreadControl().enabled, false);
});

for (const mode of ['authoritative', 'unavailable', 'throw', 'timeout', 'malformed'] satisfies FakeFenceMode[]) {
  test(`fence mapping ${mode}; one use and no resend`, async () => {
    const h = await setupUnknown();
    h.receiver.setFenceMode(mode);
    const result = await h.outbox.resolveUnknown(h.request);
    assert.equal(result.outcome, 'resolved');
    const record = (await h.outbox.get(h.record.dispatchId))!;
    const latest = latestAttempt(record)!;
    assert.equal(latest.state, mode === 'authoritative' ? 'no-effect' : 'unknown');
    assert.equal(latest.readbacks, 1);
    assert.match(latest.reason!, mode === 'authoritative' ? /Owner-confirmed fence/ : /Still unknown/);
    assert.equal(await h.outbox.resolveUnknown(h.request).then((r) => r.outcome), 'refused');
    assert.equal(await h.make().resolveUnknown(h.request).then((r) => r.outcome), 'refused');
    assert.equal(h.receiver.fenceCalls(), 1);
    assert.equal(h.receiver.calls.send, 1);
    assert.deepEqual(Object.keys(latest).sort(), Object.keys(latestAttempt(h.record)!).sort());
    assert.deepEqual(Object.keys(record).sort(), Object.keys(h.record).sort());
  });
}

for (const status of ['accepted', 'held'] as const) {
  test(`found maps ${status} and records receipt variances`, async () => {
    const h = await setupUnknown(true);
    const receipt = h.receiver.receiptFor(h.confirmation.idempotencyKey)!;
    const port: TransportPort = { ...h.receiver, fence: async () => ({ kind: 'found', receipt: { ...receipt, status, observedHostId: 'host.other' as typeof receipt.observedHostId } }) };
    const result = await h.make({ transports: { 'fake-receiver': port } }).resolveUnknown(h.request);
    assert.equal(result.outcome, 'resolved');
    const attempt = latestAttempt((await h.outbox.get(h.record.dispatchId))!)!;
    assert.equal(attempt.state, status);
    assert.equal(attempt.basis, 'readback');
    assert.deepEqual(attempt.variances, ['host-mismatch']);
  });
}

for (const raw of [null, undefined, {}, { kind: 'found' }, { kind: 'found', receipt: null }, { kind: 'no-effect', basis: 42 }, { kind: 'rejected', reason: 'not allowed' }]) {
  test(`malformed fence ${JSON.stringify(raw)} stays unknown`, async () => {
    const h = await setupUnknown();
    const port: TransportPort = { ...h.receiver, fence: async () => raw as FenceOutcome };
    await h.make({ transports: { 'fake-receiver': port } }).resolveUnknown(h.request);
    const attempt = latestAttempt((await h.outbox.get(h.record.dispatchId))!)!;
    assert.equal(attempt.state, 'unknown');
    assert.equal(attempt.readbacks, 1);
  });
}

for (const scenario of ['not unknown', 'existing-thread', 'no fence', 'stale', 'wrong dispatch', 'wrong attempt', 'wrong key', 'expired', 'future'] as const) {
  test(`precondition refusal: ${scenario}`, async () => {
    const h = await setupUnknown();
    let record: DispatchRecord = h.record;
    let confirmation = h.confirmation;
    if (scenario === 'not unknown') record = withLatest(record, { ...latestAttempt(record)!, state: 'accepted' });
    if (scenario === 'existing-thread') record = { ...record, destination: { ...record.destination, mode: 'existing-thread' } };
    const stored = (await h.store.get(record.dispatchId))!;
    await h.store.put(record, stored.revision);
    if (scenario === 'stale') confirmation = { ...confirmation, readbacks: 1 };
    if (scenario === 'wrong dispatch') confirmation = { ...confirmation, dispatchId: 'dsp.other' as typeof confirmation.dispatchId };
    if (scenario === 'wrong attempt') confirmation = { ...confirmation, attemptId: 'attempt.other' as typeof confirmation.attemptId };
    if (scenario === 'wrong key') confirmation = { ...confirmation, idempotencyKey: 'other' };
    if (scenario === 'expired') h.clock.advance(120_000);
    if (scenario === 'future') confirmation = { ...confirmation, confirmedAt: new Date(h.clock.now() + 1).toISOString() };
    const { fence: _fence, ...withoutFence } = h.receiver;
    const outbox = scenario === 'no fence' ? h.make({ transports: { 'fake-receiver': withoutFence } }) : h.outbox;
    assert.equal((await outbox.resolveUnknown({ dispatchId: record.dispatchId, confirmation })).outcome, 'refused');
    assert.equal(h.receiver.fenceCalls(), 0);
  });
}

test('concurrent confirmations in separate outboxes call fence once', async () => {
  const h = await setupUnknown();
  await Promise.all([h.outbox.resolveUnknown(h.request), h.make().resolveUnknown(h.request)]);
  assert.equal(h.receiver.fenceCalls(), 1);
});

test('used confirmation refuses even if the reservation failed before write', async () => {
  const h = await setupUnknown();
  h.store.failNextPut('throw-before-write');
  assert.equal((await h.outbox.resolveUnknown(h.request)).outcome, 'persist-failed');
  assert.equal((await h.outbox.resolveUnknown(h.request)).outcome, 'refused');
  assert.equal(h.receiver.fenceCalls(), 0);
});

test('result CAS conflict is reported without overwriting competing state', async () => {
  const h = await setupUnknown();
  const port: TransportPort = { ...h.receiver, async fence(query, signal) {
    const result = await h.receiver.fence!(query, signal);
    const stored = (await h.store.get(h.record.dispatchId))!;
    await h.store.put(withLatest(stored.record, { ...latestAttempt(stored.record)!, reason: 'competing write' }), stored.revision);
    return result;
  } };
  const result = await h.make({ transports: { 'fake-receiver': port } }).resolveUnknown(h.request);
  assert.equal(result.outcome, 'resolved');
  if (result.outcome === 'resolved') { assert.equal(result.persisted, false); assert.match(result.detail, /not saved/); }
  assert.equal(latestAttempt((await h.outbox.get(h.record.dispatchId))!)?.reason, 'competing write');
  assert.equal(h.receiver.fenceCalls(), 1);
});

test('reconcile during an in-flight fence leaves the record for the fence result', async () => {
  const h = await setupUnknown();
  const reports: string[] = [];
  let outbox!: ReturnType<typeof h.make>;
  const port: TransportPort = { ...h.receiver, async fence(query, signal) {
    for (const report of await outbox.reconcile(h.record.dispatchId)) reports.push(report.detail);
    return h.receiver.fence!(query, signal);
  } };
  outbox = h.make({ transports: { 'fake-receiver': port } });
  const result = await outbox.resolveUnknown(h.request);
  assert.deepEqual(reports, ['owner-confirmed resolution in progress in this session']);
  assert.equal(result.outcome, 'resolved');
  if (result.outcome === 'resolved') { assert.equal(result.persisted, true); assert.equal(result.state, 'no-effect'); }
  assert.equal(latestAttempt((await h.outbox.get(h.record.dispatchId))!)!.state, 'no-effect');
  assert.equal(h.receiver.fenceCalls(), 1);
});

test('a failed result write after the fence reports the lost answer and stays unknown', async () => {
  const h = await setupUnknown();
  const port: TransportPort = { ...h.receiver, async fence(query, signal) {
    h.store.failNextPut('throw-before-write');
    return h.receiver.fence!(query, signal);
  } };
  const result = await h.make({ transports: { 'fake-receiver': port } }).resolveUnknown(h.request);
  assert.equal(result.outcome, 'persist-failed');
  if (result.outcome === 'persist-failed') assert.match(result.reason, /fence was called and answered \(no-effect: /);
  assert.equal(latestAttempt((await h.outbox.get(h.record.dispatchId))!)!.state, 'unknown');
  assert.equal((await h.outbox.resolveUnknown(h.request)).outcome, 'refused');
  assert.equal(h.receiver.fenceCalls(), 1);
  assert.equal(h.receiver.calls.send, 1);
});

test('in-flight send of the packet refuses resolution before a fence', async () => {
  const h = await setupUnknown();
  let entered!: () => void;
  let release!: () => void;
  const started = new Promise<void>((resolve) => { entered = resolve; });
  const barrier = new Promise<void>((resolve) => { release = resolve; });
  const outbox = createOutbox({ store: h.store, transports: h.transports, clock: h.clock, sessionId: 'synthetic',
    verifyPacket: async () => { entered(); await barrier; return true; } });
  const submitting = outbox.submit({ packet: h.packet, destination: h.destination, confirmation: createConfirmation({ packet: h.packet, destination: h.destination, clock: h.clock }) });
  await started;
  try { assert.equal((await outbox.resolveUnknown(h.request)).outcome, 'refused'); assert.equal(h.receiver.fenceCalls(), 0); }
  finally { release(); await submitting; }
});

test('fresh explicit confirmation after an unanswered fence allows one new resolution, never a resend', async () => {
  const h = await setupUnknown();
  h.receiver.setFenceMode('unavailable');
  const [a, b] = await Promise.all([h.outbox.resolveUnknown(h.request), h.outbox.resolveUnknown(h.request)]);
  assert.equal([a, b].filter((r) => r.outcome === 'resolved').length, 1);
  assert.equal(h.receiver.fenceCalls(), 1);
  const record = (await h.outbox.get(h.record.dispatchId))!;
  h.receiver.setFenceMode('authoritative');
  await h.outbox.resolveUnknown({ dispatchId: record.dispatchId, confirmation: createResolveUnknownConfirmation(record, h.clock) });
  assert.equal(h.receiver.fenceCalls(), 2);
  assert.equal(h.receiver.calls.send, 1);
});
