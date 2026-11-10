import type { ComponentType } from 'react';
import type { ClockPort, CompareSlotProps, IdKind, SchedulerPort, StoragePort } from '../../../requests/src/contract.ts';
import { RequestSession } from '../../../requests/src/session.ts';
import { RequestStore } from '../../../requests/src/store.ts';
import { brandId } from '../../../requests/src/validate.ts';

export type CompareSlot = ComponentType<CompareSlotProps>;
export interface SectionClock extends ClockPort { readonly label: string }
export interface SectionIds {
  readonly label: string;
  next(kind: IdKind | 'col' | 'use' | 'connector-session' | 'confirmation' | 'evidence'): string;
}

export interface RequestsEnvironmentOptions {
  readonly storage: StoragePort;
  readonly clock: SectionClock;
  readonly ids: SectionIds;
  readonly scheduler: SchedulerPort;
  readonly compareSlot: CompareSlot;
}

export interface RequestsEnvironment {
  readonly store: RequestStore;
  readonly compareSlot: CompareSlot;
  readonly clock: SectionClock;
  newId(kind: 'clarification' | 'attachment'): string;
  open(requestId: string): Promise<RequestSession>;
  create(init?: Parameters<RequestStore['createRequest']>[0]): Promise<RequestSession>;
}

/** Opening reads existing state; only the explicit create action creates a request. */
export function createRequestsEnvironment(options: RequestsEnvironmentOptions): RequestsEnvironment {
  const store = new RequestStore(options);
  const open = (requestId: string) => RequestSession.open(store, options.scheduler, brandId<'RequestId'>(requestId), {
    now: () => options.clock.now(),
  });
  return {
    store, open, clock: options.clock, compareSlot: options.compareSlot,
    newId: (kind) => options.ids.next(kind),
    async create(init) { return open((await store.createRequest(init)).requestId); },
  };
}
