import { closedRecord, ContractError, plainRecord } from './canonical.js';
import { planAdoption, type AdoptionPlanResult, type BlockedScopes, type IdentityProvenance,
  type SyntheticSnapshot } from './adoption-classifier.js';
import { PROJECTS_REGISTRY_KEY } from './keys.js';
import { decodeRegistry, documentRevision, expectedRevision, timestamp, type RegistrySnapshot } from './projects-registry.js';

/** Structural readonly Pick<WorkspaceBacking, 'getDocument'>; no backing or writer is constructed. */
interface RegistryReader {
  readonly getDocument: (key: string) => Promise<{ readonly key: string; readonly revision: number; readonly value: unknown } | null>;
}

export interface AdoptionPreflightRequest {
  readonly snapshots: readonly SyntheticSnapshot[];
  readonly provenance: readonly IdentityProvenance[];
  readonly blockedScopes: BlockedScopes;
  /** Proposed planning time, including in prospective put data; never evidence of a commit. */
  readonly registeredAt: string;
  readonly expectedRegistryRevision: number | null;
}

export type AdoptionPreflightResult = AdoptionPlanResult | { readonly status: 'unknown'; readonly phase: 'registry-read' };

function admitRequest(value: unknown): AdoptionPreflightRequest {
  const r = closedRecord(value, ['snapshots', 'provenance', 'blockedScopes', 'expectedRegistryRevision', 'registeredAt']);
  const revision = expectedRevision(r.expectedRegistryRevision), registeredAt = timestamp(r.registeredAt);
  const request = r as unknown as AdoptionPreflightRequest;
  // Reuse the planner's closed shapes, digests and aggregate budgets before any I/O.
  // The absent registry is admission context only; the observed registry determines the returned plan.
  const admission = planAdoption({ ...request, expectedRegistryRevision: null, registry: { revision: null, value: null } });
  if (admission.status === 'invalid') throw new ContractError(admission.reason);
  return {
    snapshots: request.snapshots.map(s => ({ key: s.key, revision: s.revision, digest: s.digest, bytes: new Uint8Array(s.bytes) })),
    provenance: request.provenance.map(p => p.kind === 'workspace-local' ? { kind: p.kind, key: p.key }
      : { kind: p.kind, key: p.key, projectId: p.projectId, sourceProjectId: p.sourceProjectId, evidenceKeys: [...p.evidenceKeys] }),
    blockedScopes: { keyPrefixes: [...request.blockedScopes.keyPrefixes], projectIds: [...request.blockedScopes.projectIds] },
    expectedRegistryRevision: revision, registeredAt,
  };
}

function invalid(error: unknown): AdoptionPlanResult {
  return { status: 'invalid', reason: error instanceof Error ? error.message : 'Invalid adoption preflight input' };
}

/** Bounded synthetic preflight only. Both puts remain data; no discovery, publication, fence or replay. */
export function createAdoptionPreflightService({ backing }: { readonly backing: RegistryReader }) {
  return {
    async preview(request: unknown): Promise<AdoptionPreflightResult> {
      let admitted: AdoptionPreflightRequest;
      try { admitted = admitRequest(request); } catch (error) { return invalid(error); }

      let observed: Awaited<ReturnType<RegistryReader['getDocument']>>;
      try { observed = await backing.getDocument(PROJECTS_REGISTRY_KEY); }
      catch { return { status: 'unknown', phase: 'registry-read' }; }

      try {
        let registry: RegistrySnapshot = { revision: null, value: null };
        if (observed !== null) {
          const document = plainRecord(observed);
          if (document.key !== PROJECTS_REGISTRY_KEY) throw new ContractError('Unexpected registry key');
          registry = { revision: documentRevision(document.revision), value: decodeRegistry(document.value) };
        }
        return planAdoption({ ...admitted, registry });
      } catch (error) { return invalid(error); }
    },
  };
}
