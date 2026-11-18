import { parseReference, type DomainId, type ReferenceEnvelope } from '@hq/contracts';
import type { ReferenceResolution } from '@hq/ui';
import type { PlannerPort } from '../core';

export interface ReferenceProvider {
  readonly domain: DomainId;
  readonly kinds: readonly string[];
  find(query: string, scope: { projectId: string; kinds?: readonly string[]; limit: number }): Promise<readonly ReferenceEnvelope[]>;
  resolve(envelope: ReferenceEnvelope): Promise<ReferenceResolution>;
}

/** Bound to one Planner project; only its read surface is retained. */
export function createWorkReferenceProvider(
  projectId: string, reader: Pick<PlannerPort, 'snapshot'>, now: () => Date = () => new Date(),
): ReferenceProvider {
  return {
    domain: 'work', kinds: ['item'],
    async find(query, scope) {
      if (scope.projectId !== projectId || (scope.kinds && !scope.kinds.includes('item'))
        || !Number.isSafeInteger(scope.limit) || scope.limit <= 0) return [];
      const snapshot = await reader.snapshot();
      return snapshot.items.filter((item) => item.title.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))
        .slice(0, Math.min(scope.limit, 30)).flatMap((item) => {
          const envelope = parseReference({ version: 1, domain: 'work', projectId, kind: 'item', entityId: item.id,
            title: item.title, sourceRevision: String(item.revision),
            returnDestination: { domain: 'work', destination: `item/${item.id}` } });
          return envelope ? [envelope] : [];
        });
    },
    async resolve(value) {
      const observedAt = () => now().toISOString();
      const envelope = parseReference(value);
      if (!envelope || envelope.domain !== 'work' || envelope.kind !== 'item') return { status: 'unknown', observedAt: observedAt() };
      // A provider cannot inspect another project's store to infer whether an item moved.
      if (envelope.projectId !== projectId) return { status: 'unknown', observedAt: observedAt(), targetProjectId: projectId };
      try {
        const snapshot = await reader.snapshot();
        const item = snapshot.items.find((candidate) => candidate.id === envelope.entityId);
        if (!item) return { status: 'missing', observedAt: observedAt() };
        return {
          status: item.archived_at ? 'archived' : envelope.sourceRevision !== undefined && envelope.sourceRevision !== String(item.revision) ? 'changed' : 'available',
          observedAt: snapshot.observedAt, latestTitle: item.title, latestRevision: String(item.revision),
          targetProjectId: projectId, destination: `item/${item.id}`,
        };
      } catch { return { status: 'unavailable', observedAt: observedAt() }; }
    },
  };
}
