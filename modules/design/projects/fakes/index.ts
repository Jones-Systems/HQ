/**
 * LABELLED FAKES AND SYNTHETIC FIXTURES for the projects section.
 *
 * Nothing here is a real adapter. Every fake carries `label: FAKE_LABEL` so it
 * cannot be mistaken for runtime evidence. Root wires real store, registry,
 * catalog and preview adapters at integration. This directory is removable
 * from a finished product without touching src/.
 */
import {
  StorageConflictError, type CatalogEntryView, type CatalogReadPort, type ClockPort, type FreshnessStatus,
  type PreviewBytes, type PreviewRef, type ProjectStoragePort, type StoredDocument, type ThumbnailPort,
} from '../src/contract.ts';
import { addVersion, addView, createProjectContent, type ProjectContent, type ViewKind } from '../src/content.ts';
import { contentKey } from '../src/repository.ts';
import { PROVISIONAL_REGISTRY_KEY, PROVISIONAL_REGISTRY_SCHEMA } from '../src/registry.ts';
import { hostId, projectId, sourceProjectId, versionId, viewId, type IdFactory, type ProjectId } from '../src/ids.ts';

export const FAKE_LABEL = 'synthetic fake: not a real adapter or runtime evidence';

// ------------------------------------------------------------------ storage

export interface StorageCall {
  readonly op: 'read' | 'write';
  readonly namespace: string;
  readonly key: string;
}

export interface SpyStorage extends ProjectStoragePort {
  readonly label: typeof FAKE_LABEL;
  readonly calls: StorageCall[];
  writes(): StorageCall[];
  /** Seeds a document directly (not recorded as a section write). */
  seed(namespace: string, key: string, value: unknown): void;
  /** Returns the stored JSON text, for byte-identity assertions. */
  raw(namespace: string, key: string): string | undefined;
  keys(namespace: string): string[];
  /** Makes reads wait until `release()` is called. */
  holdReads(): { release(): void };
}

/** In-memory StoragePort that records every call. Values are stored as JSON text. */
export function createSpyStorage(): SpyStorage {
  const namespaces = new Map<string, Map<string, { revision: string; text: string }>>();
  const calls: StorageCall[] = [];
  let revision = 0;
  let gate: Promise<void> | null = null;
  const bucket = (namespace: string) => {
    let found = namespaces.get(namespace);
    if (!found) { found = new Map(); namespaces.set(namespace, found); }
    return found;
  };
  return {
    label: FAKE_LABEL,
    calls,
    writes: () => calls.filter((call) => call.op === 'write'),
    seed(namespace, key, value) { bucket(namespace).set(key, { revision: `r${++revision}`, text: JSON.stringify(value) }); },
    raw: (namespace, key) => namespaces.get(namespace)?.get(key)?.text,
    keys: (namespace) => [...(namespaces.get(namespace)?.keys() ?? [])],
    holdReads() {
      let release = () => {};
      gate = new Promise<void>((resolve) => { release = () => { gate = null; resolve(); }; });
      return { release };
    },
    async readDocument(namespace, key): Promise<StoredDocument | null> {
      calls.push({ op: 'read', namespace, key });
      if (gate) await gate;
      const found = namespaces.get(namespace)?.get(key);
      return found ? { revision: found.revision, value: JSON.parse(found.text) } : null;
    },
    async writeDocument(namespace, key, value, options) {
      calls.push({ op: 'write', namespace, key });
      const current = namespaces.get(namespace)?.get(key);
      if ((current?.revision ?? null) !== options.expectedRevision) throw new StorageConflictError(key);
      const next = { revision: `r${++revision}`, text: JSON.stringify(value) };
      bucket(namespace).set(key, next);
      return { revision: next.revision };
    },
  };
}

// ------------------------------------------------------------- clock & ids

export function createFakeClock(start = Date.UTC(2026, 0, 1)): ClockPort & { readonly label: typeof FAKE_LABEL; advance(ms: number): void } {
  let time = start;
  return {
    label: FAKE_LABEL,
    now: () => new Date(time).toISOString(),
    advance: (ms) => { time += ms; },
  };
}

