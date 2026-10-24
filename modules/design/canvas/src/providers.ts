import type { CanvasItemDescriptor, CanvasItemProvider, CanvasItemRef, ProjectId, ProviderId } from './contract.ts';

export type Description =
  | { readonly status: 'ready'; readonly descriptor: CanvasItemDescriptor; readonly providerLabel: string }
  | { readonly status: 'missing-provider' }
  | { readonly status: 'missing-item'; readonly providerLabel: string }
  /** The provider failed or answered for a different revision; the placement is kept as is. */
  | { readonly status: 'error'; readonly providerLabel: string; readonly message: string };

export interface ProviderRegistry {
  /** Register a provider. Duplicate ids are refused. Returns an unregister function. */
  register(provider: CanvasItemProvider): () => void;
  get(id: ProviderId): CanvasItemProvider | undefined;
  providers(): readonly CanvasItemProvider[];
  describe(ref: CanvasItemRef): Description;
  /** Placeable items for a project across providers, grouped by provider. */
  catalog(project: ProjectId): readonly { readonly provider: CanvasItemProvider; readonly items: readonly CanvasItemDescriptor[] }[];
  subscribe(listener: () => void): () => void;
}

const sameRef = (a: CanvasItemRef, b: CanvasItemRef): boolean =>
  a.providerId === b.providerId && a.entityId === b.entityId && a.revision === b.revision;

export function createProviderRegistry(): ProviderRegistry {
  const registered = new Map<string, { provider: CanvasItemProvider; unsubscribe: (() => void) | undefined }>();
  const listeners = new Set<() => void>();
  const notify = () => { for (const listener of [...listeners]) listener(); };

  return {
    register(provider) {
      if (registered.has(provider.id)) throw new Error(`Canvas provider ${provider.id} is already registered`);
      const entry = { provider, unsubscribe: provider.subscribe?.(notify) };
      registered.set(provider.id, entry);
      notify();
      return () => {
        if (registered.get(provider.id) !== entry) return;
        registered.delete(provider.id);
        entry.unsubscribe?.();
        notify();
      };
    },
    get: (id) => registered.get(id)?.provider,
    providers: () => [...registered.values()].map((entry) => entry.provider),
    describe(ref) {
      const provider = registered.get(ref.providerId)?.provider;
      if (!provider) return { status: 'missing-provider' };
      let descriptor: CanvasItemDescriptor | null;
      try { descriptor = provider.describe(ref); } catch (error) {
        return { status: 'error', providerLabel: provider.label, message: error instanceof Error ? error.message : 'Provider failed' };
      }
      if (descriptor === null) return { status: 'missing-item', providerLabel: provider.label };
      if (!sameRef(descriptor.ref, ref)) {
        return { status: 'error', providerLabel: provider.label, message: 'Provider answered for a different revision; the pinned revision is kept' };
      }
      return { status: 'ready', descriptor, providerLabel: provider.label };
    },
    catalog(project) {
      return [...registered.values()].flatMap(({ provider }) => {
        if (!provider.list) return [];
        try { return [{ provider, items: provider.list(project) }]; } catch { return [{ provider, items: [] }]; }
      });
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
  };
}
