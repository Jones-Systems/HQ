/** spec.hq-design#test.connector.001 — result-evidence/v1 intake. */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Attempt } from '../src/dispatch.ts';
import type { DispatchId } from '../src/ids.ts';
import type { ResultEvidence } from '../src/evidence.ts';
import { createMemoryEvidenceStore, syntheticEvidence } from '../src/fakes.ts';
import { intakeEvidence } from '../src/evidence.ts';
import { createHarness } from './harness.ts';

async function acceptedFixture(fault?: 'hold' | 'throw-after-effect') {
  const h = await createHarness();
  if (fault) h.receiver.failNextSend(fault);
  const result = await h.outbox.submit(h.request());
  assert.equal(result.outcome, 'attempted');
  const { dispatchId, attempt } = result as { dispatchId: DispatchId; attempt: Attempt };
  const evidenceStore = createMemoryEvidenceStore();
  const intake = (value: unknown) => intakeEvidence({ outbox: h.store, evidence: evidenceStore, clock: h.clock }, value);
  const receipt = h.receiver.receiptFor(attempt.idempotencyKey);
  assert.ok(receipt);
  const evidence = syntheticEvidence({ dispatchId, attemptId: attempt.attemptId, receipt, packet: h.packet, model: h.destination.model ?? null });
  return { h, dispatchId, attempt, evidenceStore, intake, evidence };
}

const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as ResultEvidence;

describe('result-evidence/v1 intake', () => {
  it('accepts matching evidence and keeps it labelled fake', async () => {
    const { intake, evidence, evidenceStore, dispatchId } = await acceptedFixture();
    const result = await intake(json(evidence));
    assert.ok(result.ok);
    assert.equal(result.entry.fake, true);
    assert.equal(result.entry.evidence.provenance, 'fake');
    assert.equal(result.duplicate, false);
    assert.equal((await evidenceStore.listByDispatch(dispatchId)).length, 1);
  });

  it('rejects evidence whose packet digest does not match', async () => {
    const { intake, evidence, evidenceStore } = await acceptedFixture();
    const result = await intake(json({ ...evidence, packet: { ...evidence.packet, packetDigest: `sha256:${'f'.repeat(64)}` } }));
    assert.deepEqual(result.ok ? null : result.code, 'packet-digest-mismatch');
    assert.equal(evidenceStore.entries.length, 0);
  });

  it('rejects evidence for another packet ID', async () => {
    const { intake, evidence } = await acceptedFixture();
    const result = await intake(json({ ...evidence, packet: { ...evidence.packet, packetId: 'pkt.other' } }));
    assert.equal(result.ok ? null : result.code, 'packet-digest-mismatch');
  });

  it('is idempotent for identical evidence and refuses a changed payload under the same ID', async () => {
    const { intake, evidence, evidenceStore } = await acceptedFixture();
    assert.ok((await intake(json(evidence))).ok);
    const again = await intake(json(evidence));
    assert.ok(again.ok && again.duplicate);
    const changed = await intake(json({ ...evidence, candidate: { ...evidence.candidate, summary: 'rewritten' } }));
    assert.equal(changed.ok ? null : changed.code, 'evidence-conflict');
    assert.equal(evidenceStore.entries.length, 1);
    assert.equal(evidenceStore.entries[0]?.evidence.candidate.summary, evidence.candidate.summary);
  });

  it('refuses receiver claims of owner judgement', async () => {
    const { intake, evidence } = await acceptedFixture();
    const result = await intake(json({ ...evidence, claimLevel: 'owner-judged' }));
    assert.equal(result.ok ? null : result.code, 'claim-level-forbidden');
  });

  it('refuses evidence from another host, receiver or model', async () => {
    const { intake, evidence } = await acceptedFixture();
    const host = await intake(json({ ...evidence, execution: { ...evidence.execution, hostId: 'host.elsewhere' } }));
    assert.equal(host.ok ? null : host.code, 'host-mismatch');
    const model = await intake(json({ ...evidence, execution: { ...evidence.execution, model: { provider: 'other', model: 'other' } } }));
    assert.equal(model.ok ? null : model.code, 'model-mismatch');
  });

  it('refuses fake evidence relabelled as Jones', async () => {
    const { intake, evidence } = await acceptedFixture();
    const result = await intake(json({ ...evidence, provenance: 'jones' }));
    assert.equal(result.ok ? null : result.code, 'provenance-mismatch');
  });

  it('refuses mismatched receipts, unknown dispatches and unknown attempts', async () => {
    const { intake, evidence } = await acceptedFixture();
    assert.equal(((r) => r.ok ? null : r.code)(await intake(json({ ...evidence, receiptId: 'rcpt_other' }))), 'receipt-mismatch');
    assert.equal(((r) => r.ok ? null : r.code)(await intake(json({ ...evidence, dispatchId: 'dsp_missing' }))), 'unknown-dispatch');
    assert.equal(((r) => r.ok ? null : r.code)(await intake(json({ ...evidence, attemptId: 'dsp_x.a9' }))), 'unknown-attempt');
  });

  it('refuses evidence for an attempt whose effect is still unknown', async () => {
    const { intake, evidence } = await acceptedFixture('throw-after-effect');
    const result = await intake(json(evidence));
    assert.equal(result.ok ? null : result.code, 'attempt-not-accepted');
  });

  it('accepts evidence for a held attempt', async () => {
    const { intake, evidence } = await acceptedFixture('hold');
    assert.ok((await intake(json(evidence))).ok);
  });

  it('rejects malformed and future-version documents with no write', async () => {
    const { intake, evidence, evidenceStore } = await acceptedFixture();
    const future = await intake(json({ ...evidence, schema: 'hq.design.result-evidence/v2' }));
    assert.equal(future.ok ? null : future.code, 'unsupported-schema');
    const extra = await intake({ ...json(evidence), surprise: true });
    assert.equal(extra.ok ? null : extra.code, 'malformed');
    assert.equal((await intake('nope')).ok, false);
    assert.equal(evidenceStore.entries.length, 0);
  });
});