export function sequentialIds(prefix = 'fake'): IdFactory & { readonly label: typeof FAKE_LABEL } {
  const counters = { project: 0, view: 0, version: 0 };
  return { label: FAKE_LABEL, next: (kind) => `${prefix}-${kind}-${++counters[kind]}` };
}

// ------------------------------------------------------------ synthetic PNG

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function u32(value: number): number[] { return [(value >>> 24) & 255, (value >>> 16) & 255, (value >>> 8) & 255, value & 255]; }

function chunk(type: string, data: Uint8Array): number[] {
  const body = new Uint8Array([...type].map((char) => char.charCodeAt(0)).concat(...data));
  return [...u32(data.length), ...body, ...u32(crc32(body))];
}

/** A small valid RGB PNG with a two-tone diagonal pattern (stored deflate, no compression library). */
export function syntheticPng(seed: number, width = 32, height = 20): Uint8Array {
  const hue = (seed * 47) % 360;
  const rgb = (h: number, l: number): number[] => {
    const a = 0.45 * Math.min(l, 1 - l);
    const f = (n: number) => { const k = (n + h / 30) % 12; return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)))); };
    return [f(0), f(8), f(4)];
  };
  const [light, dark] = [rgb(hue, 0.78), rgb(hue, 0.5)];
  const raw: number[] = [];
  for (let y = 0; y < height; y += 1) {
    raw.push(0);
    for (let x = 0; x < width; x += 1) raw.push(...(x + y < (width + height) / 2 ? light! : dark!));
  }
  let adlerA = 1;
  let adlerB = 0;
  for (const byte of raw) { adlerA = (adlerA + byte) % 65521; adlerB = (adlerB + adlerA) % 65521; }
  const deflate: number[] = [0x78, 0x01];
  for (let offset = 0; offset < raw.length || offset === 0; offset += 65535) {
    const block = raw.slice(offset, offset + 65535);
    const last = offset + 65535 >= raw.length ? 1 : 0;
    deflate.push(last, block.length & 255, block.length >>> 8, ~block.length & 255, (~block.length >>> 8) & 255, ...block);
  }
  deflate.push(...u32(((adlerB << 16) | adlerA) >>> 0));
  const header = new Uint8Array([...u32(width), ...u32(height), 8, 2, 0, 0, 0]);
  return new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, ...chunk('IHDR', header), ...chunk('IDAT', new Uint8Array(deflate)), ...chunk('IEND', new Uint8Array())]);
}

export async function previewRefFor(bytes: Uint8Array, mediaType = 'image/png', w?: number, h?: number): Promise<PreviewRef> {
  const digest = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>));
  return {
    digest: `sha256:${Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('')}`,
    mediaType, bytes: bytes.byteLength, ...(w ? { w } : {}), ...(h ? { h } : {}),
  };
}

// --------------------------------------------------------------- thumbnails

export interface FakeThumbnailPort extends ThumbnailPort {
  readonly label: typeof FAKE_LABEL;
  readonly requested: string[];
  readonly aborted: string[];
  add(ref: PreviewRef, bytes: Uint8Array): void;
  /** `manual`: requests stay pending until `resolveAll()`; `never`: requests never resolve. */
  mode: 'immediate' | 'manual' | 'never';
  resolveAll(): void;
  pending(): number;
}

export function createFakeThumbnailPort(): FakeThumbnailPort {
  const store = new Map<string, PreviewBytes>();
  const waiting: Array<() => void> = [];
  const port: FakeThumbnailPort = {
    label: FAKE_LABEL,
    requested: [],
    aborted: [],
    mode: 'immediate',
    add(ref, bytes) { store.set(ref.digest, { mediaType: ref.mediaType, bytes }); },
    resolveAll() { for (const resolve of waiting.splice(0)) resolve(); },
    pending: () => waiting.length,
    readThumbnail(ref, signal) {
      port.requested.push(ref.digest);
      return new Promise<PreviewBytes>((resolve, reject) => {
        const finish = () => {
          const found = store.get(ref.digest);
          if (found) resolve(found); else reject(new Error('Synthetic preview not found'));
        };
        signal.addEventListener('abort', () => { port.aborted.push(ref.digest); reject(new Error('aborted')); }, { once: true });
        if (port.mode === 'immediate') queueMicrotask(finish);
        else if (port.mode === 'manual') waiting.push(finish);
      });
    },
  };
  return port;
}

