import type {
  AppPlatform, BlobDigest, ClaimLevel, ImportSource, NativeExecutionEvidence, ReferenceId, ReferenceKind,
  ReferenceRecord, ReferenceRights, ReferenceSource, RightsStatus, ValidationIssue,
} from './contract.ts';
import { APP_PLATFORMS, CLAIM_LEVELS, NATIVE_RUNTIMES, RIGHTS_STATUSES } from './contract.ts';
import { jcsDigest } from './jcs.ts';

export function isOneOf<T extends string>(list: readonly T[], value: unknown): value is T {
  return typeof value === 'string' && (list as readonly string[]).includes(value);
}

/** Bounded single-line text with no control characters. */
export function isText(value: unknown, max = 300): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= max
    && value.trim() === value && !/[\u0000-\u001f\u007f]/u.test(value);
}

const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/u;
export function isIsoTime(value: unknown): value is string {
  return typeof value === 'string' && ISO_UTC.test(value) && !Number.isNaN(Date.parse(value));
}

const DIGEST = /^sha256:[0-9a-f]{64}$/u;
export function isBlobDigest(value: unknown): value is BlobDigest {
  return typeof value === 'string' && DIGEST.test(value);
}

const REFERENCE_ID = /^ref_[0-9a-f]{64}$/u;
export function isReferenceId(value: unknown): value is ReferenceId {
  return typeof value === 'string' && REFERENCE_ID.test(value);
}

/** Opaque owner-record IDs: prefix plus bounded URL-safe token. */
export function isOpaqueId(value: unknown, prefix: string): value is string {
  return typeof value === 'string' && value.length <= 120 && value.startsWith(`${prefix}_`)
    && /^[a-z]+_[A-Za-z0-9-]{1,100}$/u.test(value);
}

const APP_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/u;

/**
 * Normalizes an http(s) URL for identity: lowercase scheme/host, no default
 * port, no fragment. URLs carrying credentials are rejected, not stripped.
 */
export function normalizeUrl(raw: string): string | null {
  if (typeof raw !== 'string' || raw.length > 2048) return null;
  let url: URL;
  try { url = new URL(raw); } catch { return null; }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  if (url.username !== '' || url.password !== '') return null;
  url.hash = '';
  return url.toString();
}

export function normalizeSource(source: ImportSource | undefined, issues: ValidationIssue[]): ReferenceSource | null {
  if (source === undefined || source === null || typeof source !== 'object') {
    issues.push({ field: 'source', code: 'required' });
    return null;
  }
  if (source.kind === 'url') {
    const url = normalizeUrl(source.url);
    if (url === null) { issues.push({ field: 'source.url', code: 'invalid-url' }); return null; }
    return { kind: 'url', url };
  }
  if (source.kind === 'app') {
    const before = issues.length;
    if (!isOneOf(APP_PLATFORMS, source.platform)) issues.push({ field: 'source.platform', code: 'unsupported-platform' });
    if (typeof source.appId !== 'string' || !APP_ID.test(source.appId)) issues.push({ field: 'source.appId', code: 'invalid' });
    if (!isText(source.appName, 200)) issues.push({ field: 'source.appName', code: 'invalid' });
    if (source.screen !== undefined && !isText(source.screen, 300)) issues.push({ field: 'source.screen', code: 'invalid' });
    if (issues.length > before) return null;
    return {
      kind: 'app', platform: source.platform as AppPlatform, appId: source.appId, appName: source.appName,
      screen: source.screen ?? null,
    };
  }
  issues.push({ field: 'source.kind', code: 'unsupported' });
  return null;
}

const MEDIA_RULES: Record<ReferenceKind, (mediaType: string) => boolean> = {
  screenshot: (type) => type.startsWith('image/'),
  recording: (type) => type.startsWith('video/') || type === 'image/gif' || type === 'image/apng',
  'web-prototype': (type) => type === 'text/html' || type === 'application/zip' || type === 'application/x-hq-html-bundle',
  native: () => true,
};

export function mediaTypeFitsKind(kind: ReferenceKind, mediaType: string): boolean {
  return MEDIA_RULES[kind](mediaType);
}

export function isMediaType(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 127 && /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/u.test(value);
}

/**
 * Native-execution evidence is accepted only for `native` references with an
 * app source. Screenshots, recordings and web prototypes cannot carry it.
 */
