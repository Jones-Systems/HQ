import assert from 'node:assert/strict';
import type { EvidenceStorePort, OutboxStorePort } from '../../../connector/src/contract.ts';
import { createMemoryEvidenceStore, createMemoryOutboxStore } from '../../../connector/src/fakes.ts';
import { CrashingStorageFake, ManualSchedulerFake } from '../../../requests/src/fakes.ts';
import { brandId } from '../../../requests/src/validate.ts';
import type { SourceRef } from '../../../requests/src/contract.ts';
import { MemoryReferenceStorage } from '../../../references/src/fakes.ts';
import { createRequestsEnvironment, type SectionIds } from '../requests/env.ts';
import { createRunsEnvironment } from '../runs/env.ts';
import { SIMULATED_DESTINATION } from '../runs/pipeline.ts';

export const source: SourceRef = {
  projectId: brandId('synthetic-project'), viewId: brandId('synthetic-view'), versionId: brandId('synthetic-v1'),
  sourceRevision: 'synthetic-revision',
};
export const compareSlot = () => null;

export function doubles() {
  const storage = new CrashingStorageFake();
  const referenceStorage = new MemoryReferenceStorage();
  const outbox = createMemoryOutboxStore();
  const evidence = createMemoryEvidenceStore();
  const scheduler = new ManualSchedulerFake();
  let sequence = 0;
  const ids: SectionIds = { label: 'fake:section-ids', next: (kind) => `synthetic-${kind}-${++sequence}` };
  let time = Date.parse('2026-01-01T00:00:00.000Z');
  const clock = { label: 'fake:section-clock', now: () => new Date(time).toISOString() };
  const writes: string[] = [];
  let failEvidence: 'before' | 'after' | null = null;
  const outboxStore: OutboxStorePort = {
    get: (id) => outbox.get(id), list: () => outbox.list(),
    async put(record, revision) {
      const keys = await storage.listDocuments('workspace', 'design/requests/');
      const sends = keys.filter((key) => key.includes('/sends/')).map((key) => JSON.parse(new TextDecoder().decode(storage.peek('workspace', key)!)));
      assert.ok(sends.some((send) => send.packet.packetId === record.packet.packetId
        && send.packet.authoringDigest === record.packet.packetDigest), 'T6 send record must precede EVERY outbox write');
      writes.push(`outbox:${record.attempts.at(-1)!.state}`);
      return outbox.put(record, revision);
    },
  };
  const evidenceStore: EvidenceStorePort = {
    get: (id) => evidence.get(id), listByDispatch: (id) => evidence.listByDispatch(id),
    async append(entry) {
      const failure = failEvidence; failEvidence = null;
      if (failure === 'before') throw new Error('synthetic evidence crash before durability');
      const result = await evidence.append(entry);
      writes.push('evidence');
      if (failure === 'after') throw new Error('synthetic evidence acknowledgement lost');
      return result;
    },
  };
  const originalCreate = storage.createDocument.bind(storage);
  storage.createDocument = async (ns, key, bytes) => {
    if (key.includes('/candidates/') && key.includes('/sim.')) {
      assert.ok(evidence.entries.length > 0, 'evidence must be durable before inbox projection');
      writes.push('candidate');
    }
    return originalCreate(ns, key, bytes);
  };
  return {
    storage, referenceStorage, outbox, outboxStore, evidence, evidenceStore, clock, ids, scheduler, writes,
    advance: () => { time += 1_000; },
    crashEvidence: (failure: 'before' | 'after') => { failEvidence = failure; },
    async open() {
      const requests = createRequestsEnvironment({ storage, clock, ids, scheduler, compareSlot });
      const runs = await createRunsEnvironment({ mode: 'example', requests, outboxStore, evidenceStore, clock, ids, compareSlot });
      return { requests, runs };
    },
  };
}

export async function frozen(d = doubles()) {
  const { requests, runs } = await d.open();
  const session = await requests.create({ title: 'Synthetic request', sources: [source] });
  session.edit({ type: 'set-intent', intent: 'Tighten the synthetic hero spacing.' });
  session.edit({ type: 'set-destination', destination: SIMULATED_DESTINATION });
  session.edit({ type: 'ask', clarificationId: brandId('synthetic-question'), question: 'Keep the heading?' });
  session.edit({ type: 'answer', clarificationId: brandId('synthetic-question'), answer: 'Yes.' });
  const packet = await runs.pipeline.freeze(session);
  assert.ok(packet);
  await runs.pipeline.selectPacket(session, packet.packetId);
  return { d, requests, runs, session, packet };
}

export async function sent() {
  const fixture = await frozen();
  fixture.runs.controller.requestSend();
  const result = await fixture.runs.controller.confirm();
  assert.equal(result?.outcome, 'attempted');
  if (result?.outcome !== 'attempted') throw new Error('expected simulated attempt');
  assert.equal(result.attempt.state, 'accepted');
  return { ...fixture, result, dispatchId: result.dispatchId };
}
