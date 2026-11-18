import { use } from 'react';
import type { DesignSectionProps } from '../../../ui/contract.ts';
import type { SourceRef } from '../../../requests/src/contract.ts';
import { CrashingStorageFake, SequentialIdsFake, StepClockFake } from '../../../requests/src/fakes.ts';
import { RequestSession } from '../../../requests/src/session.ts';
import { RequestStore } from '../../../requests/src/store.ts';
import { brandId } from '../../../requests/src/validate.ts';
import { CompareSlotFake, RequestsView } from '../../../requests/ui/RequestsView.tsx';
import { PreviewFrame } from '../../PreviewFrame.tsx';
import { browserScheduler, perProject } from '../../seeds.ts';

const load = perProject(async (project) => {
  const clock = new StepClockFake();
  const store = new RequestStore({ storage: new CrashingStorageFake(), clock, ids: new SequentialIdsFake() });
  const source: SourceRef = {
    projectId: brandId(project.id), viewId: brandId(`${project.id}-view-home`), versionId: brandId(`${project.id}-home-v1`),
    sourceRevision: 'rev-synthetic-1',
  };
  const created = await store.createRequest({ title: 'Tighten the home hero', sources: [source] });
  const session = await RequestSession.open(store, browserScheduler, created.requestId, { now: () => clock.now(), debounceMs: 400 });
  let counter = 0;
  return { session, newId: (kind: 'clarification' | 'attachment') => `preview-${kind}-${(counter += 1)}` };
});

/** No dispatch slot is supplied, so sending is visibly unavailable; nothing reaches the connector. */
export function RequestsPreview({ context }: DesignSectionProps) {
  const { session, newId } = use(load(context));
  return <PreviewFrame lane="T6 requests" entry="requests/ui › RequestsView"
    notes={['no dispatch slot: sending unavailable', 'compare slot is the lane’s labelled fake', 'in-memory fake store']}>
    <RequestsView session={session} CompareSlot={CompareSlotFake} dispatch={null} newId={newId} />
  </PreviewFrame>;
}
