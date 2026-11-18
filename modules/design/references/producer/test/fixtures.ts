/**
 * Synthetic public fixtures, written to a fresh temporary directory per test. Hand-authored fake
 * values only (example.test, com.example.*); image bytes are a PNG signature plus a label.
 */
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { ProducerConfig, SourceDescriptor } from '../src/config.ts';
import { DEFAULT_LIMITS } from '../src/safe-fs.ts';

export const sha = (bytes: Uint8Array | string): string => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
export const png = (label: string): Buffer => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from(`synthetic:${label}`)]);

export async function tmp(prefix = 'hq-producer-test-'): Promise<string> {
  return fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), prefix)));
}

export async function write(file: string, content: string | Uint8Array): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, content);
}

export const json = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;

export interface ImageSpec { readonly path: string; readonly label: string; readonly mediaType?: string; readonly w?: number; readonly h?: number }

/** Writes an image and returns the catalog `image` object for it (digest and size of the written bytes). */
export async function image(root: string, spec: ImageSpec, bytes: Uint8Array = png(spec.label)): Promise<Record<string, unknown>> {
  await write(path.join(root, spec.path), bytes);
  return { path: spec.path, sha256: sha(bytes), bytes: bytes.length, mediaType: spec.mediaType ?? 'image/png', w: spec.w ?? 1200, h: spec.h ?? 800 };
}

export const PERMITTED = { vocabulary: 'hq.design.references/v1', value: 'permitted', basis: 'synthetic fixture basis' };
export const UNKNOWN = { vocabulary: 'hq.design.references/v1', value: 'unknown' };
export const RESTRICTED = { vocabulary: 'hq.design.references/v1', value: 'restricted' };
export const PRIVATE = { vocabulary: 'producer.study-corpus/v1', value: 'private' };

export const AT = '2026-01-01T00:00:00.000Z';

export interface GalleryOptions {
  /** Catalog override; receives the default entries. */
  readonly entries?: (images: Record<string, Record<string, unknown>>) => unknown[];
  readonly release?: string;
  readonly mutateManifest?: (manifest: Record<string, unknown>, catalogBytes: Buffer) => void;
}

/** A gallery with immutable releases A and B and a `current` pointer to A. B is deliberately unreadable noise. */
export async function buildGallery(root: string, options: GalleryOptions = {}): Promise<{ readonly images: Record<string, Record<string, unknown>> }> {
  const release = options.release ?? 'A';
  const dir = path.join(root, release);
  const images = {
    home: await image(dir, { path: 'images/home.png', label: 'home' }),
    pricing: await image(dir, { path: 'images/pricing.png', label: 'pricing' }),
    list: await image(dir, { path: 'images/list.png', label: 'list', w: 1179, h: 2556 }),
    editor: await image(dir, { path: 'images/editor.png', label: 'editor', w: 1179, h: 2556 }),
  };
  const entries = options.entries?.(images) ?? [
    {
      kind: 'website', origin: 'https://example.test', title: 'Example Site', pages: [
        { url: 'https://example.test/', title: 'Home', captures: [{ kind: 'screenshot', capturedAt: AT, capturedBy: 'agent-reported', image: images.home, rights: PERMITTED,
          anchors: [{ key: 'hero', kind: 'section', label: 'Hero', rect: { x: 0, y: 0, w: 1, h: 0.4 } }, { key: 'cta', kind: 'element', label: 'Call to action', parentKey: 'hero', rect: { x: 0.4, y: 0.3, w: 0.2, h: 0.05 } }] }] },
        { url: 'https://example.test/pricing', title: 'Pricing', captures: [{ kind: 'screenshot', capturedAt: AT, capturedBy: 'agent-reported', image: images.pricing, rights: RESTRICTED }] },
        { url: 'https://example.test/about', title: 'About', captures: [{ kind: 'screenshot', capturedAt: AT, capturedBy: 'agent-reported', captureKey: 'metadata-only', sourceStatus: 'missing-at-source' }] },
      ],
    },
    {
      kind: 'app', platform: 'ios', appId: 'com.example.notes', title: 'Example Notes',
      screens: [
        { key: 'list', title: 'List', captures: [{ kind: 'screenshot', capturedAt: AT, capturedBy: 'agent-reported', image: images.list, rights: PRIVATE }] },
        { key: 'editor', title: 'Editor', captures: [{ kind: 'screenshot', capturedAt: AT, capturedBy: 'agent-reported', image: images.editor }] },
      ],
      flows: [{ key: 'new-note', title: 'New note', steps: ['list', 'editor'] }],
    },
  ];
  const catalogBytes = Buffer.from(json({ schema: 'hq.producer.gallery-catalog/v1', entries }));
  await write(path.join(dir, 'catalog.json'), catalogBytes);
  const manifest: Record<string, unknown> = { schema: 'hq.producer.gallery-release/v1', release, generation: 1, catalog: 'catalog.json', catalogDigest: sha(catalogBytes) };
  options.mutateManifest?.(manifest, catalogBytes);
  await write(path.join(dir, 'release.json'), json(manifest));
  return { images };
}

export async function pointTo(root: string, release: string, pointer = 'current'): Promise<void> {
  const link = path.join(root, pointer);
  await fs.rm(link, { force: true });
  await fs.symlink(release, link);
}

