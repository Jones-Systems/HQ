import type { ReferenceEnvelope } from '@hq/contracts';
import { REFERENCE_STATUSES, type ReferenceEntry } from '../../src/references/types';

export const NOW = Date.parse('2026-10-20T12:00:30Z');
export const OBSERVED = '2026-10-20T12:00:00Z';
export const envelope = (entityId = 'brief', title = 'Autumn campaign brief'): ReferenceEnvelope => ({
  version: 1, domain: 'design', projectId: 'demo-project', kind: 'document', entityId, title,
  returnDestination: { domain: 'design', destination: 'documents' }, sourceRevision: 'r1', workspaceId: 'demo-workspace',
});
export const entries: readonly ReferenceEntry[] = REFERENCE_STATUSES.map((status) => ({
  envelope: envelope(status, `${status[0]!.toUpperCase() + status.slice(1)} · Autumn campaign brief`),
  resolution: {
    status, observedAt: OBSERVED, ...(status === 'changed' ? { latestTitle: 'Autumn campaign brief — approved', latestRevision: 'r2' } : {}),
    ...(status === 'moved' ? { targetProjectId: 'other-project' } : {}),
  },
}));
