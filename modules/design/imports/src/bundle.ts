import {
  isSha256Digest, NAMESPACE_CLASSES, SCHEMAS,
  type ClockPort, type DigestPort, type JsonValue, type NamespaceClass, type NamespaceInfo,
  type Sha256Digest, type StoragePort, type WriteOp,
} from './contract.ts';
import { canonicalBytes, digestBytes, digestJson, jsonEqual, webCryptoDigest } from './jcs.ts';

/**
 * `hq.design.bundle/v1`: explicit backup/export/restore across StoragePort
 * namespaces. `cache` is never bundled. Drafts are only carried by the
 * separately chosen private `draft-backup` kind; a publishable `export`
 * excludes them and carries only blobs its documents reference.
 */

export type BundleKind = 'backup' | 'export' | 'draft-backup';
export type BundlePrivacy = 'owner' | 'publishable' | 'private';
const PRIVACY: Readonly<Record<BundleKind, BundlePrivacy>> = { backup: 'owner', export: 'publishable', 'draft-backup': 'private' };
const INCLUDED_CLASS: Readonly<Record<BundleKind, NamespaceClass>> = { backup: 'workspace', export: 'workspace', 'draft-backup': 'draft' };

export interface BundleDocument { readonly key: string; readonly value: JsonValue }
export interface BundleBlob { readonly digest: Sha256Digest; readonly mediaType: string; readonly data: string }
export interface BundleStream { readonly stream: string; readonly events: readonly { readonly seq: number; readonly payload: JsonValue }[] }

export interface BundleNamespace {
  readonly name: string;
  readonly class: NamespaceClass;
  readonly documents: readonly BundleDocument[];
  readonly blobs: readonly BundleBlob[];
  readonly streams: readonly BundleStream[];
}

export type OmissionReason = 'cache-excluded' | 'draft-backup-is-separate' | 'drafts-excluded-from-export' | 'not-selected' | 'workspace-not-in-draft-backup';

export interface BundleCoverage {
  readonly included: readonly { readonly namespace: string; readonly class: NamespaceClass; readonly documents: number; readonly blobs: number; readonly events: number }[];
  readonly omitted: readonly { readonly namespace: string; readonly class: NamespaceClass; readonly reason: OmissionReason }[];
  /** Blobs left out of a publishable export because no included document references them. */
  readonly unreferencedBlobsOmitted: number;
}

export interface Bundle {
  readonly schema: typeof SCHEMAS.bundle;
  readonly kind: BundleKind;
  readonly privacy: BundlePrivacy;
  readonly createdAt: string;
  readonly coverage: BundleCoverage;
  readonly namespaces: readonly BundleNamespace[];
  /** JCS SHA-256 of every other field. */
  readonly digest: Sha256Digest;
}

export interface BundleDeps {
  readonly storage: StoragePort;
  readonly clock: ClockPort;
  readonly digest?: DigestPort;
}

export class BundleError extends Error {
  readonly reason: string;
  constructor(reason: string, message: string) {
    super(message);
    this.name = 'BundleError';
    this.reason = reason;
  }
}

export const DEFAULT_MAX_BUNDLE_BYTES = 512 * 1024 * 1024;

// ---------------------------------------------------------------------------
// Base64 (exact, dependency-free)
// ---------------------------------------------------------------------------

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const LOOKUP = new Map([...ALPHABET].map((char, index) => [char, index]));

export function encodeBase64(bytes: Uint8Array): string {
  let out = '';
  for (let index = 0; index < bytes.length; index += 3) {
    const a = bytes[index]!;
    const b = bytes[index + 1];
    const c = bytes[index + 2];
    out += ALPHABET[a >> 2]! + ALPHABET[((a & 3) << 4) | ((b ?? 0) >> 4)]!
      + (b === undefined ? '=' : ALPHABET[((b & 15) << 2) | ((c ?? 0) >> 6)]!)
      + (c === undefined ? '=' : ALPHABET[c & 63]!);
  }
  return out;
}

