/**
 * spec.hq-expansion#test.connector-lifecycle.001 — evidence list, subscription
 * and read-only readback. All receivers are the labelled fake; no real dispatch.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { EvidenceChange, EvidenceReadbackPort, EvidenceReadbackRegistry } from '../src/contract.ts';
import type { DestinationId } from '../src/ids.ts';
import type { HostCatalog } from '../src/host-catalog.ts';
import type { LifecycleChange } from '../src/evidence-feed.ts';
import { createConnectorController } from '../src/controller.ts';
import { createLifecycleReader, readbackEvidence } from '../src/evidence-feed.ts';
import { createMemoryEvidenceStore, syntheticCatalog } from '../src/fakes.ts';
import { intakeEvidence } from '../src/evidence.ts';
import { evidenceFor, recordIn } from './fixtures.ts';
import { createHarness } from './harness.ts';
import type { Harness } from './harness.ts';

const json = (value: unknown): unknown => JSON.parse(JSON.stringify(value));
const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 5));

/** Counts every touch of the transport surface, including property reads that a read-only caller must never make. */
function spyOn(h: Harness) {
  const touched: string[] = [];
  const calls = { readEvidence: 0 };
  const port = { descriptor: h.receiver.descriptor } as EvidenceReadbackPort;
  for (const name of ['send', 'identify', 'lookup'] as const) {
    Object.defineProperty(port, name, { get() { touched.push(name); return () => { throw new Error(`${name} must not be reachable from readback`); }; } });
  }
  Object.defineProperty(port, 'readEvidence', {
    value: (query: Parameters<EvidenceReadbackPort['readEvidence']>[0], signal: AbortSignal) => { calls.readEvidence += 1; return h.receiver.readEvidence(query, signal); },
  });
  const registry: EvidenceReadbackRegistry = { 'fake-receiver': port };
  return { registry, touched, calls };
}

async function setup(state: 'accepted' | 'held' | 'unknown' | 'no-effect' | 'submitting' = 'accepted') {
  const h = await createHarness();
  const record = await recordIn(h, state);
  const store = createMemoryEvidenceStore();
  const spy = spyOn(h);
  const attempt = record.attempts.at(-1);
  assert.ok(attempt);
  const read = () => readbackEvidence({ outbox: h.store, evidence: store, readback: spy.registry, clock: h.clock, timeoutMs: 50 }, record.dispatchId);
  return { h, record, attempt, store, spy, read };
}

describe('evidence feed (list and subscribe)', () => {
  it('lists everything or one dispatch and notifies subscribers after an append', async () => {
    const { h, record, store } = await setup();
    const changes: EvidenceChange[] = [];
    const stop = store.subscribe((change) => changes.push(change));
    const intake = (value: unknown) => intakeEvidence({ outbox: h.store, evidence: store, clock: h.clock }, value);
    assert.ok((await intake(json(evidenceFor(h, record, { evidenceId: 'ev.1' })))).ok);
    assert.deepEqual(changes, [{ kind: 'appended', evidenceId: 'ev.1', dispatchId: record.dispatchId }]);
    assert.equal((await store.list()).length, 1);
    assert.equal((await store.list({ dispatchId: record.dispatchId })).length, 1);
    assert.equal((await store.list({ dispatchId: 'dsp_other' as typeof record.dispatchId })).length, 0);
    // A duplicate is not a change.
    assert.ok((await intake(json(evidenceFor(h, record, { evidenceId: 'ev.1' })))).ok);
    assert.equal(changes.length, 1);
    stop();
    stop();
    assert.ok((await intake(json(evidenceFor(h, record, { evidenceId: 'ev.2', status: 'running' })))).ok);
    assert.equal(changes.length, 1, 'unsubscribe is idempotent and final');
  });

  it('isolates a throwing listener from the append and from other listeners', async () => {
    const { h, record, store } = await setup();
    const seen: string[] = [];
    store.subscribe(() => { throw new Error('faulty listener'); });
    store.subscribe((change) => seen.push(change.evidenceId));
    const result = await intakeEvidence({ outbox: h.store, evidence: store, clock: h.clock }, json(evidenceFor(h, record, { evidenceId: 'ev.1' })));
    assert.ok(result.ok);
    assert.deepEqual(seen, ['ev.1']);
  });
});

