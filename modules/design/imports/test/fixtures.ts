// Synthetic fixtures only: no owner data, no private formats.
import { importSourceId, projectId, type ClockPort, type ImportSource, type Rights, type SourceItem } from '../src/contract.ts';
import { DEFAULT_TEST_NAMESPACES, FakeStoragePort } from '../src/fake-storage.ts';
import type { ImportDeps } from '../src/importer.ts';

export const PROJECT = projectId('proj-synthetic-a');
export const SOURCE = importSourceId('src-synthetic-folder');
export const OWNED: Rights = { basis: 'owned', holder: 'Synthetic Owner' };

/** Minimal structurally valid PNG header with a seed byte to vary content. */
export function png(w: number, h: number, seed = 0): Uint8Array {
  const bytes = new Uint8Array(41);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  new DataView(bytes.buffer).setUint32(16, w);
  new DataView(bytes.buffer).setUint32(20, h);
  bytes.set([8, 6, 0, 0, 0], 24);
  bytes[40] = seed;
  return bytes;
}

export function mp4(seed = 0): Uint8Array {
  return new Uint8Array([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d, seed, 0, 0, 0]);
}

export function webm(seed = 0): Uint8Array {
  return new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x86, 0x81, 0x01, 0x42, 0xf7, seed]);
}

export const text = (value: string): Uint8Array => new TextEncoder().encode(value);

export function items(seed = 0): SourceItem[] {
  return [
    { key: 'screens/home.png', title: 'Home', rights: OWNED, provenance: { originalName: 'home.png' }, payload: { kind: 'png', bytes: png(390, 844, seed) } },
    { key: 'recordings/flow.webm', title: 'Checkout flow', rights: { basis: 'licensed', holder: 'Synthetic Studio', license: 'CC-BY-4.0' }, payload: { kind: 'recording', mediaType: 'video/webm', bytes: webm(seed) } },
    {
      key: 'prototypes/landing', title: 'Landing prototype', rights: OWNED,
      payload: { kind: 'html-bundle', entry: 'index.html', files: [
        { path: 'index.html', mediaType: 'text/html', bytes: text(`<!doctype html><title>Landing ${seed}</title><link rel=stylesheet href=css/site.css>`) },
        { path: 'css/site.css', mediaType: 'text/css', bytes: text('body{margin:0}') },
      ] },
    },
    { key: 'refs/example', title: 'Example reference', rights: { basis: 'permission', holder: 'Example Org' }, payload: { kind: 'url', url: 'https://example.com/pricing' } },
  ];
}

export function source(seed = 0, override: Partial<ImportSource> = {}): ImportSource {
  return { kind: 'hq.files', version: 1, sourceId: SOURCE, items: items(seed), ...override };
}

export function fixedClock(start = Date.UTC(2026, 9, 20, 12, 0, 0)): ClockPort & { tick(ms?: number): void } {
  let now = start;
  return { now: () => new Date(now).toISOString(), tick(ms = 1_000) { now += ms; } };
}

export function setup(): { storage: FakeStoragePort; deps: ImportDeps; clock: ReturnType<typeof fixedClock> } {
  const storage = new FakeStoragePort(DEFAULT_TEST_NAMESPACES);
  const clock = fixedClock();
  return { storage, clock, deps: { storage, clock } };
}
