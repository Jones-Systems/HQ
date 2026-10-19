/** Synthetic fixtures only. Nothing here is owner data or real capability evidence. */
import type {
  AnnotationRef, CandidateId, ClaimId, EvidenceRef, PacketLink, RequestId, ReturnedCandidate, SourceRef, VersionId,
} from '../src/contract.ts';
import { CrashingStorageFake, DispatchSpyFake, ManualSchedulerFake, SequentialIdsFake, StepClockFake } from '../src/fakes.ts';
import { RequestSession } from '../src/session.ts';
import { RequestStore } from '../src/store.ts';
import { brandId } from '../src/validate.ts';

export function source(version = 'v-a1'): SourceRef {
  return { projectId: brandId('fixture-project'), viewId: brandId('fixture-view-home'), versionId: brandId(version), sourceRevision: `rev-${version}` };
}

export function annotation(letter = 'A'): AnnotationRef {
  return {
    id: brandId(`ann-${letter}`), letter, kind: 'pick', note: `Tighten spacing near ${letter}`,
    anchor: {
      versionId: brandId('v-a1'), route: '/home', state: 'default', viewport: { w: 1280, h: 800, dpr: 2 }, scroll: { x: 0, y: 120 },
      captureDigest: 'sha256:fixture-capture',
      target: { kind: 'element', path: 'main > section:nth-child(2) > h2', rect: { x: 40, y: 200, width: 600, height: 48 } },
    },
  };
}

export function evidence(id = 'ev-capture-1'): EvidenceRef {
  return { evidenceId: brandId(id), kind: 'capture', label: 'Baseline capture', digest: 'sha256:fixture-evidence', versionId: brandId('v-a1') };
}

/** A first-paint PNG-like byte sequence; not a real image. */
export function imageBytes(seed: number): Uint8Array {
  const bytes = new Uint8Array(64);
  bytes.set([0x89, 0x50, 0x4e, 0x47]);
  for (let index = 4; index < bytes.length; index += 1) bytes[index] = (seed * 31 + index * 7) % 256;
  return bytes;
}

export function candidate(packet: PacketLink, id = 'cand-1'): ReturnedCandidate {
  return {
    candidateId: brandId<'CandidateId'>(id) as CandidateId, packet,
    baselineVersionId: brandId<'VersionId'>('v-a1') as VersionId, candidateVersionId: brandId<'VersionId'>('v-a2') as VersionId,
    claims: [
      { claimId: brandId<'ClaimId'>('claim-spacing') as ClaimId, text: 'Heading spacing reduced to 24px.', level: 'agent-reported', evidence: [] },
      { claimId: brandId<'ClaimId'>('claim-capture') as ClaimId, text: 'Capture shows the new spacing.', level: 'observed', evidence: [evidence('ev-cand-capture')] },
    ],
    observedStatus: 'returned', observedAt: '2026-01-02T00:00:00.000Z', evidence: [evidence('ev-cand-capture')],
  };
}

export function env() {
  const storage = new CrashingStorageFake();
  const clock = new StepClockFake();
  const ids = new SequentialIdsFake();
  const scheduler = new ManualSchedulerFake();
  const dispatch = new DispatchSpyFake();
  const store = new RequestStore({ storage, clock, ids });
  const options = { now: () => clock.now(), debounceMs: 400 };
  return {
    storage, clock, ids, scheduler, dispatch, store, options,
    /** Simulates an app restart: new store and session instances over the same durable storage. */
    async restart(requestId: RequestId) {
      storage.restart();
      const fresh = new RequestStore({ storage, clock, ids });
      return { store: fresh, session: await RequestSession.open(fresh, scheduler, requestId, options) };
    },
    open: (requestId: RequestId) => RequestSession.open(store, scheduler, requestId, options),
  };
}

export type Env = ReturnType<typeof env>;

/** A request whose draft is ready to freeze. */
export async function readyDraft(e: Env) {
  const created = await e.store.createRequest({ title: 'Tighten home heading', sources: [source()] });
  const session = await e.open(created.requestId);
  session.edit({ type: 'set-intent', intent: 'Reduce the gap above the second heading.\nKeep the hero unchanged — “exactly”. 🎯' });
  session.edit({ type: 'add-annotation', annotation: annotation('A') });
  session.edit({ type: 'add-evidence', evidence: evidence() });
  await session.flush();
  return { requestId: created.requestId, session };
}

export const decoder = new TextDecoder();
