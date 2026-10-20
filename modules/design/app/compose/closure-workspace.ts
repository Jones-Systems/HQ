import { createElement } from 'react';
import type { WorkspaceRecords } from '../storage/index.ts';
import { createRequestsStoragePort, createOutboxAdapter, createEvidenceStore, createReferencesStorage, DEVICE_STORAGE_LABEL } from '../storage/index.ts';
import type { Digest, SchedulerPort } from '../../requests/src/contract.ts';
import type { DispatchRecord } from '../../connector/src/dispatch.ts';
import type { DispatchId } from '../../connector/src/ids.ts';
import { CrashingStorageFake } from '../../requests/src/fakes.ts';
import { createMemoryOutboxStore, createMemoryEvidenceStore } from '../../connector/src/fakes.ts';
import { MemoryReferenceStorage } from '../../references/src/fakes.ts';
import { createRequestsEnvironment } from '../sections/requests/env.ts';
import type { RequestsEnvironment, CompareSlot, SectionIds } from '../sections/requests/env.ts';
import { createRunsEnvironment } from '../sections/runs/env.ts';
import { createReferencesEnvironment } from '../sections/references/env.ts';
import { FAKE_TAG } from './labels.ts';

const compareSlot: CompareSlot = ({ label }) => createElement('p', { role: 'note' }, `${label}: comparison capture capability unavailable.`);
function scheduler(): SchedulerPort {
  let next = 0;
  const timers = new Map<number, ReturnType<typeof globalThis.setTimeout>>();
  return {
    setTimeout(callback, ms) {
      const id = ++next;
      timers.set(id, globalThis.setTimeout(() => { timers.delete(id); callback(); }, ms));
      return id;
    },
    clearTimeout(handle) {
      if (typeof handle !== 'number') return;
      const timer = timers.get(handle);
      if (timer !== undefined) { globalThis.clearTimeout(timer); timers.delete(handle); }
    },
  };
}

/** The bridge and the explicit unbridged fake each own one shared closure environment. */
export function createClosureWorkspace(records: WorkspaceRecords | null) {
  const label = records === null ? FAKE_TAG.text : DEVICE_STORAGE_LABEL;
  const clock = { label: 'Device clock', now: () => new Date().toISOString() };
  const ids: SectionIds = { label: 'Device random IDs', next: (kind) => `${kind}_${globalThis.crypto.randomUUID()}` };
  const baseRequests = createRequestsEnvironment({ storage: records === null ? new CrashingStorageFake()
    : createRequestsStoragePort<Digest>({ workspace: records }), clock, ids, scheduler: scheduler(), compareSlot });
  const sessions = new Map<string, ReturnType<RequestsEnvironment['open']>>();
  const requests: RequestsEnvironment = {
    ...baseRequests,
    open(id) {
      let session = sessions.get(id);
      if (!session) { session = baseRequests.open(id); sessions.set(id, session); }
      return session;
    },
    async create(init) {
      const session = await baseRequests.create(init);
      sessions.set(session.state.requestId, Promise.resolve(session));
      return session;
    },
  };
  const outboxStore = records === null ? createMemoryOutboxStore() : createOutboxAdapter<DispatchRecord, DispatchId>(records);
  const evidenceStore = records === null ? createMemoryEvidenceStore() : createEvidenceStore(records);
  const referenceStorage = records === null ? new MemoryReferenceStorage() : createReferencesStorage(records);
  let runs: ReturnType<typeof createRunsEnvironment> | undefined;
  let references: ReturnType<typeof createReferencesEnvironment> | undefined;
  return {
    label, requests, outboxStore, evidenceStore, referenceStorage,
    runs: () => runs ??= createRunsEnvironment({ requests, outboxStore, evidenceStore, clock, ids, compareSlot }),
    references: () => references ??= createReferencesEnvironment({ storage: referenceStorage, clock, ids, compareSlot, previewUrl: () => null,
      readBlob: records === null
        ? async (digest) => (referenceStorage as MemoryReferenceStorage).blobs.get(digest)?.bytes.slice() ?? null
        : (digest) => records.getBlob(digest) }),
  };
}