export function decodeBase64(text: string): Uint8Array | null {
  if (text.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/u.test(text)) return null;
  const padding = text.endsWith('==') ? 2 : text.endsWith('=') ? 1 : 0;
  const out = new Uint8Array((text.length / 4) * 3 - padding);
  let position = 0;
  for (let index = 0; index < text.length; index += 4) {
    const values = [0, 1, 2, 3].map((offset) => LOOKUP.get(text[index + offset]!) ?? 0);
    const triple = (values[0]! << 18) | (values[1]! << 12) | (values[2]! << 6) | values[3]!;
    for (const shift of [16, 8, 0]) {
      if (position < out.length) out[position] = (triple >> shift) & 255;
      position += 1;
    }
  }
  // Reject non-canonical encodings (non-zero padding bits).
  return encodeBase64(out) === text ? out : null;
}

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

export interface CreateBundleOptions {
  readonly kind: 'backup' | 'export';
  /** Restrict to these workspace-class namespaces; default all. */
  readonly namespaces?: readonly string[];
  readonly maxBytes?: number;
}

export interface DraftBackupOptions {
  /** Must be literally `true`: the draft backup is private and chosen separately. */
  readonly confirmPrivate: true;
  readonly namespaces?: readonly string[];
  readonly maxBytes?: number;
}

function collectStrings(value: JsonValue, out: Set<string>): void {
  if (typeof value === 'string') out.add(value);
  else if (Array.isArray(value)) for (const item of value) collectStrings(item, out);
  else if (value !== null && typeof value === 'object') for (const item of Object.values(value)) collectStrings(item as JsonValue, out);
}

function omissionFor(kind: BundleKind, info: NamespaceInfo): OmissionReason {
  if (info.class === 'cache') return 'cache-excluded';
  if (info.class === 'draft') return kind === 'export' ? 'drafts-excluded-from-export' : 'draft-backup-is-separate';
  return kind === 'draft-backup' ? 'workspace-not-in-draft-backup' : 'not-selected';
}

async function build(deps: BundleDeps, kind: BundleKind, selected: readonly string[] | undefined, maxBytes: number): Promise<Bundle> {
  const digest = deps.digest ?? webCryptoDigest;
  const available = await deps.storage.namespaces();
  const includedClass = INCLUDED_CLASS[kind];
  for (const name of selected ?? []) {
    const info = available.find((item) => item.name === name);
    if (info === undefined) throw new BundleError('unknown-namespace', `Unknown namespace ${name}`);
    if (info.class !== includedClass) throw new BundleError('namespace-class', `${name} is ${info.class}; ${kind} carries only ${includedClass}`);
  }
  const namespaces: BundleNamespace[] = [];
  const included: BundleCoverage['included'][number][] = [];
  const omitted: BundleCoverage['omitted'][number][] = [];
  let unreferencedBlobsOmitted = 0;
  let size = 0;
  for (const info of [...available].sort((a, b) => (a.name < b.name ? -1 : 1))) {
    if (info.class !== includedClass || (selected !== undefined && !selected.includes(info.name))) {
      omitted.push({ namespace: info.name, class: info.class, reason: omissionFor(kind, info) });
      continue;
    }
    const documents = (await deps.storage.listDocuments(info.name)).map((document) => ({ key: document.key, value: document.value }));
    const streams: BundleStream[] = [];
    for (const stream of await deps.storage.listStreams(info.name)) {
      const events = (await deps.storage.readEvents(info.name, stream)).map((event) => ({ seq: event.seq, payload: event.payload }));
      streams.push({ stream, events });
    }
    let referenced: Set<string> | null = null;
    if (kind === 'export') {
      referenced = new Set();
      for (const document of documents) collectStrings(document.value, referenced);
      for (const stream of streams) for (const event of stream.events) collectStrings(event.payload, referenced);
    }
    const blobs: BundleBlob[] = [];
    for (const blobInfo of await deps.storage.listBlobs(info.name)) {
      if (referenced !== null && !referenced.has(blobInfo.digest)) { unreferencedBlobsOmitted += 1; continue; }
      const bytes = await deps.storage.getBlob(info.name, blobInfo.digest);
      if (bytes === null) throw new BundleError('missing-blob', `Listed blob ${blobInfo.digest} is unreadable`);
      if ((await digestBytes(digest, bytes)) !== blobInfo.digest) throw new BundleError('blob-digest', `Stored blob ${blobInfo.digest} fails verification`);
      size += bytes.byteLength;
      if (size > maxBytes) throw new BundleError('too-large', 'Bundle exceeds the size bound');
      blobs.push({ digest: blobInfo.digest, mediaType: blobInfo.mediaType, data: encodeBase64(bytes) });
    }
    namespaces.push({ name: info.name, class: info.class, documents, blobs, streams });
    included.push({
      namespace: info.name, class: info.class, documents: documents.length, blobs: blobs.length,
      events: streams.reduce((total, stream) => total + stream.events.length, 0),
    });
  }
  const body = {
    schema: SCHEMAS.bundle, kind, privacy: PRIVACY[kind], createdAt: deps.clock.now(),
    coverage: { included, omitted, unreferencedBlobsOmitted }, namespaces,
  };
  const bundle: Bundle = { ...body, digest: await digestJson(digest, body) };
  if (canonicalBytes(bundle).byteLength > maxBytes) throw new BundleError('too-large', 'Bundle exceeds the size bound');
  return bundle;
}

