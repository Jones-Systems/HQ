// Index snapshot (`hq.wiki.index/v1`): the serialisable result of indexing one namespace at one commit.
// It lives outside the sources (via an IndexStore) and is keyed by namespace and commit. A snapshot read
// back from a store is untrusted: `parseSnapshot` re-validates every field and rejects anything that
// does not match the expected namespace, commit and profile, so corrupt or stale data triggers a rebuild.

import {
  MAX_BACKLINK_EXCERPT_LENGTH,
  MAX_BACKLINK_VIA,
  MAX_LABEL_LENGTH,
  MAX_PAGE_BLOB_BYTES,
  RAW_REASONS,
  isNamespace,
  validateLinkTarget,
  validatePagePath,
  type LinkTarget,
  type RawReason,
  type WikiNamespace,
} from '../../contract/src/index.ts';
import { isFieldName } from './profile.ts';

export const INDEX_SCHEMA_ID = 'hq.wiki.index/v1';

/** Longest excerpt kept per page for snippets. */
export const MAX_EXCERPT_UNITS = 4096;

/**
 * How one page links to one other page of its namespace; the data behind a backlink entry. One per
 * unique (this page, target page) pair, for `page` targets other than the page itself.
 */
export interface LinkOrigin {
  /** Path of the target page. */
  readonly path: string;
  /** Distinct origins, sorted by code unit, 1..MAX_BACKLINK_VIA: `body` or a relationship field name. */
  readonly via: readonly string[];
  /** Cleaned text of the block holding the first body link to the target; null when there is none. */
  readonly excerpt: string | null;
}

export interface SnapshotPage {
  /** Path relative to the namespace root. */
  readonly path: string;
  readonly oid: string;
  readonly byteLength: number;
  readonly title: string;
  /** Names the page answers to (title, alias fields, file stem). */
  readonly names: readonly string[];
  readonly topics: readonly string[];
  /** Every unique resolved link target found in the page (uncapped; `Page.outLinks` is capped). */
  readonly links: readonly LinkTarget[];
  /** Provenance of every `links` entry that is a `page` target other than this page, sorted by path. */
  readonly linkOrigins: readonly LinkOrigin[];
  readonly excerpt: string;
  readonly raw: RawReason | null;
  /** `[term, title term frequency, body term frequency]`, sorted by term. */
  readonly terms: readonly (readonly [string, number, number])[];
  readonly titleLength: number;
  readonly bodyLength: number;
}

/** Aggregate counters only: no content, names or paths (safe to report from private validation). */
export interface SnapshotStats {
  readonly pages: number;
  readonly rawFrontmatter: number;
  readonly rawMarkdown: number;
  readonly rawNotText: number;
  readonly nullOmissions: number;
  readonly skippedSymlinks: number;
  readonly skippedSubmodules: number;
  readonly skippedOther: number;
  readonly skippedInvalidPaths: number;
  readonly skippedOversize: number;
  /** Pages whose unique link targets exceeded the `Page.outLinks` cap. */
  readonly outLinkCaps: number;
}

export interface IndexSnapshot {
  readonly schema: typeof INDEX_SCHEMA_ID;
  readonly namespace: WikiNamespace;
  readonly commit: string;
  readonly ref: string;
  readonly commitTime: string;
  readonly indexedAt: string;
  /** Profile/rules fingerprint the snapshot was built with. */
  readonly profileKey: string;
  readonly stats: SnapshotStats;
  readonly pages: readonly SnapshotPage[];
}

export interface SnapshotExpectation {
  readonly namespace: WikiNamespace;
  readonly commit: string;
  readonly profileKey: string;
}

const MAX_SNAPSHOT_PAGES = 250_000;
const MAX_TERMS_PER_PAGE = 100_000;
const MAX_NAMES = 80;
const MAX_TOPICS = 64;
const COMMIT = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/;
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
const STAT_KEYS: readonly (keyof SnapshotStats)[] = [
  'pages',
  'rawFrontmatter',
  'rawMarkdown',
  'rawNotText',
  'nullOmissions',
  'skippedSymlinks',
  'skippedSubmodules',
  'skippedOther',
  'skippedInvalidPaths',
  'skippedOversize',
  'outLinkCaps',
];

function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const own = Object.keys(value);
  return own.length === keys.length && keys.every((key) => key in value);
}

function isCount(value: unknown, max: number = 1_000_000_000): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= max;
}

function isLabel(value: unknown, max: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= max && !CONTROL.test(value) && !LONE_SURROGATE.test(value);
}

function isText(value: unknown, max: number): value is string {
  return typeof value === 'string' && value.length <= max && !value.includes('\u0000') && !LONE_SURROGATE.test(value);
}

function isStrictlyAscending(values: readonly string[]): boolean {
  return values.every((value, i) => i === 0 || (values[i - 1] as string) < value);
}

