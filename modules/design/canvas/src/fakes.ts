/**
 * Labelled fakes for tests, harnesses and pre-integration composition.
 * None of these is durable storage, a real provider or a real project source.
 */
import {
  providerId as toProviderId, type CanvasItemDescriptor, type CanvasItemProvider, type CanvasItemRef,
  type CanvasNamespace, type CanvasStoragePort, type IdPort, type ProjectId, type ProvenanceKind, type Size,
} from './contract.ts';

export const FAKE_LABEL = 'FAKE — synthetic, in-memory, not durable';

export interface FakeStorage extends CanvasStoragePort {
  readonly label: typeof FAKE_LABEL;
  readonly writes: { readonly namespace: CanvasNamespace; readonly key: string; readonly text: string }[];
  readonly documents: Map<string, string>;
}

export function createFakeStorage(seed: Readonly<Record<string, string>> = {}): FakeStorage {
  const documents = new Map(Object.entries(seed).map(([key, text]) => [`workspace:${key}`, text]));
  const writes: { namespace: CanvasNamespace; key: string; text: string }[] = [];
  return {
    label: FAKE_LABEL, writes, documents,
    async readDocument(namespace, key) { return documents.get(`${namespace}:${key}`) ?? null; },
    async writeDocument(namespace, key, text) {
      writes.push({ namespace, key, text });
      documents.set(`${namespace}:${key}`, text);
    },
  };
}

export interface FakeSourceItem {
  readonly entityId: string;
  readonly revision: string;
  readonly title: string;
  readonly kind?: string;
  readonly size?: Size;
  readonly provenance?: ProvenanceKind;
  /** Synthetic stand-in for immutable source bytes; canvas must never change them. */
  readonly bytes?: Uint8Array;
}

export interface FakeProvider extends CanvasItemProvider {
  readonly fake: typeof FAKE_LABEL;
  /** Every call the canvas made into this provider, for spying. */
  readonly calls: { readonly method: string; readonly ref?: CanvasItemRef }[];
  readonly items: readonly FakeSourceItem[];
  /** Replace the item set (simulates provider-side changes) and notify subscribers. */
  update(items: readonly FakeSourceItem[]): void;
}

export function createFakeProvider(id: string, label: string, initial: readonly FakeSourceItem[], project?: ProjectId): FakeProvider {
  const pid = toProviderId(id);
  let items = initial;
  const listeners = new Set<() => void>();
  const calls: { method: string; ref?: CanvasItemRef }[] = [];
  const descriptor = (item: FakeSourceItem): CanvasItemDescriptor => ({
    ref: { providerId: pid, entityId: item.entityId, revision: item.revision }, title: item.title,
    kind: item.kind ?? 'synthetic', intrinsicSize: item.size ?? { width: 320, height: 200 },
    provenance: item.provenance ?? 'unspecified', details: [{ label: 'Fixture', value: FAKE_LABEL }],
  });
  return {
    id: pid, label: `${label} (fake)`, fake: FAKE_LABEL, calls,
    get items() { return items; },
    describe(ref) {
      calls.push({ method: 'describe', ref });
      const item = items.find((candidate) => candidate.entityId === ref.entityId && candidate.revision === ref.revision);
      return item && ref.providerId === pid ? descriptor(item) : null;
    },
    list(requested) {
      calls.push({ method: 'list' });
      return project && requested !== project ? [] : items.map(descriptor);
    },
    subscribe(listener) {
      calls.push({ method: 'subscribe' });
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    update(next) {
      items = next;
      for (const listener of [...listeners]) listener();
    },
  };
}

/** Deterministic id source for tests and the harness. */
export function createSequentialIds(prefix = 'fake'): IdPort & { readonly label: typeof FAKE_LABEL } {
  let counter = 0;
  return { label: FAKE_LABEL, next: (kind) => `${prefix}-${kind}-${(counter += 1).toString(36)}` };
}