// ------------------------------------------------------------------ catalog

export function createFakeCatalog(entries: readonly CatalogEntryView[] = []): CatalogReadPort & {
  readonly label: typeof FAKE_LABEL; replace(next: readonly CatalogEntryView[]): void;
} {
  let current = entries;
  const listeners = new Set<() => void>();
  return {
    label: FAKE_LABEL,
    current: () => current,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    replace(next) { current = next; for (const listener of [...listeners]) listener(); },
  };
}

export function syntheticCatalogEntry(index: number, options: {
  readonly host?: string; readonly hostLabel?: string; readonly status?: FreshnessStatus; readonly displayName?: string;
  readonly remote?: string; readonly preview?: PreviewRef;
} = {}): CatalogEntryView {
  return {
    sourceProjectId: sourceProjectId(`fake-source-${index}`),
    hostId: hostId(options.host ?? 'fake-host-a'),
    hostLabel: options.hostLabel ?? 'Synthetic host A',
    repoIdentity: { localOnly: options.remote === undefined, ...(options.remote ? { normalizedRemote: options.remote } : {}) },
    relativePath: `synthetic/source-${index}`,
    displayName: options.displayName ?? `Source project ${index}`,
    revision: `fake-rev-${index}`,
    previews: options.preview ? [options.preview] : [],
    freshness: { status: options.status ?? 'fresh', lastSuccessAt: '2026-01-01T00:00:00.000Z', generation: 1 },
  };
}

// --------------------------------------------------------- synthetic workspace

const KINDS: readonly ViewKind[] = ['page', 'screen', 'component', 'prototype'];

/**
 * Seeds `count` synthetic projects (provisional registry document + one
 * content document each) with 1-3 views and 1-3 versions per view, each
 * version carrying a synthetic PNG thumbnail registered in `thumbnails`.
 */
export async function seedSyntheticWorkspace(storage: SpyStorage, thumbnails: FakeThumbnailPort, count: number, options: {
  readonly clock?: ClockPort; readonly namePrefix?: string;
} = {}): Promise<{ readonly projectIds: ProjectId[]; readonly contents: ProjectContent[] }> {
  const clock = options.clock ?? createFakeClock();
  const projects: Array<{ id: ProjectId; name: string; createdAt: string }> = [];
  const contents: ProjectContent[] = [];
  for (let index = 0; index < count; index += 1) {
    const id = projectId(`fake-project-${index + 1}`);
    const now = clock.now();
    projects.push({ id, name: `${options.namePrefix ?? 'Synthetic project'} ${index + 1}`, createdAt: now });
    let content = createProjectContent(id, now);
    const viewCount = 1 + (index % 3);
    for (let v = 0; v < viewCount; v += 1) {
      const view = viewId(`fake-view-${index + 1}-${v + 1}`);
      content = addView(content, { id: view, title: `View ${v + 1}`, kind: KINDS[(index + v) % KINDS.length]! }, now);
      for (let r = 0; r < 1 + ((index + v) % 3); r += 1) {
        const bytes = syntheticPng(index * 7 + v * 3 + r);
        const ref = await previewRefFor(bytes, 'image/png', 32, 20);
        thumbnails.add(ref, bytes);
        content = addVersion(content, {
          id: versionId(`fake-version-${index + 1}-${v + 1}-${r + 1}`), viewId: view, label: `Version ${r + 1}`,
          capture: { route: `/synthetic/${index + 1}/${v + 1}`, viewport: { w: 1280, h: 800, dpr: 2 }, sourceRevision: `fake-rev-${r + 1}` },
          thumbnail: ref, origin: 'synthetic-fixture',
        }, now);
      }
    }
    storage.seed('workspace', contentKey(id), content);
    contents.push(content);
  }
  storage.seed('workspace', PROVISIONAL_REGISTRY_KEY, { schema: PROVISIONAL_REGISTRY_SCHEMA, projects });
  return { projectIds: projects.map((project) => project.id), contents };
}
