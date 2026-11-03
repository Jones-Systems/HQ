import { isDestination, isDomainId, parseReference, type ReferenceEnvelope } from '@hq/contracts';
import { REFERENCE_STATUSES, type ReferencePort, type ReferenceProvider, type ReferenceResolution, type ReturnContext } from '@hq/contracts/references';

export const RESOLUTION_MAX_AGE = 5 * 60_000;
export interface ReferenceNotice { readonly title: string; readonly message: string }
export interface ReferenceNavigation {
  projectId(): string;
  open(envelope: ReferenceEnvelope, destination: string, returnTo: ReturnContext): void;
  notice(value: ReferenceNotice): void;
}
const key = (envelope: ReferenceEnvelope) => JSON.stringify([envelope.domain, envelope.kind, envelope.entityId]);
export function createReferencePort(providers: readonly ReferenceProvider[], navigation: ReferenceNavigation, now = Date.now): ReferencePort & { cancelOpen(): void } {
  const cache = new Map<string, { projectId: string; revision: string | undefined; resolution: ReferenceResolution }>();
  let opening = 0;
  const providerFor = (envelope: ReferenceEnvelope) => providers.find(p => p.domain === envelope.domain && p.kinds.includes(envelope.kind));
  const unknown = (): ReferenceResolution => ({ status: 'unknown', observedAt: new Date(now()).toISOString() });
  function validResolution(value: ReferenceResolution): boolean {
    return value !== null && typeof value === 'object' && REFERENCE_STATUSES.includes(value.status) && typeof value.observedAt === 'string' && Number.isFinite(Date.parse(value.observedAt))
      && ['latestTitle', 'latestRevision', 'targetProjectId'].every(k => !(k in value) || typeof value[k as keyof ReferenceResolution] === 'string')
      && (value.destination === undefined || isDestination(value.destination));
  }
  const fresh = (value: ReferenceResolution) => now() - Date.parse(value.observedAt) >= 0 && now() - Date.parse(value.observedAt) <= RESOLUTION_MAX_AGE;
  async function resolve(input: ReferenceEnvelope): Promise<ReferenceResolution> {
    const envelope = parseReference(input);
    if (!envelope) return unknown();
    const provider = providerFor(envelope);
    if (!provider) return unknown();
    const cached = cache.get(key(envelope));
    if (cached?.projectId === envelope.projectId && cached.revision === envelope.sourceRevision && fresh(cached.resolution)) return { ...cached.resolution };
    let resolution: ReferenceResolution;
    try { const value = await provider.resolve(envelope); resolution = validResolution(value) && fresh(value) ? { ...value } : unknown(); }
    catch { resolution = { status: 'unavailable', observedAt: new Date(now()).toISOString() }; }
    // A failed or inconclusive read is never cached, so the next resolve asks the provider again.
    if (resolution.status === 'unavailable' || resolution.status === 'unknown') { cache.delete(key(envelope)); return { ...resolution }; }
    if (cache.size >= 256) cache.delete(cache.keys().next().value!);
    cache.set(key(envelope), { projectId: envelope.projectId, revision: envelope.sourceRevision, resolution });
    return { ...resolution };
  }
  return {
    resolve,
    cancelOpen() { opening++; },
    async find(query, scope) {
      if (typeof query !== 'string' || query.length > 500 || typeof scope.projectId !== 'string' || !Number.isSafeInteger(scope.limit) || scope.limit < 1 || scope.limit > 100) return [];
      const found = new Map<string, ReferenceEnvelope>();
      for (const provider of providers) {
        if (scope.domains && !scope.domains.includes(provider.domain)) continue;
        try {
          const results = await provider.find(query, { projectId: scope.projectId, limit: scope.limit, ...(scope.kinds ? { kinds: scope.kinds } : {}) });
          for (const result of results) {
            const envelope = parseReference(result);
            if (!envelope || envelope.projectId !== scope.projectId || envelope.domain !== provider.domain || !provider.kinds.includes(envelope.kind) || (scope.kinds && !scope.kinds.includes(envelope.kind))) continue;
            found.set(key(envelope), envelope);
            if (found.size >= scope.limit) return [...found.values()];
          }
        } catch { /* Failed providers contribute no available results. */ }
      }
      return [...found.values()];
    },
    open(input, returnTo) {
      const ticket = ++opening;
      const envelope = parseReference(input);
      if (!envelope || !returnTo || typeof returnTo.label !== 'string' || !returnTo.label.trim() || returnTo.label.length > 300 || !returnTo.to || !isDomainId(returnTo.to.domain) || !isDestination(returnTo.to.destination)) {
        navigation.notice({ title: 'Reference', message: 'Invalid reference. Read-only.' }); return;
      }
      const context = { label: returnTo.label, to: { ...returnTo.to } };
      if (envelope.projectId !== navigation.projectId()) {
        navigation.notice({ title: envelope.title, message: `Reference belongs to project ${envelope.projectId}. Read-only; the current project is unchanged.` }); return;
      }
      if (!providerFor(envelope)) { navigation.notice({ title: envelope.title, message: 'Unknown reference kind. Snapshot is read-only.' }); return; }
      void resolve(envelope).then(resolution => {
        if (ticket !== opening) return;
        if (envelope.projectId !== navigation.projectId() || (resolution.targetProjectId !== undefined && resolution.targetProjectId !== navigation.projectId())) {
          navigation.notice({ title: envelope.title, message: 'Target belongs to another project. Read-only; the current project is unchanged.' }); return;
        }
        if (!['available', 'changed', 'archived', 'moved'].includes(resolution.status) || !resolution.destination || !fresh(resolution)) {
          navigation.notice({ title: envelope.title, message: `${resolution.status}. Snapshot is read-only.` }); return;
        }
        navigation.open(envelope, resolution.destination, context);
      });
    },
  };
}
