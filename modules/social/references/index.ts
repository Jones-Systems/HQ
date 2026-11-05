import { parseReference, type DomainId, type ReferenceEnvelope } from '@hq/contracts';
import type { ReferenceResolution } from '@hq/ui';
import { FEATURE_HQ_BRAND_PROJECT, portErrorOf, type Brand, type RunRecord, type SocialWorkspacePort, type WorkspaceSnapshot } from '../core';

/** Frozen module-local counterpart of spec.hq-social-work#iface.references.001. */
export interface ReferenceProvider {
  readonly domain: DomainId;
  readonly kinds: readonly string[];
  find(query: string, scope: { projectId: string; kinds?: readonly string[]; limit: number }): Promise<readonly ReferenceEnvelope[]>;
  resolve(envelope: ReferenceEnvelope): Promise<ReferenceResolution>;
}

const KINDS = ['draft', 'run', 'brand'] as const;
interface Target {
  kind: string;
  id: string;
  title: string;
  projectId: string;
  revision?: string;
  destination: string;
  archived?: boolean;
}

function brandProject(snapshot: WorkspaceSnapshot, brand: Brand | undefined, projectId: string): string {
  return snapshot.features.includes(FEATURE_HQ_BRAND_PROJECT) && brand?.project_id ? brand.project_id : projectId;
}

function runTarget(run: RunRecord, snapshot: WorkspaceSnapshot, projectId: string): Target {
  const revision = (run.finished_at ?? run.created_at).slice(0, 10);
  const name = snapshot.tools.find((tool) => tool.id === run.tool)?.name ?? run.tool;
  return { kind: 'run', id: run.id, title: `${name} run · ${revision}${run.is_example ? ' · example' : ''}`,
    projectId, revision, destination: `runs/${run.id}` };
}

function targets(snapshot: WorkspaceSnapshot, projectId: string): Target[] {
  return [
    ...snapshot.content.map((draft) => ({
      kind: 'draft', id: draft.id, title: draft.title, revision: String(draft.version),
      projectId: brandProject(snapshot, snapshot.brands.find((brand) => brand.id === draft.brand_id), projectId),
      destination: `library/${draft.id}`, archived: draft.archived === 1,
    })),
    ...snapshot.runs.map((run) => runTarget(run, snapshot, projectId)),
    // Brands have no revision or dedicated route in the landed navigation contract.
    ...snapshot.brands.map((brand) => ({ kind: 'brand', id: brand.id, title: brand.name,
      projectId: brandProject(snapshot, brand, projectId), destination: 'overview' })),
  ];
}

/** The injected capability exposes reads only; registration belongs to the shell owner. */
export function createSocialReferenceProvider(
  port: Pick<SocialWorkspacePort, 'snapshot' | 'run'>, projectId: string, now: () => Date = () => new Date(),
): ReferenceProvider {
  return {
    domain: 'social',
    kinds: KINDS,
    async find(query, scope) {
      if (scope.projectId !== projectId || !Number.isSafeInteger(scope.limit) || scope.limit <= 0) return [];
      const snapshot = await port.snapshot();
      const search = query.trim().toLocaleLowerCase();
      return targets(snapshot, projectId)
        .filter((target) => target.projectId === scope.projectId && (!scope.kinds || scope.kinds.includes(target.kind))
          && (!search || target.title.toLocaleLowerCase().includes(search)))
        .slice(0, scope.limit)
        .flatMap((target) => {
          const envelope = parseReference({ version: 1, domain: 'social', projectId: target.projectId,
            kind: target.kind, entityId: target.id, title: target.title,
            returnDestination: { domain: 'social', destination: target.destination },
            ...(target.revision ? { sourceRevision: target.revision } : {}) });
          return envelope ? [envelope] : [];
        });
    },
    async resolve(value) {
      const stamp = () => now().toISOString();
      const envelope = parseReference(value);
      if (!envelope || envelope.domain !== 'social' || !KINDS.some((kind) => kind === envelope.kind)) {
        return { status: 'unknown', observedAt: stamp() };
      }
      try {
        const snapshot = await port.snapshot();
        let observedAt = snapshot.observedAt;
        let target = targets(snapshot, projectId).find((item) => item.kind === envelope.kind && item.id === envelope.entityId);
        // The workspace contains only the newest 200 runs; absence there is not proof of deletion.
        if (!target && envelope.kind === 'run') {
          target = runTarget(await port.run(envelope.entityId), snapshot, projectId);
          observedAt = stamp();
        }
        if (!target) return { status: 'missing', observedAt };
        return {
          status: target.projectId !== envelope.projectId ? 'moved' : target.archived ? 'archived'
            : (envelope.sourceRevision !== undefined && target.revision !== undefined && envelope.sourceRevision !== target.revision)
              || envelope.title !== target.title ? 'changed' : 'available',
          observedAt, latestTitle: target.title, targetProjectId: target.projectId,
          ...(target.revision ? { latestRevision: target.revision } : {}), destination: target.destination,
        };
      } catch (reason) {
        const kind = portErrorOf(reason)?.kind;
        return { status: kind === 'not_found' ? 'missing' : kind === 'forbidden' ? 'forbidden'
          : kind === 'unavailable' ? 'unavailable' : 'unknown', observedAt: stamp() };
      }
    },
  };
}