/** Owner backup (all workspace namespaces) or publishable export (no drafts, referenced blobs only). */
export function createBundle(deps: BundleDeps, options: CreateBundleOptions): Promise<Bundle> {
  if (options.kind !== 'backup' && options.kind !== 'export') return Promise.reject(new BundleError('kind', 'Use createDraftBackup for drafts'));
  return build(deps, options.kind, options.namespaces, options.maxBytes ?? DEFAULT_MAX_BUNDLE_BYTES);
}

/** Private backup of draft namespaces only; never produced implicitly. */
export function createDraftBackup(deps: BundleDeps, options: DraftBackupOptions): Promise<Bundle> {
  if (options?.confirmPrivate !== true) return Promise.reject(new BundleError('confirm-private', 'Draft backup must be explicitly chosen as private'));
  return build(deps, 'draft-backup', options.namespaces, options.maxBytes ?? DEFAULT_MAX_BUNDLE_BYTES);
}

export const serializeBundle = (bundle: Bundle): Uint8Array => canonicalBytes(bundle);

// ---------------------------------------------------------------------------
// Parse
// ---------------------------------------------------------------------------

export type ParseResult =
  | { readonly ok: true; readonly bundle: Bundle }
  | { readonly ok: false; readonly reason: 'unsupported-version' | 'invalid-bundle' | 'digest-mismatch' | 'too-large'; readonly detail: string };

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const onlyKeys = (value: Record<string, unknown>, keys: readonly string[]): boolean =>
  Object.keys(value).every((key) => keys.includes(key)) && keys.every((key) => key in value);
const isClass = (value: unknown): value is NamespaceClass => NAMESPACE_CLASSES.some((item) => item === value);
const isName = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 512 && !/[\u0000-\u001f]/u.test(value);

function invalid(detail: string): ParseResult {
  return { ok: false, reason: 'invalid-bundle', detail };
}

