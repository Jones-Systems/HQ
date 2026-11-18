import type { ReferenceEnvelope } from '@hq/contracts';
import type { ReferenceRecord, ReferenceUse } from './contract.ts';

export const REFERENCE_ENTITY_KIND = 'design.reference';

/** Module-local destination for one reference; opaque to the shell. */
export function referenceDestination(id: ReferenceRecord['id']): string {
  return `references/${id}`;
}

/**
 * Readable navigation envelope for a "use in project" link. It survives a
 * missing target and grants nothing; following it never starts work.
 */
export function toReferenceEnvelope(record: ReferenceRecord, use: ReferenceUse): ReferenceEnvelope {
  return {
    version: 1,
    domain: 'design',
    projectId: use.projectId,
    kind: REFERENCE_ENTITY_KIND,
    entityId: record.id,
    title: record.title,
    returnDestination: { domain: 'design', destination: referenceDestination(record.id) },
  };
}
