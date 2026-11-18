import {
  isId, RIGHTS_BASES,
  type BundleFileRef, type DigestPort, type ImportSource, type ItemProvenance, type Rights,
  type Sha256Digest, type SourceItem, type VersionContent, type ViewId,
} from './contract.ts';
import { digestBytes, digestJson } from './jcs.ts';
import { checkHtmlBundle, checkPng, checkRecording, checkUrl, isBoundedText, LIMITS } from './media.ts';

export interface ImportProblem {
  readonly code: string;
  readonly itemKey?: string;
  readonly detail?: string;
}

export interface MappedBlob {
  readonly digest: Sha256Digest;
  readonly mediaType: string;
  readonly bytes: Uint8Array;
}

/** Importer-owned representation of one source item; `itemDigest` covers all of it. */
export interface MappedItem {
  readonly key: string;
  readonly title: string;
  readonly viewId: ViewId | null;
  readonly rights: Rights;
  readonly provenance: ItemProvenance;
  readonly content: VersionContent;
  readonly blobs: readonly MappedBlob[];
  readonly itemDigest: Sha256Digest;
}

export type MapResult =
  | { readonly ok: true; readonly items: readonly MappedItem[] }
  | { readonly ok: false; readonly problems: readonly ImportProblem[] };

/**
 * Converts one source format family/version into mapped items. Legacy format
 * adapters (HQD-12b) register here after S3 public-safe format notes.
 */
export interface SourceMapper {
  readonly kind: string;
  readonly versions: readonly number[];
  readonly mappingId: string;
  readonly mappingVersion: number;
  map(source: ImportSource, digest: DigestPort): Promise<MapResult>;
}

export type MapperResolution =
  | { readonly ok: true; readonly mapper: SourceMapper }
  | { readonly ok: false; readonly problem: ImportProblem };

export interface MapperRegistry {
  resolve(kind: unknown, version: unknown): MapperResolution;
  readonly kinds: readonly { readonly kind: string; readonly versions: readonly number[] }[];
}

export function createMapperRegistry(mappers: readonly SourceMapper[]): MapperRegistry {
  const byKind = new Map<string, SourceMapper>();
  for (const mapper of mappers) {
    if (byKind.has(mapper.kind)) throw new Error(`Duplicate mapper for ${mapper.kind}`);
    byKind.set(mapper.kind, mapper);
  }
  return {
    kinds: mappers.map((mapper) => ({ kind: mapper.kind, versions: [...mapper.versions] })),
    resolve(kind, version) {
      if (typeof kind !== 'string') return { ok: false, problem: { code: 'unsupported-source-kind' } };
      const mapper = byKind.get(kind);
      if (mapper === undefined) return { ok: false, problem: { code: 'unsupported-source-kind', detail: kind.slice(0, 80) } };
      if (typeof version !== 'number' || !Number.isSafeInteger(version) || !mapper.versions.includes(version)) {
        return { ok: false, problem: { code: 'unsupported-version', detail: `${kind}@${String(version).slice(0, 20)}` } };
      }
      return { ok: true, mapper };
    },
  };
}

function checkRights(value: unknown): Rights | null {
  if (typeof value !== 'object' || value === null) return null;
  const rights = value as Record<string, unknown>;
  if (!Object.keys(rights).every((key) => ['basis', 'holder', 'license', 'attribution'].includes(key))) return null;
  if (!RIGHTS_BASES.some((basis) => basis === rights.basis) || !isBoundedText(rights.holder)) return null;
  if (rights.license !== undefined && !isBoundedText(rights.license)) return null;
  if (rights.attribution !== undefined && !isBoundedText(rights.attribution)) return null;
  if (rights.basis === 'licensed' && rights.license === undefined) return null;
  return {
    basis: rights.basis as Rights['basis'], holder: rights.holder,
    ...(typeof rights.license === 'string' ? { license: rights.license } : {}),
    ...(typeof rights.attribution === 'string' ? { attribution: rights.attribution } : {}),
  };
}

function checkProvenance(value: unknown): ItemProvenance | null {
  if (value === undefined) return {};
  if (typeof value !== 'object' || value === null) return null;
  const provenance = value as Record<string, unknown>;
  const fields = ['originalName', 'author', 'capturedAt', 'note'];
  if (!Object.keys(provenance).every((key) => fields.includes(key))) return null;
  const out: Record<string, string> = {};
  for (const field of fields) {
    const item = provenance[field];
    if (item === undefined) continue;
    if (!isBoundedText(item, field === 'note' ? 2_000 : LIMITS.maxTextLength)) return null;
    out[field] = item;
  }
  if (out.capturedAt !== undefined && Number.isNaN(Date.parse(out.capturedAt))) return null;
  return out;
}

