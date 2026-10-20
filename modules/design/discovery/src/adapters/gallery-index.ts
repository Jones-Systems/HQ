import { type CatalogEntry, type CatalogSnapshot, type MetadataValue, isRelativePath } from '../contract.ts';
import { deriveSourceProjectId } from '../identity.ts';
import { sha256Hex } from '../jcs.ts';
import { registryContext, registryId, registryList, registryObject, registryText, registryUrl, type RegistryContext } from './jones-projects.ts';

export interface GalleryRegistryRead {
  readonly manifestBytes: Uint8Array;
  readonly files: Readonly<Record<string, Uint8Array>>;
  readonly baseUrl: string;
  readonly complete?: boolean;
}

const MAX_FILE_BYTES = 2 * 1024 * 1024;
const MAX_TOTAL_BYTES = 16 * 1024 * 1024;
function parse(bytes: Uint8Array): Record<string, unknown> {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength > MAX_FILE_BYTES) throw new TypeError('Invalid or oversized artifact');
  return registryObject(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)));
}
function path(value: string): string {
  if (!isRelativePath(value) || value === '.' || /[%?#:]/u.test(value)) throw new TypeError('Invalid manifest path');
  return value;
}
function viewer(url: string): boolean { return /(?:^|\/)viewer\.html$/iu.test(decodeURIComponent(new URL(url).pathname)); }

export async function mapGalleryIndex(input: GalleryRegistryRead, supplied: RegistryContext): Promise<CatalogSnapshot> {
  const context = registryContext(supplied);
  const base = registryUrl(input.baseUrl);
  if (!new URL(base).pathname.endsWith('/') || new URL(base).search || new URL(base).hash) throw new TypeError('Gallery base must be a directory URL');
  if (input.complete !== undefined && typeof input.complete !== 'boolean') throw new TypeError('Invalid completeness');
  const manifest = parse(input.manifestBytes);
  if (manifest.schema !== 'gallery-registry-export/v1' || manifest.algorithm !== 'sha256') throw new TypeError('Invalid manifest schema');
  const hashes = registryObject(manifest.files);
  const files = registryObject(input.files);
  if (Object.keys(hashes).length > 10000 || Object.keys(files).length > 1000) throw new TypeError('Oversized manifest');
  for (const [key, digest] of Object.entries(hashes)) {
    path(key);
    if (key === 'registry-export-manifest.json' || typeof digest !== 'string' || !/^[a-f0-9]{64}$/u.test(digest)) throw new TypeError('Invalid manifest digest');
  }
  let total = input.manifestBytes.byteLength;
  const verified = new Map<string, Uint8Array>();
  for (const [key, value] of Object.entries(files)) {
    path(key);
    if (!(value instanceof Uint8Array) || value.byteLength > MAX_FILE_BYTES) throw new TypeError('Invalid or oversized artifact');
    total += value.byteLength;
    if (total > MAX_TOTAL_BYTES) throw new TypeError('Oversized export');
    const bytes = value.slice();
    if (hashes[key] === undefined || await sha256Hex(bytes) !== hashes[key]) throw new TypeError('Artifact hash mismatch');
    verified.set(key, bytes);
  }
  const indexBytes = verified.get('data/gallery-index.json');
  if (!indexBytes) throw new TypeError('Missing verified gallery index');
  const index = parse(indexBytes);
  if (index.schema !== 'gallery-index/v1') throw new TypeError('Invalid gallery schema');
  const entries: CatalogEntry[] = [];
  const seen = new Set<string>();
  const projectIds = new Set<string>();
  let complete = input.complete === true && Object.keys(hashes).every((key) => verified.has(key));
  for (const rawProject of registryList(index.projects)) {
    const project = registryObject(rawProject);
    const projectId = registryId(project.id);
    if (projectIds.has(projectId)) throw new TypeError('Duplicate project ID');
    projectIds.add(projectId);
    registryText(project.name, 160);
    if (!['collection', 'external', 'source-only'].includes(String(project.sourceType))) throw new TypeError('Invalid source type');
    if (project.collectionHref !== undefined) registryUrl(project.collectionHref, base);
    const revision = project.runtimeRelease === undefined ? `sha256:${String(hashes['data/gallery-index.json'])}` : registryText(project.runtimeRelease, 300);
    const collectionBytes = verified.get(`projects/${projectId}/data/collection.json`);
    const collection = collectionBytes ? parse(collectionBytes) : undefined;
    for (const rawEntry of registryList(project.entries)) {
      if (entries.length >= 10000) throw new TypeError('Oversized catalog');
      const entry = registryObject(rawEntry);
      const entryId = registryId(entry.id);
      const relativePath = `${projectId}/${entryId}`;
      if (seen.has(relativePath)) throw new TypeError('Duplicate entry ID');
      seen.add(relativePath);
      const type = registryText(entry.presentationType, 32);
      if (!['app', 'website', 'pages', 'screens', 'video', 'external'].includes(type)) throw new TypeError('Invalid presentation type');
      const metadata: Record<string, MetadataValue> = { sourceKind: 'gallery-index', sourceType: String(project.sourceType),
        launchStatus: 'unavailable', holdReason: 'No verified direct presentation', inventoryIntegrity: 'sha256-verified' };
      const declared = entry.launchHref === undefined ? undefined : new URL(registryText(entry.launchHref), base);
      const externalPolicyHold = type === 'external' && project.sourceType === 'external' && declared
        && !declared.username && !declared.password && declared.protocol === 'http:'
        && !['localhost', '127.0.0.1', '[::1]'].includes(declared.hostname);
      const launch = entry.launchHref === undefined || externalPolicyHold ? undefined : registryUrl(entry.launchHref, base);
      if (externalPolicyHold) metadata.holdReason = 'Preview requires HTTPS or loopback HTTP';
      if (entry.detailsHref !== undefined) metadata.detailsUrl = registryUrl(entry.detailsHref, base);
      if (entry.preview !== undefined) {
        const preview = registryObject(entry.preview);
        registryUrl(preview.src, base);
        if (!Number.isSafeInteger(preview.width) || Number(preview.width) <= 0 || !Number.isSafeInteger(preview.height) || Number(preview.height) <= 0) throw new TypeError('Invalid preview dimensions');
        registryText(preview.alt);
      }
      if (type === 'screens') metadata.experienceKind = 'stills';
      if (type === 'website' || (type === 'external' && project.sourceType === 'external')) {
        metadata.experienceKind = 'website';
        if (launch && !viewer(launch) && project.sourceType !== 'source-only') metadata.launchUrl = launch;
      }
      if (['app', 'pages', 'website'].includes(type) && project.sourceType === 'collection') {
        if (!collection) complete = false;
        else {
          const variations = registryList(collection.variations);
          const matches = variations.map(registryObject).filter((variation) => variation.id === entryId);
          if (matches.length > 1) throw new TypeError('Duplicate variation ID');
          const variation = matches[0];
          if (variation) {
            const presentation = registryObject(variation.presentation);
            if (presentation.type === 'pages') {
              const pages = registryList(presentation.pages);
              const pageIds = new Set<string>();
              for (const rawPage of pages) {
                const page = registryObject(rawPage);
                const pageId = registryId(page.id);
                if (pageIds.has(pageId)) throw new TypeError('Duplicate page ID');
                pageIds.add(pageId);
                const url = registryUrl(page.url, new URL(`projects/${projectId}/`, base).href);
                if (pageIds.size === 1) {
                  metadata.experienceKind = 'website';
                  metadata.selectedPageId = pageId;
                  metadata.selectionBasis = 'first-declared';
                  metadata.stateId = null;
                  metadata.pageCount = pages.length;
                  if (!viewer(url)) {
                    metadata.launchUrl = url;
                    const target = new URL(url);
                    metadata.route = registryText(target.pathname + target.search + target.hash);
                  }
                }
              }
            } else if (presentation.type === 'website' && presentation.url !== undefined) {
              const url = registryUrl(presentation.url, new URL(`projects/${projectId}/`, base).href);
              metadata.experienceKind = 'website';
              metadata.stateId = null;
              if (!viewer(url)) metadata.launchUrl = url;
            }
            const screens = presentation.screens === undefined ? [] : registryList(presentation.screens);
            const screen = screens[0] === undefined ? undefined : registryObject(screens[0]);
            const states = screen ? registryList(screen.states) : [];
            const state = states[0] === undefined ? undefined : registryObject(states[0]);
            if (state?.source === 'image' || state?.src !== undefined) {
              if (state.src !== undefined) registryUrl(state.src, new URL(`projects/${projectId}/`, base).href);
              metadata.experienceKind = 'stills';
            }
            else if (state?.source === 'web-prototype') {
              metadata.experienceKind = 'web-prototype';
              if (presentation.type === 'app' && presentation.chrome === 'embedded' && screen) {
                const target = new URL(registryUrl(state.url, new URL(`projects/${projectId}/`, base).href));
                const query = presentation.query === undefined ? {} : registryObject(presentation.query);
                if (Object.keys(query).length > 16) throw new TypeError('Oversized presentation query');
                for (const [key, value] of Object.entries(query)) target.searchParams.set(registryId(key), registryText(value, 160));
                const params = presentation.params === undefined ? {} : registryObject(presentation.params);
                const route = presentation.route === undefined ? {} : registryObject(presentation.route);
                if (params.screen !== undefined) {
                  if (!registryList(route.reflects, 16).includes('screen')) throw new TypeError('Unproved screen route');
                  target.searchParams.set(registryId(params.screen), registryId(screen.id));
                }
                if (!viewer(target.href) && (screens.length === 1 || params.screen !== undefined)) {
                  metadata.launchUrl = registryUrl(target.href);
                  metadata.selectedScreenId = registryId(screen.id);
                  metadata.selectedStateId = registryId(state.id);
                  metadata.stateId = null;
                  metadata.selectionBasis = 'first-declared';
                  metadata.route = registryText(target.pathname + target.search + target.hash);
                }
              }
            }
          }
        }
      }
      if (metadata.launchUrl !== undefined) { metadata.launchStatus = 'available'; delete metadata.holdReason; }
      entries.push({ hostId: context.hostId, rootId: context.rootId, relativePath,
        sourceProjectId: await deriveSourceProjectId(context.hostId, context.rootId, relativePath),
        displayName: registryText(entry.title, 160), repoIdentity: { localOnly: true }, metadata, previews: [],
        ...(revision === undefined ? {} : { revision }),
      });
    }
  }
  return { hostId: context.hostId, hostFingerprint: context.hostFingerprint, generation: context.generation,
    observedAt: context.observedAt, complete, entries };
}