/** `linkOrigins` must describe exactly the page's own `page` link targets (self excluded), once each. */
function originsMatchLinks(origins: unknown, links: readonly LinkTarget[], self: string): boolean {
  if (!Array.isArray(origins)) return false;
  const expected = new Set<string>();
  for (const link of links) if (link.kind === 'page' && link.key.path !== self) expected.add(link.key.path);
  if (origins.length !== expected.size) return false;
  const paths: string[] = [];
  for (const origin of origins) {
    if (!isRecord(origin) || !hasExactKeys(origin, ['path', 'via', 'excerpt'])) return false;
    const { path, via, excerpt } = origin;
    if (typeof path !== 'string' || !expected.has(path)) return false;
    if (!Array.isArray(via) || via.length < 1 || via.length > MAX_BACKLINK_VIA || !via.every(isFieldName) || !isStrictlyAscending(via)) return false;
    if (excerpt !== null && !isLabel(excerpt, MAX_BACKLINK_EXCERPT_LENGTH)) return false;
    paths.push(path);
  }
  return isStrictlyAscending(paths);
}

function parsePage(value: unknown, namespace: WikiNamespace): SnapshotPage | null {
  if (!isRecord(value)) return null;
  if (!hasExactKeys(value, ['path', 'oid', 'byteLength', 'title', 'names', 'topics', 'links', 'linkOrigins', 'excerpt', 'raw', 'terms', 'titleLength', 'bodyLength'])) return null;
  const { path, oid, byteLength, title, names, topics, links, linkOrigins, excerpt, raw, terms, titleLength, bodyLength } = value;
  if (typeof path !== 'string' || !validatePagePath(path).ok) return null;
  if (typeof oid !== 'string' || !COMMIT.test(oid)) return null;
  if (!isCount(byteLength, MAX_PAGE_BLOB_BYTES) || !isLabel(title, MAX_LABEL_LENGTH)) return null;
  if (!isCount(titleLength) || !isCount(bodyLength) || !isText(excerpt, MAX_EXCERPT_UNITS)) return null;
  if (raw !== null && !(typeof raw === 'string' && (RAW_REASONS as readonly string[]).includes(raw))) return null;
  if (!Array.isArray(names) || names.length > MAX_NAMES || !names.every((n) => isLabel(n, MAX_LABEL_LENGTH))) return null;
  if (!Array.isArray(topics) || topics.length > MAX_TOPICS || !topics.every((t) => isLabel(t, MAX_LABEL_LENGTH))) return null;
  if (!Array.isArray(links)) return null;
  const targets: LinkTarget[] = [];
  for (const link of links) {
    const checked = validateLinkTarget(link);
    if (!checked.ok) return null;
    const target = checked.value;
    if (target.kind === 'page' && target.key.namespace !== namespace) return null;
    if (target.kind === 'ambiguous' && target.candidates.some((c) => c.namespace !== namespace)) return null;
    targets.push(target);
  }
  if (!originsMatchLinks(linkOrigins, targets, path)) return null;
  if (!Array.isArray(terms) || terms.length > MAX_TERMS_PER_PAGE) return null;
  for (const entry of terms) {
    if (!Array.isArray(entry) || entry.length !== 3) return null;
    if (!isLabel(entry[0], 128) || !isCount(entry[1]) || !isCount(entry[2])) return null;
  }
  return value as unknown as SnapshotPage;
}

/**
 * Validate an untrusted stored value against what the caller expects to read. Returns the
 * snapshot, or null when it is corrupt, stale (other commit or profile) or for another namespace.
 */
export function parseSnapshot(value: unknown, expected: SnapshotExpectation): IndexSnapshot | null {
  if (!isRecord(value)) return null;
  if (!hasExactKeys(value, ['schema', 'namespace', 'commit', 'ref', 'commitTime', 'indexedAt', 'profileKey', 'stats', 'pages'])) return null;
  if (value['schema'] !== INDEX_SCHEMA_ID) return null;
  const namespace = value['namespace'];
  if (!isNamespace(namespace) || namespace !== expected.namespace) return null;
  if (value['commit'] !== expected.commit || value['profileKey'] !== expected.profileKey) return null;
  if (!isLabel(value['ref'], 256)) return null;
  if (typeof value['commitTime'] !== 'string' || !ISO.test(value['commitTime'])) return null;
  if (typeof value['indexedAt'] !== 'string' || !ISO.test(value['indexedAt'])) return null;

  const stats = value['stats'];
  if (!isRecord(stats) || !hasExactKeys(stats, STAT_KEYS)) return null;
  for (const key of STAT_KEYS) if (!isCount(stats[key])) return null;

  const pages = value['pages'];
  if (!Array.isArray(pages) || pages.length > MAX_SNAPSHOT_PAGES || pages.length !== stats['pages']) return null;
  const seen = new Set<string>();
  let previous = '';
  for (const entry of pages) {
    const page = parsePage(entry, namespace);
    if (page === null || seen.has(page.path) || page.path < previous) return null;
    seen.add(page.path);
    previous = page.path;
  }
  return value as unknown as IndexSnapshot;
}