async function mapContent(item: SourceItem, digest: DigestPort): Promise<{ content: VersionContent; blobs: MappedBlob[] } | string> {
  const payload = item.payload;
  switch (payload?.kind) {
    case 'png': {
      if (!(payload.bytes instanceof Uint8Array)) return 'png-bytes';
      const check = checkPng(payload.bytes);
      if (!check.ok) return check.problem;
      const blobDigest = await digestBytes(digest, payload.bytes);
      return {
        content: { kind: 'image', mediaType: 'image/png', digest: blobDigest, bytes: payload.bytes.byteLength, w: check.value.w, h: check.value.h },
        blobs: [{ digest: blobDigest, mediaType: 'image/png', bytes: payload.bytes }],
      };
    }
    case 'recording': {
      if (!(payload.bytes instanceof Uint8Array) || typeof payload.mediaType !== 'string') return 'recording-bytes';
      const check = checkRecording(payload.mediaType, payload.bytes);
      if (!check.ok) return check.problem;
      const blobDigest = await digestBytes(digest, payload.bytes);
      return {
        content: { kind: 'recording', mediaType: payload.mediaType, digest: blobDigest, bytes: payload.bytes.byteLength },
        blobs: [{ digest: blobDigest, mediaType: payload.mediaType, bytes: payload.bytes }],
      };
    }
    case 'html-bundle': {
      if (!Array.isArray(payload.files) || typeof payload.entry !== 'string'
        || !payload.files.every((file) => file !== null && typeof file === 'object' && file.bytes instanceof Uint8Array
          && typeof file.path === 'string' && typeof file.mediaType === 'string')) return 'bundle-shape';
      const check = checkHtmlBundle(payload.entry, payload.files);
      if (!check.ok) return check.problem;
      const files: BundleFileRef[] = [];
      const blobs: MappedBlob[] = [];
      for (const file of [...payload.files].sort((a, b) => (a.path < b.path ? -1 : 1))) {
        const fileDigest = await digestBytes(digest, file.bytes);
        files.push({ path: file.path, digest: fileDigest, mediaType: file.mediaType, bytes: file.bytes.byteLength });
        if (!blobs.some((blob) => blob.digest === fileDigest)) blobs.push({ digest: fileDigest, mediaType: file.mediaType, bytes: file.bytes });
      }
      return { content: { kind: 'html-bundle', entry: payload.entry, files }, blobs };
    }
    case 'url': {
      if (typeof payload.url !== 'string') return 'url-shape';
      const check = checkUrl(payload.url);
      if (!check.ok) return check.problem;
      return { content: { kind: 'url', url: check.value.url }, blobs: [] };
    }
    default:
      return 'unsupported-payload';
  }
}

/** Built-in `hq.files` v1: an explicitly selected set of permitted design files and URLs. */
export const FILES_MAPPER: SourceMapper = {
  kind: 'hq.files',
  versions: [1],
  mappingId: 'hq.files-to-view-version',
  mappingVersion: 1,
  async map(source, digest) {
    const problems: ImportProblem[] = [];
    const items: MappedItem[] = [];
    if (!Array.isArray(source.items) || source.items.length === 0) return { ok: false, problems: [{ code: 'no-items' }] };
    if (source.items.length > LIMITS.maxItems) return { ok: false, problems: [{ code: 'too-many-items' }] };
    const keys = new Set<string>();
    // Blobs shared between items must agree on media type: the store keys blobs by digest.
    const blobTypes = new Map<string, string>();
    for (const item of source.items) {
      const key = typeof item?.key === 'string' ? item.key : '';
      if (!isBoundedText(key, 160)) { problems.push({ code: 'item-key', itemKey: key.slice(0, 40) }); continue; }
      if (keys.has(key)) { problems.push({ code: 'duplicate-item-key', itemKey: key }); continue; }
      keys.add(key);
      if (!isBoundedText(item.title)) { problems.push({ code: 'item-title', itemKey: key }); continue; }
      const rights = checkRights(item.rights);
      if (rights === null) { problems.push({ code: 'rights-not-permitted', itemKey: key }); continue; }
      const provenance = checkProvenance(item.provenance);
      if (provenance === null) { problems.push({ code: 'provenance-shape', itemKey: key }); continue; }
      if (item.viewId !== undefined && !isId(item.viewId)) { problems.push({ code: 'view-id', itemKey: key }); continue; }
      const mapped = await mapContent(item, digest);
      if (typeof mapped === 'string') { problems.push({ code: mapped, itemKey: key }); continue; }
      const conflictingBlob = mapped.blobs.find((blob) => (blobTypes.get(blob.digest) ?? blob.mediaType) !== blob.mediaType);
      if (conflictingBlob !== undefined) { problems.push({ code: 'blob-media-type-conflict', itemKey: key }); continue; }
      for (const blob of mapped.blobs) blobTypes.set(blob.digest, blob.mediaType);
      const viewIdValue = item.viewId ?? null;
      const itemDigest = await digestJson(digest, { title: item.title, viewId: viewIdValue, rights, provenance, content: mapped.content });
      items.push({ key, title: item.title, viewId: viewIdValue, rights, provenance, content: mapped.content, blobs: mapped.blobs, itemDigest });
    }
    return problems.length > 0 ? { ok: false, problems } : { ok: true, items };
  },
};

export const defaultMapperRegistry = (): MapperRegistry => createMapperRegistry([FILES_MAPPER]);
