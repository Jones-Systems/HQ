/**
 * LABELLED FAKES for HQD-03 compare. Synthetic data only; none of these claim a
 * real preview, capture, catalog or store. Root replaces them with qualified adapters.
 */
import type {
  CaptureImagePort, CompareStoragePort, PreviewCapability, PreviewRequest, PreviewSession,
  StaticCapture, SyntheticBlock, VersionCatalogPort, VersionSummary, ViewSummary, Viewport,
} from './contract.ts';
import { captureId, projectId, versionId, viewId, type ProjectId, type VersionId, type ViewId } from './ids.ts';

export const FAKE_LABEL = 'Fake preview';

/** Deterministic, obviously synthetic digest for fixtures (not a hash of real bytes). */
export function fixtureDigest(seed: string): string {
  let h = 0x811c9dc5;
  let out = '';
  for (let round = 0; round < 8; round += 1) {
    for (const char of `${round}:${seed}`) h = Math.imul(h ^ char.charCodeAt(0), 0x01000193) >>> 0;
    out += h.toString(16).padStart(8, '0');
  }
  return `sha256:${out}`;
}

export interface FakeCatalogData {
  readonly views: readonly ViewSummary[];
  readonly versions: readonly VersionSummary[];
}

export interface FakeCatalog extends VersionCatalogPort {
  readonly calls: { listViews: number; listVersions: number; getVersion: VersionId[] };
  /** Append a version, e.g. a newer one, to prove pinned panels never follow it. */
  addVersion(version: VersionSummary): void;
}

export function createFakeCatalog(data: FakeCatalogData): FakeCatalog {
  const views = [...data.views];
  const versions = [...data.versions];
  const calls = { listViews: 0, listVersions: 0, getVersion: [] as VersionId[] };
  return {
    calls,
    addVersion(version) { versions.push(version); },
    async listViews(project: ProjectId) { calls.listViews += 1; return views.filter((view) => view.projectId === project); },
    async listVersions(view: ViewId) { calls.listVersions += 1; return versions.filter((version) => version.viewId === view); },
    async getVersion(id: VersionId) { calls.getVersion.push(id); return versions.find((version) => version.versionId === id) ?? null; },
  };
}

/** Fixed palette per seed; preview colors never follow HQ appearance. */
const PALETTES = [
  ['#f4f1ea', '#1f3a5f', '#e07a5f', '#3d405b'],
  ['#eef6f2', '#2d6a4f', '#f4a261', '#264653'],
  ['#f6eef6', '#5a189a', '#ff8fab', '#240046'],
];

function paletteFor(seed: string): readonly string[] {
  let h = 0;
  for (const char of seed) h = (h * 31 + char.charCodeAt(0)) >>> 0;
  return PALETTES[h % PALETTES.length];
}

/** Synthetic page layout for a version at a viewport: header, hero, content rows, footer. */
export function syntheticBlocks(seed: string, viewport: Viewport, contentHeight: number): SyntheticBlock[] {
  const [page, header, accent, text] = paletteFor(seed);
  const gutter = Math.round(viewport.w * 0.06);
  const inner = viewport.w - gutter * 2;
  const blocks: SyntheticBlock[] = [
    { x: 0, y: 0, width: viewport.w, height: contentHeight, fill: page },
    { x: 0, y: 0, width: viewport.w, height: 64, fill: header, text: `${seed} · header` },
    { x: gutter, y: 96, width: inner, height: Math.round(viewport.h * 0.35), fill: accent, text: 'Hero' },
  ];
  let y = 96 + Math.round(viewport.h * 0.35) + 32;
  let row = 1;
  while (y + 120 < contentHeight - 96) {
    blocks.push({ x: gutter, y, width: inner, height: 96, fill: row % 2 === 0 ? accent : text, text: `Section ${row}` });
    y += 128;
    row += 1;
  }
  blocks.push({ x: 0, y: contentHeight - 80, width: viewport.w, height: 80, fill: header, text: 'Footer' });
  return blocks;
}

export interface FakePreviewOptions {
  /** Content height multiple of the viewport height per version (default 3). */
  readonly pages?: (versionId: VersionId) => number;
  /** Return a different version than requested, to exercise mismatch rejection. */
  readonly misreport?: (request: PreviewRequest) => VersionId | null;
  /** Hold opening until `release()` is called (to exercise stale-result fencing). */
  readonly manual?: boolean;
  /** Model an adapter that ignores abort and resolves late anyway. */
  readonly ignoreAbort?: boolean;
}

export interface FakePreview extends PreviewCapability {
  readonly opened: PreviewRequest[];
  readonly closed: string[];
  /** Resolve every held open in order (manual mode). */
  release(): void;
  pending(): number;
}

