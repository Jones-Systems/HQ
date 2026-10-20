import type { DomainDestination, DomainId, ReferenceEnvelope } from './index.js';

export const REFERENCE_STATUSES = ['available', 'changed', 'archived', 'missing', 'moved', 'forbidden', 'unavailable', 'unknown'] as const;
export type ReferenceStatus = (typeof REFERENCE_STATUSES)[number];
export interface ReferenceResolution {
  readonly status: ReferenceStatus; readonly observedAt: string;
  readonly latestTitle?: string; readonly latestRevision?: string; readonly targetProjectId?: string;
  readonly destination?: string;
}
export interface ReferenceProvider {
  readonly domain: DomainId; readonly kinds: readonly string[];
  find(query: string, scope: { projectId: string; kinds?: readonly string[]; limit: number }): Promise<readonly ReferenceEnvelope[]>;
  resolve(envelope: ReferenceEnvelope): Promise<ReferenceResolution>;
}
export interface ReturnContext { readonly label: string; readonly to: DomainDestination }
export interface ReferencePort {
  find(query: string, scope: { projectId: string; domains?: readonly DomainId[]; kinds?: readonly string[]; limit: number }): Promise<readonly ReferenceEnvelope[]>;
  resolve(envelope: ReferenceEnvelope): Promise<ReferenceResolution>;
  open(envelope: ReferenceEnvelope, returnTo: ReturnContext): void;
}