/** Strict: unknown fields, future versions, digest or blob mismatches are rejected. */
export async function parseBundle(input: Uint8Array | string, options: { readonly digest?: DigestPort; readonly maxBytes?: number } = {}): Promise<ParseResult> {
  const digest = options.digest ?? webCryptoDigest;
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BUNDLE_BYTES;
  const length = typeof input === 'string' ? input.length : input.byteLength;
  if (length > maxBytes * 2) return { ok: false, reason: 'too-large', detail: 'input exceeds bound' };
  let raw: unknown;
  try {
    raw = JSON.parse(typeof input === 'string' ? input : new TextDecoder('utf-8', { fatal: true }).decode(input));
  } catch {
    return invalid('not UTF-8 JSON');
  }
  if (!isObject(raw)) return invalid('not an object');
  if (raw.schema !== SCHEMAS.bundle) {
    const match = typeof raw.schema === 'string' ? /^hq\.design\.bundle\/v([1-9][0-9]{0,5})$/u.exec(raw.schema) : null;
    if (match !== null && Number(match[1]) > 1) return { ok: false, reason: 'unsupported-version', detail: String(raw.schema) };
    return invalid('schema');
  }
  if (!onlyKeys(raw, ['schema', 'kind', 'privacy', 'createdAt', 'coverage', 'namespaces', 'digest'])) return invalid('fields');
  const kind = raw.kind;
  if (kind !== 'backup' && kind !== 'export' && kind !== 'draft-backup') return invalid('kind');
  if (raw.privacy !== PRIVACY[kind]) return invalid('privacy');
  if (typeof raw.createdAt !== 'string' || Number.isNaN(Date.parse(raw.createdAt))) return invalid('createdAt');
  if (!isSha256Digest(raw.digest)) return invalid('digest');
  if (!isObject(raw.coverage) || !onlyKeys(raw.coverage, ['included', 'omitted', 'unreferencedBlobsOmitted'])
    || !Array.isArray(raw.coverage.included) || !Array.isArray(raw.coverage.omitted)
    || !Number.isSafeInteger(raw.coverage.unreferencedBlobsOmitted)
    || !(raw.coverage.included as unknown[]).every((item) => isObject(item) && onlyKeys(item, ['namespace', 'class', 'documents', 'blobs', 'events'])
      && isName(item.namespace) && isClass(item.class) && [item.documents, item.blobs, item.events].every((count) => Number.isSafeInteger(count)))
    || !(raw.coverage.omitted as unknown[]).every((item) => isObject(item) && onlyKeys(item, ['namespace', 'class', 'reason'])
      && isName(item.namespace) && isClass(item.class) && typeof item.reason === 'string')) return invalid('coverage');
  if (!Array.isArray(raw.namespaces)) return invalid('namespaces');
  const names = new Set<string>();
  let size = 0;
  for (const ns of raw.namespaces as unknown[]) {
    if (!isObject(ns) || !onlyKeys(ns, ['name', 'class', 'documents', 'blobs', 'streams']) || !isName(ns.name) || !isClass(ns.class)) return invalid('namespace');
    if (names.has(ns.name)) return invalid('duplicate namespace');
    names.add(ns.name);
    if (ns.class !== INCLUDED_CLASS[kind]) return invalid(`namespace class ${ns.class} not allowed in ${kind}`);
    if (!Array.isArray(ns.documents) || !Array.isArray(ns.blobs) || !Array.isArray(ns.streams)) return invalid('namespace content');
    const keys = new Set<string>();
    for (const document of ns.documents as unknown[]) {
      if (!isObject(document) || !onlyKeys(document, ['key', 'value']) || !isName(document.key) || keys.has(document.key)) return invalid('document');
      keys.add(document.key);
    }
    const digests = new Set<string>();
    for (const blob of ns.blobs as unknown[]) {
      if (!isObject(blob) || !onlyKeys(blob, ['digest', 'mediaType', 'data']) || !isSha256Digest(blob.digest)
        || typeof blob.mediaType !== 'string' || typeof blob.data !== 'string' || digests.has(blob.digest)) return invalid('blob');
      digests.add(blob.digest);
      const bytes = decodeBase64(blob.data);
      if (bytes === null) return invalid('blob encoding');
      size += bytes.byteLength;
      if (size > maxBytes) return { ok: false, reason: 'too-large', detail: 'blobs exceed bound' };
      if ((await digestBytes(digest, bytes)) !== blob.digest) return { ok: false, reason: 'digest-mismatch', detail: `blob ${blob.digest}` };
    }
    const streams = new Set<string>();
    for (const stream of ns.streams as unknown[]) {
      if (!isObject(stream) || !onlyKeys(stream, ['stream', 'events']) || !isName(stream.stream) || streams.has(stream.stream) || !Array.isArray(stream.events)) return invalid('stream');
      streams.add(stream.stream);
      let expected = 1;
      for (const event of stream.events as unknown[]) {
        if (!isObject(event) || !onlyKeys(event, ['seq', 'payload']) || event.seq !== expected) return invalid('event sequence');
        expected += 1;
      }
    }
  }
  const { digest: claimed, ...body } = raw;
  let actual: Sha256Digest;
  try {
    actual = await digestJson(digest, body);
  } catch {
    return invalid('content is not canonical JSON');
  }
  if (actual !== claimed) return { ok: false, reason: 'digest-mismatch', detail: 'bundle digest' };
  return { ok: true, bundle: raw as unknown as Bundle };
}

