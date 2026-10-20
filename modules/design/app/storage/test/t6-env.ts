/** Drives the real PR17 requests code (RequestStore/RequestSession) over a storage port. Synthetic data only. */
import type { RequestId, StoragePort as T6StoragePort } from '../../../requests/src/contract.ts';
import { ManualSchedulerFake, SequentialIdsFake, StepClockFake } from '../../../requests/src/fakes.ts';
import { RequestSession } from '../../../requests/src/session.ts';
import { RequestStore } from '../../../requests/src/store.ts';
import { annotation, connectorReturn, DESTINATION, evidence, imageBytes, source, versionless } from '../../../requests/test/fixtures.ts';

export { connectorReturn, imageBytes, versionless };
export { LifecycleConnectorFake } from '../../../requests/src/fakes.ts';

export interface T6Context {
  readonly clock: StepClockFake;
  readonly ids: SequentialIdsFake;
  readonly scheduler: ManualSchedulerFake;
}

export const newT6Context = (): T6Context => ({ clock: new StepClockFake(), ids: new SequentialIdsFake(), scheduler: new ManualSchedulerFake() });

export function t6Store(storage: T6StoragePort, context: T6Context): RequestStore {
  return new RequestStore({ storage, clock: context.clock, ids: context.ids });
}

export function t6Session(store: RequestStore, context: T6Context, requestId: RequestId): Promise<RequestSession> {
  return RequestSession.open(store, context.scheduler, requestId, { now: () => context.clock.now(), debounceMs: 400 });
}

/** A request with edits flushed to storage, ready to freeze. */
export async function t6ReadyDraft(store: RequestStore, context: T6Context, title = 'Tighten home heading', options: { readonly destination?: boolean } = {}) {
  const created = await store.createRequest({ title, sources: [source()] });
  const session = await t6Session(store, context, created.requestId);
  session.edit({ type: 'set-intent', intent: 'Reduce the gap above the second heading.' });
  session.edit({ type: 'add-annotation', annotation: annotation('A') });
  session.edit({ type: 'add-evidence', evidence: evidence() });
  if (options.destination) session.edit({ type: 'set-destination', destination: DESTINATION });
  await session.flush();
  return { requestId: created.requestId, session };
}
