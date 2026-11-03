/**
 * spec.hq-expansion#test.connector-lifecycle.001 — compatibility. Existing v1
 * inputs, digests, enums and persisted shapes stay valid after the lifecycle,
 * evidence-feed and route-fence additions. Golden digests were computed
 * independently of this code (RFC 8785 over ASCII-only synthetic documents).
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { EvidenceStorePort, OutboxStorePort, StoredDispatch } from '../src/contract.ts';
import type { DispatchRecord } from '../src/dispatch.ts';
import type { EvidenceEntry } from '../src/evidence.ts';
import * as entry from '../src/index.ts';
import { digestOf } from '../src/canonical.ts';
import { HANDOFF_SCHEMA } from '../src/contract.ts';
import { ATTEMPT_STATES, DISPATCH_SCHEMA } from '../src/dispatch.ts';
import { EXECUTION_STATUSES, RECEIVER_CLAIM_LEVELS, RESULT_EVIDENCE_SCHEMA, intakeEvidence, parseResultEvidence } from '../src/evidence.ts';
import { DESTINATION_MODES, FRESHNESS_STATUSES, HOST_CATALOG_SCHEMA, OBSERVED_STATUSES, TRANSPORT_KINDS } from '../src/host-catalog.ts';
import { createMemoryOutboxStore, syntheticCatalog } from '../src/fakes.ts';
import { createOutbox } from '../src/outbox.ts';
import { dispatchLifecycle } from '../src/lifecycle.ts';
import { attempted, evidenceFor, recordIn, refusedWith } from './fixtures.ts';
import { createHarness } from './harness.ts';
import { createConnectorController } from '../src/controller.ts';
import type { DestinationId, DispatchId } from '../src/ids.ts';

const GOLDEN_PACKET_BODY = { schema: 'hq.design.decision-packet/v1', packetId: 'pkt.golden', decisions: ['synthetic golden decision'] };
const GOLDEN_PACKET_DIGEST = 'sha256:fc6b85d033d944ea6825d28334e96eafca31781e363229ffbf36b0b1ad4dd989';
const GOLDEN_WIRE_DIGEST = 'sha256:ba4be21597e63c7fcebd68c53e39f16a2c6dd3e952ae4bf5341efd97e7fc9672';
const GOLDEN_EVIDENCE_DIGEST = 'sha256:330e4e01d1eaea10368c4e61aec4309e47fe21d499cd1211235eda2ba904c7ab';

const GOLDEN_HANDOFF = {
  schema: 'hq.design.handoff/v1', dispatchId: 'dsp_golden', attemptId: 'dsp_golden.a1', idempotencyKey: 'dsp_golden.a1',
  packet: { packetId: 'pkt.golden', packetDigest: GOLDEN_PACKET_DIGEST }, packetBody: GOLDEN_PACKET_BODY,
  destination: { destinationId: 'dest.golden', hostId: 'host.golden', receiverId: 'receiver.golden', fingerprint: 'fp.golden', threadRef: 'thread.golden', model: { provider: 'synthetic', model: 'synthetic-model-1' } },
  fallback: 'forbidden', confirmedAt: '2026-01-01T00:00:00.000Z',
};

const GOLDEN_EVIDENCE = {
  schema: 'hq.design.result-evidence/v1', evidenceId: 'ev.golden', dispatchId: 'dsp_golden', attemptId: 'dsp_golden.a1', receiptId: 'rcpt_golden',
  packet: { packetId: 'pkt.golden', packetDigest: GOLDEN_PACKET_DIGEST },
  candidate: { candidateId: 'cand.golden', summary: 'Synthetic golden candidate', artifacts: [{ digest: `sha256:${'0'.repeat(64)}`, mediaType: 'image/png', bytes: 1024, label: 'golden capture' }] },
  claimLevel: 'agent-reported',
  execution: { status: 'completed', observedAt: '2026-01-01T00:00:00.000Z', hostId: 'host.golden', receiverId: 'receiver.golden', model: { provider: 'synthetic', model: 'synthetic-model-1' } },
  provenance: 'fake',
};

describe('handoff/v1 wire digest stays separate from the authoring digest', () => {
  it('matches the golden vectors and differs between wire and authoring', async () => {
    assert.equal(HANDOFF_SCHEMA, 'hq.design.handoff/v1');
    assert.equal(await digestOf(GOLDEN_PACKET_BODY), GOLDEN_PACKET_DIGEST);
    assert.equal(await digestOf(GOLDEN_HANDOFF), GOLDEN_WIRE_DIGEST);
    assert.notEqual(GOLDEN_WIRE_DIGEST, GOLDEN_PACKET_DIGEST);
  });

  it('still builds the exact v1 envelope: same keys, wireDigest of the sent handoff, authoring digest untouched', async () => {
    const h = await createHarness();
    const result = attempted(await h.outbox.submit(h.request()));
    const handoff = h.receiver.handoffs[0];
    assert.ok(handoff);
    assert.deepEqual(Object.keys(handoff).sort(), Object.keys(GOLDEN_HANDOFF).sort());
    assert.deepEqual(Object.keys(handoff.destination).sort(), Object.keys(GOLDEN_HANDOFF.destination).sort());
    assert.equal(handoff.fallback, 'forbidden');
    assert.equal(await digestOf(handoff), result.attempt.wireDigest);
    assert.equal(handoff.packet.packetDigest, h.packet.packetDigest);
    assert.notEqual(result.attempt.wireDigest, h.packet.packetDigest);
    assert.equal(await digestOf(handoff.packetBody), h.packet.packetDigest);
  });

  it('does not change the wire digest when route history exists, because history is never sent', async () => {
    const plain = await createHarness();
    const fenced = await createHarness({ manualHandoffs: { listForPacket: async () => [] } });
    const a = attempted(await plain.outbox.submit(plain.request()));
    const b = attempted(await fenced.outbox.submit(fenced.request()));
    assert.equal(a.attempt.wireDigest.length, b.attempt.wireDigest.length);
    assert.deepEqual(Object.keys(plain.receiver.handoffs[0] ?? {}).sort(), Object.keys(fenced.receiver.handoffs[0] ?? {}).sort());
  });
});

describe('enums and schema names are unchanged (additions need a new golden)', () => {
  it('keeps the v1 vocabularies', () => {
    assert.deepEqual([...ATTEMPT_STATES], ['submitting', 'accepted', 'held', 'rejected', 'unknown', 'blocked', 'no-effect']);
    assert.deepEqual([...EXECUTION_STATUSES], ['running', 'completed', 'failed', 'cancelled', 'unknown']);
    assert.deepEqual([...RECEIVER_CLAIM_LEVELS], ['agent-reported', 'observed']);
    assert.deepEqual([...TRANSPORT_KINDS], ['fake-receiver', 'jones-code']);
    assert.deepEqual([...DESTINATION_MODES], ['existing-thread', 'new-thread']);
    assert.deepEqual([...FRESHNESS_STATUSES], ['fresh', 'stale', 'offline', 'timeout', 'error', 'missing-at-host']);
    assert.deepEqual([...OBSERVED_STATUSES], ['reachable', 'unreachable', 'unknown']);
    assert.equal(DISPATCH_SCHEMA, 'hq.design.dispatch/v1');
    assert.equal(RESULT_EVIDENCE_SCHEMA, 'hq.design.result-evidence/v1');
    assert.equal(HOST_CATALOG_SCHEMA, 'hq.design.host-catalog/v1');
  });

  it('keeps every v1 public export and adds only the lifecycle, feed and route-fence ones', () => {
    const v1 = ['DISPATCH_SCHEMA', 'FAKE_RECEIVER_LABEL', 'HANDOFF_SCHEMA', 'HOST_CATALOG_SCHEMA', 'NEW_THREAD_REASON', 'REAL_JONES_NOT_QUALIFIED_REASON',
      'RESULT_EVIDENCE_SCHEMA', 'acknowledgeIdentity', 'brandId', 'canTransition', 'canonicalJson', 'createConfirmation', 'createConnectorController',
      'createOutbox', 'destinationRows', 'digestOf', 'dispatchStatus', 'evaluateDestination', 'evidenceRow', 'findDestination', 'hasEffect', 'intakeEvidence',
      'isDigest', 'isNoEffect', 'isUnresolved', 'latestAttempt', 'mergeHostCatalog', 'newThreadControl', 'parseHostCatalog', 'parseId', 'parseResultEvidence',
      'ConnectorPanel', 'ConnectorPanelHost'];
    const names = Object.keys(entry);
    for (const name of v1) assert.ok(names.includes(name), `lost v1 export ${name}`);
    for (const name of ['dispatchLifecycle', 'LIFECYCLE_STAGES', 'readbackEvidence', 'createLifecycleReader', 'evaluateRouteFence', 'createRouteSwitchAcknowledgement']) {
      assert.ok(names.includes(name), `missing new export ${name}`);
    }
  });
});

describe('persisted and external v1 shapes still work', () => {
  it('loads a stored v1 dispatch written before this change and keeps its fences', async () => {
    const record: DispatchRecord = JSON.parse(JSON.stringify({
      schema: 'hq.design.dispatch/v1', dispatchId: 'dsp_golden',
      packet: { packetId: 'pkt.p1', packetDigest: GOLDEN_PACKET_DIGEST },
      destination: { destinationId: 'dest.fake-existing', hostId: 'host.synthetic-laptop', receiverId: 'receiver.synthetic-fake', fingerprint: 'fp.synthetic-0001', transport: 'fake-receiver', locator: 'fake:receiver-1', mode: 'existing-thread', threadRef: 'thread.synthetic-1', model: { provider: 'synthetic', model: 'synthetic-model-1' } },
      attempts: [{
        attemptId: 'dsp_golden.a1', ordinal: 1, idempotencyKey: 'dsp_golden.a1', confirmationId: 'cfm_old', confirmedAt: '2026-01-01T00:00:00.000Z', sessionId: 's1',
        wireDigest: GOLDEN_WIRE_DIGEST, state: 'accepted', basis: 'send-response', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:01.000Z', resolvedAt: null,
        receipt: { receiptId: 'rcpt_golden', idempotencyKey: 'dsp_golden.a1', status: 'accepted', observedHostId: 'host.synthetic-laptop', observedReceiverId: 'receiver.synthetic-fake', observedModel: { provider: 'synthetic', model: 'synthetic-model-1' }, at: '2026-01-01T00:00:01.000Z', provenance: 'fake' },
        reason: null, variances: [], readbacks: 0, lastReadbackAt: null,
      }],
      createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:01.000Z',
    }));
    const lifecycle = dispatchLifecycle(record, []);
    assert.equal(lifecycle.stage, 'queued');
    assert.deepEqual(lifecycle.send, { status: 'fenced', code: 'already-handed-off', confirmationAfter: null });
    assert.deepEqual(lifecycle.anomalies, []);

    const backing = new Map<string, StoredDispatch>([['dsp_golden', { revision: 1, record }]]);
    const h = await createHarness({ backing });
    assert.equal((await h.outbox.get('dsp_golden' as DispatchId))?.attempts.length, 1);
    assert.equal((await h.outbox.reconcile()).length, 1);
    const store = createMemoryOutboxStore({ backing });
    assert.equal((await store.get('dsp_golden' as DispatchId))?.revision, 1, 'readback of an accepted attempt wrote nothing');
  });

  it('parses a v1 result-evidence document and keeps its digest', async () => {
    const parsed = parseResultEvidence(GOLDEN_EVIDENCE);
    assert.ok(parsed.ok);
    assert.equal(await digestOf(parsed.evidence), GOLDEN_EVIDENCE_DIGEST);
  });

  it('works with a v1 composition: a store that only has get, append and listByDispatch, and an outbox without new options', async () => {
    const h = await createHarness();
    const outboxOnly = createOutbox({ store: h.store, transports: h.transports, clock: h.clock, sessionId: 'v1' });
    const result = attempted(await outboxOnly.submit(h.request()));
    const entries: EvidenceEntry[] = [];
    const v1Store: EvidenceStorePort = {
      async get(id) { return entries.find((item) => item.evidence.evidenceId === id) ?? null; },
      async append(item) { entries.push(item); return 'appended'; },
      async listByDispatch(id) { return entries.filter((item) => item.evidence.dispatchId === id); },
    };
    const readOnlyOutbox: Pick<OutboxStorePort, 'get'> = h.store;
    const record = await outboxOnly.get(result.dispatchId);
    assert.ok(record);
    const intake = await intakeEvidence({ outbox: readOnlyOutbox, evidence: v1Store, clock: h.clock }, JSON.parse(JSON.stringify(evidenceFor(h, record))));
    assert.ok(intake.ok);
    const catalog = syntheticCatalog();
    const controller = createConnectorController({ outbox: outboxOnly, transports: h.transports, clock: h.clock, evidence: v1Store, getCatalog: () => catalog });
    await controller.setPacket(h.packet);
    await controller.select('dest.fake-existing' as DestinationId);
    assert.equal(controller.view().lifecycle?.stage, 'returned');
    assert.equal(controller.view().routeHistory.required, false);
  });

  it('keeps the v1 refusal codes for the existing fences', async () => {
    const h = await createHarness();
    attempted(await h.outbox.submit(h.request()));
    h.clock.advance(1000);
    refusedWith(await h.outbox.submit(h.request()), 'already-handed-off');
    const u = await createHarness();
    await recordIn(u, 'unknown');
    refusedWith(await u.outbox.submit(u.request()), 'unresolved-attempt');
  });
});
