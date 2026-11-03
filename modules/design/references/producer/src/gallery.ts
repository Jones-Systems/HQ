import type {
  AppFlowCandidate, AppScreenCandidate, AppTreeCandidate, GraphCaptureCandidate, GraphTreeCandidate, WebsitePageCandidate,
  WebsiteTreeCandidate,
} from '../../src/graph-contract.ts';
import type { CaptureContext } from './capture.ts';
import { mergeCaptures, parseCapture } from './capture.ts';
import type { GallerySource } from './config.ts';
import { fail } from './errors.ts';
import { ReadSession, sha256Digest } from './safe-fs.ts';
import { account, arr, digest, obj, parseDocument, str } from './source-json.ts';
import { Tally } from './tally.ts';

export const GALLERY_RELEASE_SCHEMA = 'hq.producer.gallery-release/v1';
export const GALLERY_CATALOG_SCHEMA = 'hq.producer.gallery-catalog/v1';

export interface SourceRead {
  readonly trees: readonly GraphTreeCandidate[];
  readonly tally: Tally;
  /** Re-checks that nothing the run read has changed. Called again before any output is written. */
  readonly recheck: () => Promise<void>;
  readonly filesRead: number;
  readonly bytesRead: number;
}

const MAX_ENTRIES = 5000;

/** Accumulates captures per subject so identical content (same kind and digest) folds into one. */
export class CaptureBucket {
  readonly #byKey = new Map<string, GraphCaptureCandidate>();
  readonly #tally: Tally;
  constructor(tally: Tally) { this.#tally = tally; }
  add(merge: string, candidate: GraphCaptureCandidate): void {
    const known = this.#byKey.get(merge);
    this.#byKey.set(merge, known === undefined ? candidate : mergeCaptures(known, candidate, this.#tally));
  }
  list(): GraphCaptureCandidate[] { return [...this.#byKey.values()]; }
}

/**
 * Reads the current A/B gallery release. The configured pointer is resolved once and only that one
 * symbolic-link hop is followed; the release is then read as plain, link-free regular files. A
 * second look at the same pointer at the end only detects change, it is never followed.
 */
export async function readGallery(source: GallerySource): Promise<SourceRead> {
  const session = await ReadSession.open(source.root, source.limits);
  const tally = new Tally();
  const pointer = await session.resolvePointer(source.pointer, source.releases);
  const release = pointer.release;

  const manifestBytes = await session.read(`${release}/release.json`, 'json');
  const manifest = parseDocument(manifestBytes, GALLERY_RELEASE_SCHEMA, 'release');
  account(manifest, ['schema', 'release', 'generation', 'catalog', 'catalogDigest'], tally);
  if (manifest.release !== release) return fail('release-name-mismatch', 'release.release');
  if (typeof manifest.generation !== 'number' || !Number.isSafeInteger(manifest.generation) || manifest.generation < 0) return fail('invalid-field', 'release.generation');
  const catalogName = str(manifest.catalog, 'release.catalog', 100);
  if (catalogName.includes('/')) return fail('unsafe-path', 'release.catalog');
  const expected = digest(manifest.catalogDigest, 'release.catalogDigest');
  const catalogBytes = await session.read(`${release}/${catalogName}`, 'json');
  if (sha256Digest(catalogBytes) !== expected) return fail('catalog-digest-mismatch', 'release.catalogDigest');
  const catalog = parseDocument(catalogBytes, GALLERY_CATALOG_SCHEMA, 'catalog');
  account(catalog, ['schema', 'entries'], tally);

  const context: CaptureContext = { session, prefix: release, tally, sourceRights: source.rights, sourceProducer: source.producer };
  const trees: GraphTreeCandidate[] = [];
  for (const [index, entryValue] of arr(catalog.entries, 'catalog.entries', MAX_ENTRIES).entries()) {
    const where = `catalog.entries[${index}]`;
    const entry = obj(entryValue, where);
    tally.add('entries-read');
    if (entry.kind === 'website') trees.push(await readWebsite(entry, where, context));
    else if (entry.kind === 'app') trees.push(await readApp(entry, where, context));
    else return fail('unsupported-entry-kind', `${where}.kind`);
  }

  const recheck = async (): Promise<void> => {
    const again = await session.resolvePointer(source.pointer, source.releases);
    if (again.release !== release || again.ino !== pointer.ino) return fail('generation-changed');
    await session.assertUnchanged();
  };
  await recheck();
  return { trees, tally, recheck, filesRead: session.filesRead, bytesRead: session.bytesRead };
}

async function readCaptures(list: unknown, where: string, context: CaptureContext): Promise<GraphCaptureCandidate[]> {
  const bucket = new CaptureBucket(context.tally);
  for (const [index, item] of (list === undefined ? [] : arr(list, where, 2000)).entries()) {
    const parsed = await parseCapture(item, `${where}[${index}]`, context, []);
    if (parsed !== null) bucket.add(parsed.merge, parsed.candidate);
  }
  return bucket.list();
}

async function readWebsite(entry: Record<string, unknown>, where: string, context: CaptureContext): Promise<WebsiteTreeCandidate> {
  account(entry, ['kind', 'origin', 'title', 'pages'], context.tally);
  const pages: WebsitePageCandidate[] = [];
  for (const [index, pageValue] of arr(entry.pages, `${where}.pages`, 5000).entries()) {
    const at = `${where}.pages[${index}]`;
    const page = obj(pageValue, at);
    account(page, ['url', 'title', 'captures'], context.tally);
    pages.push({ url: str(page.url, `${at}.url`, 2048), title: str(page.title, `${at}.title`), captures: await readCaptures(page.captures, `${at}.captures`, context) });
  }
  return { kind: 'website', origin: str(entry.origin, `${where}.origin`, 2048), title: str(entry.title, `${where}.title`), pages };
}

async function readApp(entry: Record<string, unknown>, where: string, context: CaptureContext): Promise<AppTreeCandidate> {
  account(entry, ['kind', 'platform', 'appId', 'title', 'screens', 'flows'], context.tally);
  const screens: AppScreenCandidate[] = [];
  for (const [index, screenValue] of arr(entry.screens, `${where}.screens`, 5000).entries()) {
    const at = `${where}.screens[${index}]`;
    const screen = obj(screenValue, at);
    account(screen, ['key', 'title', 'captures'], context.tally);
    screens.push({ key: str(screen.key, `${at}.key`), title: str(screen.title, `${at}.title`), captures: await readCaptures(screen.captures, `${at}.captures`, context) });
  }
  const flows: AppFlowCandidate[] = [];
  for (const [index, flowValue] of (entry.flows === undefined ? [] : arr(entry.flows, `${where}.flows`, 2000)).entries()) {
    const at = `${where}.flows[${index}]`;
    const flow = obj(flowValue, at);
    account(flow, ['key', 'title', 'steps', 'captures'], context.tally);
    flows.push({
      key: str(flow.key, `${at}.key`), title: str(flow.title, `${at}.title`),
      steps: arr(flow.steps, `${at}.steps`, 500).map((step, at2) => str(step, `${at}.steps[${at2}]`)),
      captures: await readCaptures(flow.captures, `${at}.captures`, context),
    });
  }
  return { kind: 'app', platform: str(entry.platform, `${where}.platform`, 20), appId: str(entry.appId, `${where}.appId`, 200), title: str(entry.title, `${where}.title`), screens, flows };
}