export function validateNativeEvidence(
  kind: ReferenceKind, source: ReferenceSource | null, raw: unknown, issues: ValidationIssue[],
): NativeExecutionEvidence | null {
  if (kind !== 'native') {
    if (raw !== undefined) issues.push({ field: 'nativeEvidence', code: `${kind}-cannot-claim-native-execution` });
    return null;
  }
  if (source !== null && source.kind !== 'app') issues.push({ field: 'source', code: 'native-requires-app-source' });
  if (raw === undefined || raw === null || typeof raw !== 'object') {
    issues.push({ field: 'nativeEvidence', code: 'required-for-native' });
    return null;
  }
  const value = raw as Record<string, unknown>;
  const before = issues.length;
  if (!isOneOf(APP_PLATFORMS, value.platform)) issues.push({ field: 'nativeEvidence.platform', code: 'unsupported-platform' });
  if (!isOneOf(NATIVE_RUNTIMES, value.runtime)) issues.push({ field: 'nativeEvidence.runtime', code: 'invalid' });
  if (!isText(value.buildRef, 200)) issues.push({ field: 'nativeEvidence.buildRef', code: 'required' });
  if (!isOneOf(CLAIM_LEVELS, value.claim)) issues.push({ field: 'nativeEvidence.claim', code: 'invalid' });
  if (source !== null && source.kind === 'app' && value.platform !== source.platform) {
    issues.push({ field: 'nativeEvidence.platform', code: 'platform-mismatch' });
  }
  if (issues.length > before) return null;
  return {
    platform: value.platform as AppPlatform, runtime: value.runtime as NativeExecutionEvidence['runtime'],
    buildRef: value.buildRef as string, claim: value.claim as ClaimLevel,
  };
}

/** Missing rights mean `unknown`; `permitted` requires a stated basis. */
export function validateRights(
  raw: { readonly status: string; readonly basis?: string; readonly attribution?: string } | undefined,
  setBy: ClaimLevel, setAt: string, issues: ValidationIssue[],
): ReferenceRights {
  if (raw === undefined) return { status: 'unknown', basis: null, attribution: null, setBy, setAt };
  const before = issues.length;
  if (!isOneOf(RIGHTS_STATUSES, raw.status)) issues.push({ field: 'rights.status', code: 'invalid' });
  if (raw.basis !== undefined && !isText(raw.basis, 500)) issues.push({ field: 'rights.basis', code: 'invalid' });
  if (raw.attribution !== undefined && !isText(raw.attribution, 500)) issues.push({ field: 'rights.attribution', code: 'invalid' });
  if (raw.status === 'permitted' && raw.basis === undefined) issues.push({ field: 'rights.basis', code: 'required-when-permitted' });
  if (issues.length > before) return { status: 'unknown', basis: null, attribution: null, setBy, setAt };
  return { status: raw.status as RightsStatus, basis: raw.basis ?? null, attribution: raw.attribution ?? null, setBy, setAt };
}

export function isPublishPermitted(record: Pick<ReferenceRecord, 'rights'>): boolean {
  return record.rights.status === 'permitted' && record.rights.basis !== null;
}

/**
 * Stable ID: SHA-256 of the JCS identity (normalized source, kind, asset
 * digest). Titles, notes, capture time and display names never participate,
 * so re-importing the same reference yields the same ID.
 */
export async function deriveReferenceId(
  source: ReferenceSource, kind: ReferenceKind, assetDigest: BlobDigest | null,
): Promise<ReferenceId> {
  const identitySource = source.kind === 'url'
    ? { kind: 'url', url: source.url }
    : { kind: 'app', platform: source.platform, appId: source.appId, screen: source.screen };
  const digest = await jcsDigest({ v: 1, source: identitySource, kind, asset: assetDigest });
  return `ref_${digest}` as ReferenceId;
}

export type ExecutionClass = 'static-image' | 'recorded-media' | 'browser-prototype' | 'native-execution';

export interface EvidenceDescription {
  readonly executionClass: ExecutionClass;
  readonly isNativeExecution: boolean;
  readonly label: string;
  readonly caveat: string | null;
}

const PLATFORM_NAMES: Record<AppPlatform, string> = {
  ios: 'iOS', ipados: 'iPadOS', android: 'Android', macos: 'macOS', windows: 'Windows', linux: 'Linux',
  watchos: 'watchOS', tvos: 'tvOS', visionos: 'visionOS',
};

export function platformName(platform: AppPlatform): string {
  return PLATFORM_NAMES[platform];
}

/**
 * The execution label is derived from kind plus validated evidence; importers
 * cannot set it. Only `native` with native evidence is native execution.
 */
export function describeEvidence(record: Pick<ReferenceRecord, 'kind' | 'source' | 'nativeEvidence'>): EvidenceDescription {
  const subject = record.source.kind === 'app' ? `${platformName(record.source.platform)} app` : 'website';
  switch (record.kind) {
    case 'screenshot':
      return { executionClass: 'static-image', isNativeExecution: false, label: `Screenshot of ${subject}`, caveat: 'Static image — not native execution' };
    case 'recording':
      return { executionClass: 'recorded-media', isNativeExecution: false, label: `Recording of ${subject}`, caveat: 'Recorded media — not native execution' };
    case 'web-prototype':
      return { executionClass: 'browser-prototype', isNativeExecution: false, label: 'Web prototype', caveat: 'Browser mock — not native acceptance evidence' };
    case 'native': {
      const evidence = record.nativeEvidence;
      if (evidence === null) {
        return { executionClass: 'static-image', isNativeExecution: false, label: `Native ${subject} (unverified)`, caveat: 'No native execution evidence' };
      }
      return {
        executionClass: 'native-execution', isNativeExecution: true,
        label: `Native ${platformName(evidence.platform)} on ${evidence.runtime}`,
        caveat: evidence.claim === 'agent-reported' ? 'Agent-reported, not observed' : null,
      };
    }
  }
}