export interface Built { readonly source: SourceDescriptor; readonly config: ProducerConfig; readonly out: string; readonly root: string; readonly base: string }

export async function galleryConfig(overrides: Partial<Record<string, unknown>> = {}): Promise<Built> {
  const base = await tmp();
  const root = path.join(base, 'gallery');
  await buildGallery(root);
  await write(path.join(root, 'B', 'release.json'), 'not json at all {{{');
  await pointTo(root, 'A');
  const out = path.join(base, 'out');
  const source = {
    id: 'example-gallery', kind: 'gallery', root, pointer: 'current', releases: ['A', 'B'], producer: null, rights: PERMITTED,
    limits: DEFAULT_LIMITS, ...overrides,
  } as SourceDescriptor;
  return { source, root, out, base, config: { outputRoot: out, sources: [source] } };
}

/* ------------------------------------------------------------------ study -- */

export interface StudyBuild { readonly root: string; readonly files: Record<string, Buffer>; readonly study: Record<string, unknown> }

/** Writes a website or app study plus a complete receipt. `tamper` runs after the receipt is computed. */
export async function buildStudy(root: string, kind: 'website' | 'app', options: { partial?: string[]; tamper?: (b: StudyBuild) => Promise<void> } = {}): Promise<StudyBuild> {
  const frame = async (label: string, extra: Record<string, unknown> = {}) => ({
    kind: 'screenshot', capturedAt: AT, capturedBy: 'agent-reported', image: await image(root, { path: `frames/${label}.png`, label }), ...extra,
  });
  const web = kind === 'website';
  const run1 = {
    schema: 'hq.producer.study-run/v1', runId: 'run-1', title: 'First pass', annotations: 'annotations/run-1.json',
    steps: [
      { ...(web ? { url: 'https://example.test/', title: 'Home' } : { key: 'list', title: 'List' }), frames: [await frame('one-a', { facts: [{ key: 'bar', kind: 'section', label: 'Bar', rect: { x: 0, y: 0, w: 1, h: 0.1 } }] })] },
      { ...(web ? { url: 'https://example.test/docs', title: 'Docs' } : { key: 'editor', title: 'Editor' }), frames: [await frame('one-b')] },
    ],
  };
  const run2 = {
    schema: 'hq.producer.study-run/v1', runId: 'run-2', title: 'Second pass',
    steps: [{ ...(web ? { url: 'https://example.test/', title: 'Home' } : { key: 'list', title: 'List' }), frames: [await frame('one-a')] }],
  };
  const annotations = { schema: 'hq.producer.study-annotations/v1', runId: 'run-1', frames: [{ step: web ? 'https://example.test/' : 'list', index: 0, facts: [{ key: 'search', kind: 'element', label: 'Search', parentKey: 'bar', rect: { x: 0.1, y: 0.02, w: 0.3, h: 0.05 } }] }] };
  const files: Record<string, Buffer> = {
    'runs/run-1.json': Buffer.from(json(run1)), 'runs/run-2.json': Buffer.from(json(run2)), 'annotations/run-1.json': Buffer.from(json(annotations)),
  };
  const study = {
    schema: 'hq.producer.study/v1', title: 'Example Study',
    subject: web ? { kind: 'website', origin: 'https://example.test' } : { kind: 'app', platform: 'ios', appId: 'com.example.notes', name: 'Example Notes' },
    runs: [{ id: 'run-1', path: 'runs/run-1.json' }, { id: 'run-2', path: 'runs/run-2.json' }],
  };
  const studyBytes = Buffer.from(json(study));
  const receipt = {
    schema: 'hq.producer.study-receipt/v1', studyDigest: sha(studyBytes), status: options.partial === undefined ? 'complete' : 'partial',
    files: Object.entries(files).map(([file, bytes]) => ({ path: file, digest: sha(bytes) })), completeRuns: options.partial ?? ['run-1', 'run-2'],
  };
  await write(path.join(root, 'study.json'), studyBytes);
  await write(path.join(root, 'receipt.json'), json(receipt));
  for (const [file, bytes] of Object.entries(files)) await write(path.join(root, file), bytes);
  const built = { root, files, study };
  await options.tamper?.(built);
  return built;
}

export async function studyConfig(kind: 'website' | 'app', options: Parameters<typeof buildStudy>[2] = {}, overrides: Partial<Record<string, unknown>> = {}): Promise<Built> {
  const base = await tmp();
  const root = path.join(base, 'study');
  await buildStudy(root, kind, options);
  const out = path.join(base, 'out');
  const source = { id: 'example-study', kind: 'study', root, producer: { id: 'rea', label: 'Optional producer' }, rights: UNKNOWN, limits: DEFAULT_LIMITS, ...overrides } as SourceDescriptor;
  return { source, root, out, base, config: { outputRoot: out, sources: [source] } };
}

export async function exists(target: string): Promise<boolean> {
  try { await fs.lstat(target); return true; } catch { return false; }
}

export async function listTree(dir: string): Promise<string[]> {
  const out: string[] = [];
  const walk = async (current: string): Promise<void> => {
    for (const entry of await fs.readdir(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      out.push(path.relative(dir, full));
      if (entry.isDirectory()) await walk(full);
    }
  };
  if (await exists(dir)) await walk(dir);
  return out.sort();
}
