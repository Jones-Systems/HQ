/**
 * spec.hq-expansion#test.connector-lifecycle.001 — dispatchLifecycle projection.
 * Records come from the real outbox driven against the labelled fake receiver.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { AttemptState } from '../src/dispatch.ts';
import type { ResultEvidence } from '../src/evidence.ts';
import type { LifecycleStage } from '../src/lifecycle.ts';
import { ATTEMPT_STATES, latestAttempt } from '../src/dispatch.ts';
import { syntheticCatalog, syntheticDestination, syntheticManualHandoff } from '../src/fakes.ts';
import { LIFECYCLE_STAGES, dispatchLifecycle } from '../src/lifecycle.ts';
import { deepFreeze, entryOf, evidenceFor, recordIn } from './fixtures.ts';
import { createHarness } from './harness.ts';

const STAGE_OF: Readonly<Record<AttemptState, LifecycleStage>> = {
  submitting: 'submitting', unknown: 'unknown', held: 'held', accepted: 'queued',
  rejected: 'not-sent', blocked: 'not-sent', 'no-effect': 'not-sent',
};

describe('dispatchLifecycle stage from the dispatch alone', () => {
  for (const state of ATTEMPT_STATES) {
    it(`projects an attempt in ${state} as ${STAGE_OF[state]}`, async () => {
      const h = await createHarness();
      const record = await recordIn(h, state);
      const lifecycle = dispatchLifecycle(record, []);
      assert.equal(lifecycle.stage, STAGE_OF[state]);
      assert.equal(lifecycle.dispatchId, record.dispatchId);
      assert.equal(lifecycle.attemptOrdinal, 1);
      assert.equal(lifecycle.fake, true, 'the fake receiver is always labelled');
      assert.equal(lifecycle.resolution, state === 'rejected' || state === 'blocked' || state === 'no-effect' ? state : 'none');
    });
  }

  it('has a stage for every state and the stage list is the documented one', () => {
    assert.deepEqual([...LIFECYCLE_STAGES], ['not-sent', 'submitting', 'unknown', 'held', 'queued', 'running', 'returned', 'failed', 'cancelled']);
    assert.deepEqual(Object.keys(STAGE_OF).sort(), [...ATTEMPT_STATES].sort());
  });

  it('shows no record as not sent with an open send and no route unless a destination is given', () => {
    const none = dispatchLifecycle(null, []);
    assert.equal(none.stage, 'not-sent');
    assert.equal(none.resolution, 'none');
    assert.equal(none.dispatchId, null);
    assert.equal(none.route, null);
    assert.deepEqual(none.send, { status: 'open', code: null, confirmationAfter: null });
    const chosen = dispatchLifecycle(null, [], { catalogDestination: syntheticDestination() });
    assert.equal(chosen.route?.source, 'catalog-selection');
    assert.equal(chosen.route?.model?.model, 'synthetic-model-1');
  });

  it('keeps an unknown effect fenced and never offers a resend', async () => {
    const h = await createHarness();
    const unknown = dispatchLifecycle(await recordIn(h, 'unknown'), []);
    assert.deepEqual(unknown.send, { status: 'fenced', code: 'unresolved-attempt', confirmationAfter: null });
    const h2 = await createHarness();
    const submitting = dispatchLifecycle(await recordIn(h2, 'submitting'), []);
    assert.equal(submitting.send.code, 'unresolved-attempt');
    const h3 = await createHarness();
    const accepted = dispatchLifecycle(await recordIn(h3, 'accepted'), []);
    assert.deepEqual(accepted.send, { status: 'fenced', code: 'already-handed-off', confirmationAfter: null });
  });

  it('asks for a fresh confirmation after an authoritative no-effect result', async () => {
    const h = await createHarness();
    const record = await recordIn(h, 'no-effect');
    const lifecycle = dispatchLifecycle(record, []);
    assert.equal(lifecycle.send.status, 'needs-fresh-confirmation');
    assert.equal(lifecycle.send.confirmationAfter, latestAttempt(record)?.resolvedAt);
    assert.ok(lifecycle.send.confirmationAfter);
  });
});

describe('dispatchLifecycle stage from returned evidence', () => {
  it('moves queued → running → returned from matching evidence', async () => {
    const h = await createHarness();
    const record = await recordIn(h, 'accepted');
    assert.equal(dispatchLifecycle(record, []).stage, 'queued');
    const running = await entryOf(evidenceFor(h, record, { evidenceId: 'ev.1', status: 'running', observedAt: '2026-01-01T00:01:00.000Z' }));
    assert.equal(dispatchLifecycle(record, [running]).stage, 'running');
    const done = await entryOf(evidenceFor(h, record, { evidenceId: 'ev.2', status: 'completed', observedAt: '2026-01-01T00:02:00.000Z' }));
    const returned = dispatchLifecycle(record, [running, done]);
    assert.equal(returned.stage, 'returned');
    assert.equal(returned.evidence.counted, 2);
    assert.equal(returned.evidence.latest?.evidenceId, 'ev.2');
    assert.equal(returned.evidence.latest?.fake, true);
  });

  for (const [status, stage] of [['failed', 'failed'], ['cancelled', 'cancelled'], ['unknown', 'queued']] as const) {
    it(`maps a ${status} execution report to ${stage}`, async () => {
      const h = await createHarness();
      const record = await recordIn(h, 'accepted');
      const lifecycle = dispatchLifecycle(record, [await entryOf(evidenceFor(h, record, { status }))]);
      assert.equal(lifecycle.stage, stage);
    });
  }

  it('does not let a later running report walk back a terminal one, whatever the array order', async () => {
    const h = await createHarness();
    const record = await recordIn(h, 'accepted');
    const done = await entryOf(evidenceFor(h, record, { evidenceId: 'ev.done', status: 'completed', observedAt: '2026-01-01T00:02:00.000Z' }));
    const late = await entryOf(evidenceFor(h, record, { evidenceId: 'ev.late', status: 'running', observedAt: '2026-01-01T00:05:00.000Z' }));
    assert.equal(dispatchLifecycle(record, [done, late]).stage, 'returned');
    assert.deepEqual(dispatchLifecycle(record, [late, done]), dispatchLifecycle(record, [done, late]));
  });

  it('flags conflicting terminal reports and shows the latest', async () => {
    const h = await createHarness();
    const record = await recordIn(h, 'accepted');
    const a = await entryOf(evidenceFor(h, record, { evidenceId: 'ev.a', status: 'completed', observedAt: '2026-01-01T00:02:00.000Z' }));
    const b = await entryOf(evidenceFor(h, record, { evidenceId: 'ev.b', status: 'failed', observedAt: '2026-01-01T00:03:00.000Z' }));
    const lifecycle = dispatchLifecycle(record, [a, b]);
    assert.equal(lifecycle.stage, 'failed');
    assert.ok(lifecycle.anomalies.includes('conflicting-terminal-evidence'));
  });

  it('keeps a held handoff held whatever the evidence claims, and says so', async () => {
    const h = await createHarness();
    const record = await recordIn(h, 'held');
    const lifecycle = dispatchLifecycle(record, [await entryOf(evidenceFor(h, record, { status: 'completed' }))]);
    assert.equal(lifecycle.stage, 'held');
    assert.ok(lifecycle.anomalies.includes('evidence-while-held'));
  });

  it('never promotes an unknown, submitting or no-effect attempt from evidence', async () => {
    for (const state of ['unknown', 'submitting', 'no-effect', 'rejected'] as const) {
      const h = await createHarness();
      const record = await recordIn(h, state);
      const lifecycle = dispatchLifecycle(record, [await entryOf(evidenceFor(h, record, { status: 'completed' }))]);
      assert.equal(lifecycle.stage, STAGE_OF[state], state);
      assert.equal(lifecycle.evidence.counted, 0);
      assert.equal(lifecycle.evidence.ignored[0]?.reason, 'attempt-without-effect', state);
    }
  });

  it('ignores, and names, evidence that does not answer this handoff', async () => {
    const h = await createHarness();
    const record = await recordIn(h, 'accepted');
    const good = evidenceFor(h, record);
    const cases: readonly (readonly [string, ResultEvidence])[] = [
      ['other-dispatch', { ...good, dispatchId: 'dsp_elsewhere' as ResultEvidence['dispatchId'] }],
      ['packet-mismatch', { ...good, packet: { ...good.packet, packetDigest: `sha256:${'f'.repeat(64)}` } }],
      ['other-attempt', { ...good, attemptId: 'dsp_x.a9' as ResultEvidence['attemptId'] }],
      ['receipt-mismatch', { ...good, receiptId: 'rcpt_other' as ResultEvidence['receiptId'] }],
      ['host-mismatch', { ...good, execution: { ...good.execution, hostId: 'host.elsewhere' as ResultEvidence['execution']['hostId'] } }],
      ['model-mismatch', { ...good, execution: { ...good.execution, model: { provider: 'other', model: 'other' } } }],
      ['provenance-mismatch', { ...good, provenance: 'jones' }],
    ];
    for (const [reason, evidence] of cases) {
      const lifecycle = dispatchLifecycle(record, [await entryOf({ ...evidence, evidenceId: `ev.${reason}` as ResultEvidence['evidenceId'] })]);
      assert.equal(lifecycle.stage, 'queued', reason);
      assert.deepEqual(lifecycle.evidence.ignored.map((item) => item.reason), [reason]);
      assert.equal(lifecycle.evidence.counted, 0);
    }
  });
});

describe('dispatchLifecycle is a pure projection', () => {
  it('is deterministic, does not mutate frozen inputs and survives a JSON round trip', async (t) => {
    const h = await createHarness();
    const record = deepFreeze(structuredClone(await recordIn(h, 'accepted')));
    const entries = deepFreeze([await entryOf(evidenceFor(h, record, { status: 'running' }))]);
    t.mock.method(Date, 'now', () => { throw new Error('the projection must not read the clock'); });
    const first = dispatchLifecycle(record, entries);
    const second = dispatchLifecycle(record, entries);
    assert.deepEqual(first, second);
    assert.deepEqual(JSON.parse(JSON.stringify(first)), first);
    assert.equal(first.stage, 'running');
  });

  it('records no manual handoff history as a fence and never changes the stage with it', async () => {
    const h = await createHarness();
    const record = await recordIn(h, 'unknown');
    const manual = syntheticManualHandoff(h.packet);
    const lifecycle = dispatchLifecycle(record, [], { manualHandoffs: [manual] });
    assert.equal(lifecycle.stage, 'unknown', 'a manual record never resolves an unknown effect');
    assert.equal(lifecycle.send.status, 'fenced');
    assert.equal(lifecycle.routeHistory.acknowledgementRequired, true);
    assert.equal(dispatchLifecycle(record, [], { manualHandoffs: [{ ...manual, packetId: 'pkt.other' as typeof manual.packetId }] }).routeHistory.acknowledgementRequired, false);
  });
});

describe('pinned route in the lifecycle', () => {
  it('shows the pinned host, receiver and model, forbids fallback and shows freshness only when a catalog is consulted', async () => {
    const h = await createHarness();
    const record = await recordIn(h, 'accepted');
    const bare = dispatchLifecycle(record, []).route;
    assert.ok(bare);
    assert.equal(bare.source, 'dispatch-binding');
    assert.equal(bare.hostId, 'host.synthetic-laptop');
    assert.deepEqual(bare.model, { provider: 'synthetic', model: 'synthetic-model-1' });
    assert.equal(bare.fallback, 'forbidden');
    assert.equal(bare.freshness.status, 'unobserved');
    assert.deepEqual(bare.drift, []);
    assert.equal(bare.observed?.model?.model, 'synthetic-model-1');

    const catalog = syntheticCatalog();
    const fresh = dispatchLifecycle(record, [], { catalogDestination: catalog.destinations[0] ?? null }).route;
    assert.equal(fresh?.freshness.status, 'fresh');
    assert.deepEqual(fresh?.drift, []);
  });

  it('reports drift from the pin and a vanished destination without choosing another route', async () => {
    const h = await createHarness();
    const record = await recordIn(h, 'accepted');
    const rotated = syntheticDestination({
      identity: { hostId: 'host.other' as never, receiverId: 'receiver.synthetic-fake' as never, fingerprint: 'fp.rotated' },
      model: { provider: 'synthetic', model: 'synthetic-model-2' },
      freshness: { status: 'stale', lastSuccessAt: '2025-12-31T00:00:00.000Z', generation: 2 },
    });
    const lifecycle = dispatchLifecycle(record, [], { catalogDestination: rotated });
    assert.deepEqual(lifecycle.route?.drift, ['host', 'fingerprint', 'model']);
    assert.equal(lifecycle.route?.freshness.status, 'stale');
    assert.equal(lifecycle.route?.hostId, 'host.synthetic-laptop', 'the pin is unchanged');
    assert.ok(lifecycle.anomalies.includes('route-drift'));
    const gone = dispatchLifecycle(record, [], { catalogDestination: null });
    assert.deepEqual(gone.route?.drift, ['destination-missing']);
  });

  it('records a substituted model or host as a variance and recomputes it when the stored one is missing', async () => {
    const h = await createHarness();
    h.receiver.failNextSend('substitute-model');
    const record = await recordIn(h, 'accepted');
    const lifecycle = dispatchLifecycle(record, []);
    assert.deepEqual(lifecycle.route?.variances, ['model-mismatch']);
    assert.ok(lifecycle.anomalies.includes('route-variance'));
    assert.equal(lifecycle.stage, 'queued', 'a variance is shown, never retried');
    const stripped = structuredClone(record);
    const attempts = stripped.attempts.map((attempt) => ({ ...attempt, variances: [] }));
    assert.deepEqual(dispatchLifecycle({ ...stripped, attempts }, []).route?.variances, ['model-mismatch']);
  });

  it('shows an unpinned model honestly', async () => {
    const h = await createHarness();
    const record = await recordIn(h, 'accepted');
    const unpinned = { ...record, destination: { ...record.destination, model: null } };
    assert.equal(dispatchLifecycle(unpinned, []).route?.model, null);
  });
});