export function createFakePreview(options: FakePreviewOptions = {}): FakePreview {
  const opened: PreviewRequest[] = [];
  const closed: string[] = [];
  const held: Array<() => void> = [];
  let counter = 0;
  const make = (request: PreviewRequest): PreviewSession => {
    counter += 1;
    const sessionId = `fake-session-${counter}`;
    const height = Math.round(request.viewport.h * (options.pages?.(request.versionId) ?? 3));
    return {
      kind: 'live-preview', sessionId, versionId: options.misreport?.(request) ?? request.versionId,
      qualification: 'labelled-fake', viewport: request.viewport,
      contentSize: { width: request.viewport.w, height },
      surface: { kind: 'synthetic', blocks: syntheticBlocks(request.versionId, request.viewport, height) },
      close() { closed.push(sessionId); },
    };
  };
  return {
    qualification: 'labelled-fake', label: FAKE_LABEL, opened, closed,
    release() { for (const run of held.splice(0)) run(); },
    pending: () => held.length,
    open(request, signal) {
      opened.push(request);
      if (!options.manual) return Promise.resolve(make(request));
      return new Promise((resolve, reject) => {
        held.push(() => (signal.aborted && !options.ignoreAbort ? reject(new DOMException('Aborted', 'AbortError')) : resolve(make(request))));
      });
    },
  };
}

function escapeXml(value: string): string {
  return value.replace(/[<>&"']/gu, (char) => `&#${char.charCodeAt(0)};`);
}

/** Renders a synthetic capture as an SVG data URL (CSP allows `img-src data:`). */
export function syntheticCaptureSvg(capture: StaticCapture): string {
  const { width, height } = capture.contentSize;
  const rects = syntheticBlocks(`${capture.versionId}`, capture.viewport, height).map((block) => {
    const label = block.text === undefined ? ''
      : `<text x="${block.x + 12}" y="${block.y + 28}" font-family="sans-serif" font-size="16" fill="#ffffff">${escapeXml(block.text)}</text>`;
    return `<rect x="${block.x}" y="${block.y}" width="${block.width}" height="${block.height}" fill="${block.fill}"/>${label}`;
  }).join('');
  const stamp = `<text x="12" y="${height - 24}" font-family="monospace" font-size="12" fill="#ffffff">SYNTHETIC CAPTURE ${escapeXml(capture.captureId)}</text>`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${rects}${stamp}</svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

export function createFakeCaptureImages(): CaptureImagePort & { readonly reads: string[] } {
  const reads: string[] = [];
  return {
    reads,
    async readCapture(capture) { reads.push(capture.captureId); return { src: syntheticCaptureSvg(capture) }; },
  };
}

export interface FakeStorage extends CompareStoragePort {
  readonly documents: Map<string, string>;
  readonly writes: Array<{ key: string; value: string }>;
  failNextWrite: boolean;
}

export function createFakeStorage(seed: Record<string, string> = {}): FakeStorage {
  const documents = new Map(Object.entries(seed));
  const writes: Array<{ key: string; value: string }> = [];
  const storage: FakeStorage = {
    documents, writes, failNextWrite: false,
    async read(key) { return documents.get(key) ?? null; },
    async write(key, value) {
      if (storage.failNextWrite) { storage.failNextWrite = false; throw new Error('fake write failure'); }
      writes.push({ key, value });
      documents.set(key, value);
    },
  };
  return storage;
}

/** Synthetic two-view project: "Home" with three versions, "Pricing" with one. */
export function sampleCatalogData(): FakeCatalogData {
  const project = projectId('sample-project');
  const home = viewId('view-home');
  const pricing = viewId('view-pricing');
  const capture = (version: string, viewport: Viewport, pages: number, origin: StaticCapture['origin'] = 'browser'): StaticCapture => ({
    kind: 'static-capture', captureId: captureId(`cap-${version}-${viewport.w}x${viewport.h}`), versionId: versionId(version),
    route: '/', state: 'default', viewport, contentSize: { width: viewport.w, height: Math.round(viewport.h * pages) },
    captureDigest: fixtureDigest(`${version}:${viewport.w}x${viewport.h}`), mediaType: 'image/svg+xml',
    capturedAt: '2026-10-19T14:02:00Z', origin, fixture: true,
  });
  const phone = { w: 390, h: 844, dpr: 3 };
  const laptop = { w: 1440, h: 900, dpr: 2 };
  const version = (id: string, view: ViewId, label: string, createdAt: string, captures: StaticCapture[], route = '/'): VersionSummary => ({
    versionId: versionId(id), viewId: view, projectId: project, label, createdAt, route, state: 'default', captures,
  });
  return {
    views: [{ viewId: home, projectId: project, name: 'Home' }, { viewId: pricing, projectId: project, name: 'Pricing' }],
    versions: [
      version('home-v1', home, 'Home v1', '2026-10-01T09:00:00Z', [capture('home-v1', phone, 3), capture('home-v1', laptop, 2)]),
      version('home-v2', home, 'Home v2', '2026-10-10T09:00:00Z', [capture('home-v2', phone, 4), capture('home-v2', laptop, 2.5)]),
      version('home-v3', home, 'Home v3', '2026-10-18T09:00:00Z', [capture('home-v3', phone, 5, 'native-simulator')]),
      version('pricing-v1', pricing, 'Pricing v1', '2026-10-05T09:00:00Z', [capture('pricing-v1', phone, 2)], '/pricing'),
    ],
  };
}