// ---------------------------------------------------------------------------
// Restore
// ---------------------------------------------------------------------------

export interface RestoreConflict {
  readonly namespace: string;
  readonly kind: 'document' | 'blob' | 'stream' | 'namespace';
  readonly key: string;
}

export type RestoreResult =
  | { readonly ok: true; readonly applied: boolean; readonly written: { readonly documents: number; readonly blobs: number; readonly events: number } }
  | { readonly ok: false; readonly reason: 'conflicts' | 'drafts-not-allowed'; readonly conflicts: readonly RestoreConflict[] };

/**
 * Additive and non-destructive: identical content is skipped, differing
 * content is a conflict that aborts the whole restore with no writes.
 * Existing content absent from the bundle is left untouched.
 */
export async function restoreBundle(deps: BundleDeps, bundle: Bundle, options: { readonly allowDrafts?: boolean } = {}): Promise<RestoreResult> {
  if (bundle.kind === 'draft-backup' && options.allowDrafts !== true) return { ok: false, reason: 'drafts-not-allowed', conflicts: [] };
  const available = await deps.storage.namespaces();
  const conflicts: RestoreConflict[] = [];
  const ops: WriteOp[] = [];
  const written = { documents: 0, blobs: 0, events: 0 };
  for (const ns of bundle.namespaces) {
    const target = available.find((info) => info.name === ns.name);
    if (target === undefined || target.class !== ns.class) { conflicts.push({ namespace: ns.name, kind: 'namespace', key: ns.name }); continue; }
    for (const document of ns.documents) {
      const existing = await deps.storage.getDocument(ns.name, document.key);
      if (existing === null) {
        ops.push({ op: 'put-document', namespace: ns.name, key: document.key, value: document.value, expectedRevision: null });
        written.documents += 1;
      } else if (!jsonEqual(existing.value, document.value)) {
        conflicts.push({ namespace: ns.name, kind: 'document', key: document.key });
      }
    }
    const existingBlobs = new Map((await deps.storage.listBlobs(ns.name)).map((blob) => [blob.digest as string, blob.mediaType]));
    for (const blob of ns.blobs) {
      const existing = existingBlobs.get(blob.digest);
      if (existing === undefined) {
        ops.push({ op: 'put-blob', namespace: ns.name, digest: blob.digest, mediaType: blob.mediaType, bytes: decodeBase64(blob.data)! });
        written.blobs += 1;
      } else if (existing !== blob.mediaType) {
        conflicts.push({ namespace: ns.name, kind: 'blob', key: blob.digest });
      }
    }
    for (const stream of ns.streams) {
      const existing = await deps.storage.readEvents(ns.name, stream.stream);
      const prefixMatches = existing.length <= stream.events.length
        && existing.every((event, index) => event.seq === stream.events[index]!.seq && jsonEqual(event.payload, stream.events[index]!.payload));
      if (!prefixMatches) { conflicts.push({ namespace: ns.name, kind: 'stream', key: stream.stream }); continue; }
      for (const event of stream.events.slice(existing.length)) {
        ops.push({ op: 'append-event', namespace: ns.name, stream: stream.stream, payload: event.payload, expectedSeq: event.seq - 1 });
        written.events += 1;
      }
    }
  }
  if (conflicts.length > 0) return { ok: false, reason: 'conflicts', conflicts };
  if (ops.length === 0) return { ok: true, applied: false, written };
  await deps.storage.commit(ops);
  return { ok: true, applied: true, written };
}
