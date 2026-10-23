import type { ReferenceEnvelope } from '@hq/contracts';

// Synthetic data only.
export const envelope: ReferenceEnvelope = {
  version: 1, domain: 'work', projectId: 'synthetic-project', kind: 'item', entityId: 'it-seed',
  title: 'Sort the seed packets', returnDestination: { domain: 'work', destination: 'item/it-seed' }, sourceRevision: '1',
};
