import type { ReferenceEnvelope, ReferenceProvider, ReferenceResolution, ReferenceStatus } from '@hq/contracts';
import { formatDestination, parseDestination } from '../../ui/src/navigation.ts';

export type DesignReferenceKind = 'project' | 'version' | 'request' | 'reference';
const kinds: readonly DesignReferenceKind[] = Object.freeze(['project', 'version', 'request', 'reference']);

/** Current, authoritative projection supplied by the integration owner, never a cached guess.
 * References use explicit project membership; adapters must not infer it from titles.
 * A destination is a T14 location, not an entity URL or an execution target.
 */
export interface DesignReferenceRecord {
  readonly kind: DesignReferenceKind;
  readonly entityId: string;
  readonly projectId: string;
  readonly title: string;
  readonly revision?: string;
  readonly workspaceId?: string;
  readonly archived: boolean;
  readonly destination?: string;
}

export type DesignReferenceRead =
  | { readonly status: 'found'; readonly record: DesignReferenceRecord }
  | { readonly status: Extract<ReferenceStatus, 'missing' | 'forbidden' | 'unavailable' | 'unknown'> };

/** Read-only projection boundary. Missing means authoritative absence, not a failed read.
 * Stale/partial/unsupported reads must return unknown or unavailable, never found.
 * list rejects on failure; it must not turn an unavailable store into an empty search.
 */
export interface DesignReferenceReads {
  list(projectId: string): Promise<readonly DesignReferenceRecord[]>;
  read(kind: DesignReferenceKind, entityId: string, projectId: string): Promise<DesignReferenceRead>;
}

function isKind(kind: string): kind is DesignReferenceKind {
  return kinds.some((candidate) => candidate === kind);
}

function destination(value: string | undefined): string | undefined {
  // T14 falls back on invalid inputs. Only an exact round trip is openable.
  return value !== undefined && formatDestination(parseDestination(value)) === value ? value : undefined;
}

function text(value: string, max = 160): boolean {
  return value.length > 0 && value.length <= max && value.trim() === value && !/[\u0000-\u001f\u007f]/u.test(value);
}

function valid(record: DesignReferenceRecord): boolean {
  return isKind(record.kind) && text(record.entityId) && text(record.projectId) && text(record.title, 300)
    && (record.revision === undefined || text(record.revision, 300))
    && (record.workspaceId === undefined || text(record.workspaceId));
}

/** No registration, storage ownership, navigation, snapshot mutation or execution capability. */
export function createDesignReferenceProvider(reads: DesignReferenceReads, now: () => string): ReferenceProvider {
  return {
    domain: 'design', kinds,
    async find(query, scope) {
      if (!Number.isSafeInteger(scope.limit) || scope.limit <= 0) return [];
      if (scope.kinds !== undefined && !scope.kinds.some(isKind)) return [];
      const records = await reads.list(scope.projectId);
      const found: ReferenceEnvelope[] = [];
      const seen = new Set<string>();
      const needle = query.trim().toLowerCase();
      for (const record of records) {
        const to = destination(record.destination);
        if (!valid(record) || record.archived || record.projectId !== scope.projectId || to === undefined
          || (scope.kinds !== undefined && !scope.kinds.includes(record.kind))
          || !record.title.toLowerCase().includes(needle)) continue;
        const key = JSON.stringify([record.kind, record.entityId]);
        if (seen.has(key)) continue;
        seen.add(key);
        found.push({ version: 1, domain: 'design', kind: record.kind, entityId: record.entityId,
          projectId: record.projectId, title: record.title, returnDestination: { domain: 'design', destination: to },
          ...(record.revision === undefined ? {} : { sourceRevision: record.revision }),
          ...(record.workspaceId === undefined ? {} : { workspaceId: record.workspaceId }) });
        if (found.length === scope.limit) break;
      }
      return found;
    },
    async resolve(envelope) {
      const result = (value: Omit<ReferenceResolution, 'observedAt'>): ReferenceResolution => ({ ...value, observedAt: now() });
      if (envelope.domain !== 'design' || !isKind(envelope.kind)) return result({ status: 'unknown' });
      let read: DesignReferenceRead;
      try { read = await reads.read(envelope.kind, envelope.entityId, envelope.projectId); }
      catch { return result({ status: 'unavailable' }); }
      if (read.status !== 'found') return result({ status: read.status });
      const record = read.record;
      if (!valid(record) || record.kind !== envelope.kind || record.entityId !== envelope.entityId) return result({ status: 'unknown' });
      const status: ReferenceStatus = record.archived ? 'archived'
        : record.projectId !== envelope.projectId ? 'moved'
        : envelope.sourceRevision !== undefined && record.revision === undefined ? 'unknown'
        : record.title !== envelope.title || (envelope.sourceRevision !== undefined && record.revision !== envelope.sourceRevision) ? 'changed'
        : 'available';
      const to = destination(record.destination);
      return result({ status, latestTitle: record.title, targetProjectId: record.projectId,
        ...(record.revision === undefined ? {} : { latestRevision: record.revision }),
        ...((status === 'available' || status === 'changed' || status === 'moved') && to !== undefined ? { destination: to } : {}) });
    },
  };
}
