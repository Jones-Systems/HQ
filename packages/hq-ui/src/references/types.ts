import type { DomainDestination, DomainId, ReferenceEnvelope } from '@hq/contracts';

// Local structural additions from spec.hq-social-work#iface.references.001.
// The shared-contract owner proves assignability; the existing envelope/parser remain canonical.
export const REFERENCE_STATUSES = ['available', 'changed', 'archived', 'missing', 'moved', 'forbidden', 'unavailable', 'unknown'] as const;
export type ReferenceStatus = (typeof REFERENCE_STATUSES)[number];
export interface ReferenceResolution {
  readonly status: ReferenceStatus;
  readonly observedAt: string;
  readonly latestTitle?: string;
  readonly latestRevision?: string;
  readonly targetProjectId?: string;
  readonly destination?: string;
}
export interface ReturnContext { readonly label: string; readonly to: DomainDestination }
export interface ReferencePort {
  find(query: string, scope: { projectId: string; domains?: readonly DomainId[]; kinds?: readonly string[]; limit: number }): Promise<readonly ReferenceEnvelope[]>;
  resolve(envelope: ReferenceEnvelope): Promise<ReferenceResolution>;
  open(envelope: ReferenceEnvelope, returnTo: ReturnContext): void;
}
export interface ReferenceEntry {
  readonly envelope: ReferenceEnvelope;
  readonly resolution?: ReferenceResolution;
  /** Allows the cache owner to invalidate an observation before its age limit. */
  readonly stale?: boolean;
}
export interface ReferenceUndo {
  /** The source owner performs a versioned inverse mutation; targets are never written. */
  readonly undo: () => void | Promise<void>;
}
export interface ReferenceSnapshotUpdate {
  readonly title: string;
  readonly sourceRevision: string;
}
export function referenceKey(envelope: ReferenceEnvelope): string {
  return JSON.stringify([envelope.domain, envelope.kind, envelope.entityId]);
}