describe('evidence readback never sends', () => {
  it('ingests valid returned evidence with zero sends, probes and property access to send', async () => {
    const { h, record, attempt, store, spy, read } = await setup();
    h.receiver.returnEvidence(attempt.idempotencyKey, [json(evidenceFor(h, record, { evidenceId: 'ev.1', status: 'running' })), json(evidenceFor(h, record, { evidenceId: 'ev.2', status: 'completed', observedAt: '2026-01-01T00:05:00.000Z' }))]);
    const sendsBefore = h.receiver.calls.send;
    const identifiesBefore = h.receiver.calls.identify;
    const revisionBefore = (await h.store.get(record.dispatchId))?.revision;

    const report = await read();
    assert.equal(report.result, 'ingested');
    assert.equal(report.accepted, 2);
    assert.equal(store.entries.length, 2);
    // Repeat polls are idempotent.
    const again = await read();
    assert.equal(again.result, 'nothing-new');
    assert.equal(again.duplicates, 2);

    assert.equal(h.receiver.calls.send, sendsBefore, 'zero transport sends');
    assert.equal(h.receiver.calls.identify, identifiesBefore, 'zero identity probes');
    assert.equal(h.receiver.calls.lookup, 0);
    assert.deepEqual(spy.touched, [], 'readback never even reads send, identify or lookup');
    assert.equal(spy.calls.readEvidence, 2);
    assert.equal((await h.store.get(record.dispatchId))?.revision, revisionBefore, 'readback never writes the dispatch');
  });

  it('accepts evidence for a held handoff and reports the stage as still held', async () => {
    const { h, record, attempt, store, read } = await setup('held');
    h.receiver.returnEvidence(attempt.idempotencyKey, [json(evidenceFor(h, record))]);
    assert.equal((await read()).result, 'ingested');
    assert.equal(store.entries.length, 1);
  });

  for (const state of ['unknown', 'submitting', 'no-effect'] as const) {
    it(`is not applicable while the attempt is ${state}: the port is not called`, async () => {
      const { spy, read, h } = await setup(state);
      const report = await read();
      assert.equal(report.result, 'not-applicable');
      assert.equal(spy.calls.readEvidence, 0);
      assert.equal(h.receiver.evidenceReads(), 0);
    });
  }

  it('reports an unknown dispatch, a missing port, an unavailable receiver and a hung receiver without writing', async () => {
    const { h, record, store, spy } = await setup();
    const options = { outbox: h.store, evidence: store, readback: spy.registry, clock: h.clock, timeoutMs: 20 };
    assert.equal((await readbackEvidence(options, 'dsp_missing' as typeof record.dispatchId)).result, 'unknown-dispatch');
    assert.equal((await readbackEvidence({ ...options, readback: {} }, record.dispatchId)).result, 'no-readback-port');
    h.receiver.setLookupMode('unavailable');
    assert.equal((await readbackEvidence(options, record.dispatchId)).result, 'unavailable');
    const hang: EvidenceReadbackPort = { descriptor: h.receiver.descriptor, readEvidence: () => new Promise(() => {}) };
    assert.equal((await readbackEvidence({ ...options, readback: { 'fake-receiver': hang } }, record.dispatchId)).result, 'unavailable');
    const throwing: EvidenceReadbackPort = { descriptor: h.receiver.descriptor, readEvidence: () => { throw new Error('boom'); } };
    assert.equal((await readbackEvidence({ ...options, readback: { 'fake-receiver': throwing } }, record.dispatchId)).result, 'unavailable');
    assert.equal(store.entries.length, 0);
    assert.equal(h.receiver.calls.send, 1);
  });

  it('treats receiver documents as untrusted: mismatched, future-version and owner-judged ones are rejected with no write', async () => {
    const { h, record, attempt, store, read } = await setup();
    const good = evidenceFor(h, record);
    h.receiver.returnEvidence(attempt.idempotencyKey, [
      json({ ...good, evidenceId: 'ev.bad-digest', packet: { ...good.packet, packetDigest: `sha256:${'f'.repeat(64)}` } }),
      json({ ...good, evidenceId: 'ev.future', schema: 'hq.design.result-evidence/v2' }),
      json({ ...good, evidenceId: 'ev.owner', claimLevel: 'owner-judged' }),
      json({ ...good, evidenceId: 'ev.relabelled', provenance: 'jones' }),
      'not an object',
    ]);
    const report = await read();
    assert.equal(report.result, 'nothing-new');
    assert.deepEqual(report.rejected.map((item) => item.code), ['packet-digest-mismatch', 'unsupported-schema', 'claim-level-forbidden', 'provenance-mismatch', 'malformed']);
    assert.equal(store.entries.length, 0);
  });
});

describe('lifecycle reader', () => {
  it('lists and gets lifecycles, folding in evidence and catalog freshness', async () => {
    const { h, record, store } = await setup();
    await intakeEvidence({ outbox: h.store, evidence: store, clock: h.clock }, json(evidenceFor(h, record, { status: 'running' })));
    const reader = createLifecycleReader({ store: h.store, feed: store, getCatalog: syntheticCatalog });
    const got = await reader.get(record.dispatchId);
    assert.equal(got?.stage, 'running');
    assert.equal(got?.route?.freshness.status, 'fresh');
    assert.equal((await reader.list()).length, 1);
    assert.equal(await reader.get('dsp_missing' as typeof record.dispatchId), null);
  });

  it('notifies with a recomputed lifecycle when evidence is appended, and stops after unsubscribe', async () => {
    const { h, record, store } = await setup();
    const reader = createLifecycleReader({ store: h.store, feed: store });
    const seen: LifecycleChange[] = [];
    const stop = reader.subscribe((change) => seen.push(change));
    await intakeEvidence({ outbox: h.store, evidence: store, clock: h.clock }, json(evidenceFor(h, record, { evidenceId: 'ev.1', status: 'running' })));
    await tick();
    assert.equal(seen.length, 1);
    assert.equal(seen[0]?.dispatchId, record.dispatchId);
    assert.equal(seen[0]?.lifecycle.stage, 'running');
    stop();
    await intakeEvidence({ outbox: h.store, evidence: store, clock: h.clock }, json(evidenceFor(h, record, { evidenceId: 'ev.2', status: 'completed', observedAt: '2026-01-01T00:05:00.000Z' })));
    await tick();
    assert.equal(seen.length, 1);
  });
});

describe('controller with evidence feed and readback', () => {
  async function controllerSetup() {
    const h = await createHarness();
    const store = createMemoryEvidenceStore();
    const spy = spyOn(h);
    const catalog: HostCatalog = syntheticCatalog();
    const controller = createConnectorController({
      outbox: h.outbox, transports: h.transports, clock: h.clock, evidence: store, evidenceFeed: store, getCatalog: () => catalog,
      readEvidence: (dispatchId) => readbackEvidence({ outbox: h.store, evidence: store, readback: spy.registry, clock: h.clock }, dispatchId),
    });
    await controller.setPacket(h.packet);
    await controller.select('dest.fake-existing' as DestinationId);
    return { h, store, spy, controller };
  }

  it('shows the pinned route before sending, then the lifecycle, and reads returned work back without sending', async () => {
    const { h, spy, controller } = await controllerSetup();
    const before = controller.view();
    assert.equal(before.route?.pinnedLabel, 'Chosen route (pinned when you confirm)');
    assert.equal(before.route?.modelLabel, 'synthetic/synthetic-model-1 (pinned)');
    assert.equal(before.lifecycle?.stage, 'not-sent');

    controller.requestSend();
    const result = await controller.confirm();
    assert.equal(result?.outcome, 'attempted');
    assert.equal(controller.view().lifecycle?.stage, 'queued');
    assert.equal(controller.view().lifecycle?.canCheckForResults, true);
    assert.equal(controller.view().route?.pinnedLabel, 'Pinned to this route');
    assert.equal(controller.view().route?.fallbackLabel, 'No fallback: HQ never switches host or model.');
    if (result?.outcome !== 'attempted') return;

    const sends = h.receiver.calls.send;
    const record = await h.outbox.get(result.dispatchId);
    assert.ok(record);
    h.receiver.returnEvidence(result.attempt.idempotencyKey, [json(evidenceFor(h, record))]);
    await controller.checkStatus();
    assert.equal(controller.view().lifecycle?.stage, 'returned');
    assert.equal(controller.view().lifecycle?.canCheckForResults, false);
    assert.equal(controller.view().evidence.length, 1);
    assert.match(controller.view().message ?? '', /Evidence: 1 new/u);
    assert.equal(h.receiver.calls.send, sends, 'checking status never sends');
    assert.deepEqual(spy.touched, []);
  });

  it('refreshes the view when evidence for the current dispatch appears, and stops when the last listener leaves', async () => {
    const { h, store, controller } = await controllerSetup();
    controller.requestSend();
    const result = await controller.confirm();
    assert.equal(result?.outcome, 'attempted');
    if (result?.outcome !== 'attempted') return;
    const record = await h.outbox.get(result.dispatchId);
    assert.ok(record);
    let renders = 0;
    const stop = controller.subscribe(() => { renders += 1; });
    await intakeEvidence({ outbox: h.store, evidence: store, clock: h.clock }, json(evidenceFor(h, record, { status: 'running' })));
    await tick();
    assert.ok(renders >= 1);
    assert.equal(controller.view().lifecycle?.stage, 'running');
    stop();
    const after = renders;
    await intakeEvidence({ outbox: h.store, evidence: store, clock: h.clock }, json(evidenceFor(h, record, { evidenceId: 'ev.2', status: 'completed', observedAt: '2026-01-01T00:09:00.000Z' })));
    await tick();
    assert.equal(renders, after);
  });
});
