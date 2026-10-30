import { keys, record } from '../../services.js';
import { canonicalJson, codePointCompare, parseCanonicalJson, sha256 } from './canonical-json.js';
import { counter, digest, manifestRoute, opaque, pathSet, relativePath } from './paths.js';
import { requireGeneration } from './types.js';
import type { GenerationBinding, GenerationHealth, GenerationIdentity, GenerationManifest, GenerationRef, PublicationIdentity, PublisherHealth } from './types.js';

export const GENERATION_LIMITS = Object.freeze({ files: 10_000, manifestBytes: 8 * 1024 * 1024,
  generationBytes: 1024 * 1024 * 1024, fileBytes: 64 * 1024 * 1024, previewBytes: 5 * 1024 * 1024 });

function fields(value: unknown, names: readonly string[]): asserts value is Record<string, unknown> {
  requireGeneration(record(value) && keys(value, names), 'invalid_fields');
}
function integer(value: unknown, maximum: number): asserts value is number {
  requireGeneration(typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= maximum, 'invalid_integer');
}
function instant(value: unknown): void {
  requireGeneration(typeof value === 'string' && value.length <= 40, 'invalid_timestamp');
  const text = value.replaceAll('Z', '+00:00');
  const match = /^(?:\d{4}-\d{2}-\d{2}|\d{8}|\d{4}-W\d{2}(?:-\d)?|\d{4}W\d{2}\d?)/.exec(text);
  requireGeneration(match, 'invalid_timestamp');
  const date = match[0], year = Number(date.slice(0, 4));
  requireGeneration(year >= 1, 'invalid_timestamp');
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const week = /W(\d{2})(?:-?(\d))?$/.exec(date);
  if (week) {
    const number = Number(week[1]), weekday = Number(week[2] ?? 1);
    const january = new Date(0); january.setUTCFullYear(year, 0, 1); january.setUTCHours(0, 0, 0, 0);
    const weeks = january.getUTCDay() === 4 || (leap && january.getUTCDay() === 3) ? 53 : 52;
    requireGeneration(number >= 1 && number <= weeks && weekday >= 1 && weekday <= 7, 'invalid_timestamp');
    january.setUTCDate(4);
    january.setUTCDate(4 - (january.getUTCDay() + 6) % 7 + (number - 1) * 7 + weekday - 1);
    requireGeneration(january.getUTCFullYear() >= 1 && january.getUTCFullYear() <= 9999, 'invalid_timestamp');
  } else {
    const compact = date.replaceAll('-', ''), month = Number(compact.slice(4, 6)), day = Number(compact.slice(6, 8));
    const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    requireGeneration(month >= 1 && month <= 12 && day >= 1 && day <= days[month - 1], 'invalid_timestamp');
  }
  // Python's ISO reader allows basic dates, ISO weeks, reduced times, an
  // arbitrary single-character separator, and offsets with fractional seconds.
  const suffix = Array.from(text.slice(date.length));
  requireGeneration(suffix.length >= 2, 'invalid_timestamp');
  const timeAndZone = suffix.slice(1).join(''), zoneAt = timeAndZone.search(/[+-]/);
  requireGeneration(zoneAt > 0, 'invalid_timestamp');
  const timePattern = /^(\d{2})(?:(:?)(\d{2})(?:\2(\d{2}))?)?(?:[.,](\d+))?$/;
  const time = timePattern.exec(timeAndZone.slice(0, zoneAt));
  const zone = timePattern.exec(timeAndZone.slice(zoneAt + 1));
  requireGeneration(time && zone && time[0] === timeAndZone.slice(0, zoneAt) && zone[0] === timeAndZone.slice(zoneAt + 1), 'invalid_timestamp');
  requireGeneration(Number(time[1]) <= 23 && Number(time[3] ?? 0) <= 59 && Number(time[4] ?? 0) <= 59, 'invalid_timestamp');
  const offsetSeconds = Number(zone[1]) * 3600 + Number(zone[3] ?? 0) * 60 + Number(zone[4] ?? 0);
  requireGeneration(offsetSeconds < 86400, 'invalid_timestamp');
}

export function validateBinding(value: GenerationBinding): GenerationBinding {
  try {
    fields(value, ['origin', 'publisherId', 'hostId', 'rootId', 'bindingRevision', 'scopeDigest', 'consistencyMode']);
    requireGeneration(typeof value.origin === 'string' && /^http:\/\/127\.0\.0\.1:[1-9][0-9]{0,4}$/.exec(value.origin)?.[0] === value.origin);
    const port = Number(value.origin.slice(value.origin.lastIndexOf(':') + 1));
    requireGeneration(port >= 1 && port <= 65535);
    for (const name of ['publisherId', 'hostId', 'rootId', 'bindingRevision'] as const) opaque(value[name]);
    digest(value.scopeDigest);
    requireGeneration(value.consistencyMode === 'observed-files-v1' || value.consistencyMode === 'producer-complete-v1');
    return { ...value };
  } catch { throw new TypeError('Invalid generation binding'); }
}
export function identityOf(ref: GenerationRef): GenerationIdentity {
  return { rootId: ref.root_id, epoch: ref.epoch, sequence: ref.sequence, manifestSha256: ref.manifest_sha256 };
}
export function refFor(binding: GenerationBinding, identity: GenerationIdentity): GenerationRef {
  return { schema: 'hq-sync.ref/v1', publisher_id: binding.publisherId, host_id: binding.hostId,
    root_id: identity.rootId, binding_revision: binding.bindingRevision, scope_digest: binding.scopeDigest,
    epoch: identity.epoch, sequence: identity.sequence, manifest_sha256: identity.manifestSha256, manifest_path: manifestRoute(identity) };
}
function publication(value: unknown): asserts value is PublicationIdentity {
  fields(value, ['epoch', 'sequence', 'manifest_sha256']);
  counter(value.epoch); counter(value.sequence); digest(value.manifest_sha256);
}
export function validateRef(value: unknown, binding: GenerationBinding, previous: GenerationIdentity | null = null): GenerationRef {
  fields(value, ['schema', 'publisher_id', 'host_id', 'root_id', 'binding_revision', 'scope_digest', 'epoch', 'sequence', 'manifest_sha256', 'manifest_path']);
  requireGeneration(value.schema === 'hq-sync.ref/v1', 'unsupported_schema');
  for (const name of ['publisher_id', 'host_id', 'root_id', 'binding_revision']) opaque(value[name]);
  digest(value.scope_digest); counter(value.epoch); counter(value.sequence); digest(value.manifest_sha256);
  requireGeneration(value.publisher_id === binding.publisherId && value.host_id === binding.hostId && value.root_id === binding.rootId
    && value.binding_revision === binding.bindingRevision && value.scope_digest === binding.scopeDigest, 'binding_mismatch');
  const ref = value as unknown as GenerationRef;
  requireGeneration(ref.manifest_path === manifestRoute(identityOf(ref)), 'invalid_manifest_path');
  if (previous) {
    requireGeneration(previous.rootId === ref.root_id, 'binding_mismatch');
    requireGeneration(previous.epoch === ref.epoch, 'epoch_reconciliation_required');
    requireGeneration(BigInt(ref.sequence) >= BigInt(previous.sequence), 'sequence_regression');
    requireGeneration(ref.sequence !== previous.sequence || ref.manifest_sha256 === previous.manifestSha256, 'equal_sequence_digest_mismatch');
  }
  return ref;
}
export function parseRef(bytes: Uint8Array, binding: GenerationBinding, previous: GenerationIdentity | null = null): GenerationRef {
  return validateRef(parseCanonicalJson(bytes, 64 * 1024), binding, previous);
}

export function validateManifest(bytes: Uint8Array, ref: GenerationRef, binding: GenerationBinding): GenerationManifest {
  validateRef(ref, binding);
  requireGeneration(sha256(bytes) === ref.manifest_sha256, 'manifest_digest_mismatch');
  const value = parseCanonicalJson(bytes, GENERATION_LIMITS.manifestBytes);
  fields(value, ['schema', 'publisher_id', 'host_id', 'root_id', 'binding_revision', 'scope_digest', 'epoch', 'sequence',
    'predecessor', 'published_at', 'capture', 'inventory', 'files', 'presentations', 'retention_policy']);
  requireGeneration(value.schema === 'hq-sync.manifest/v1', 'unsupported_schema');
  for (const name of ['publisher_id', 'host_id', 'root_id', 'binding_revision', 'scope_digest', 'epoch', 'sequence'] as const)
    requireGeneration(value[name] === ref[name], 'binding_mismatch');
  requireGeneration(value.retention_policy === 'no-automatic-deletion-v1', 'unsupported_retention');
  instant(value.published_at);
  if (value.predecessor !== null) {
    publication(value.predecessor);
    requireGeneration(value.predecessor.epoch === ref.epoch && BigInt(value.predecessor.sequence) < BigInt(ref.sequence), 'invalid_predecessor');
  }
  const capture = value.capture;
  fields(capture, ['method', 'observation_id', 'started_at', 'finished_at', 'source_generation', 'source_inventory_sha256', 'point_in_time', 'application_completion']);
  requireGeneration(capture.method === binding.consistencyMode, 'capture_mode_mismatch');
  opaque(capture.observation_id); instant(capture.started_at); instant(capture.finished_at);
  requireGeneration(typeof capture.point_in_time === 'boolean', 'invalid_capture');
  if (capture.method === 'observed-files-v1') {
    requireGeneration(capture.point_in_time === false && capture.application_completion === 'not-asserted'
      && capture.source_generation === null && capture.source_inventory_sha256 === null, 'invalid_capture');
  } else {
    opaque(capture.source_generation); digest(capture.source_inventory_sha256);
    requireGeneration(capture.point_in_time === true && capture.application_completion === 'producer-declared-immutable', 'invalid_capture');
  }
  requireGeneration(Array.isArray(value.files) && value.files.length <= GENERATION_LIMITS.files, 'file_count_exceeded');
  const byPath = new Map<string, { size: number }>();
  let total = 0;
  const paths: string[] = [];
  for (const item of value.files) {
    fields(item, ['path', 'size', 'sha256', 'media_type']);
    relativePath(item.path); digest(item.sha256); integer(item.size, GENERATION_LIMITS.fileBytes);
    requireGeneration(typeof item.media_type === 'string' && /^[a-zA-Z0-9.+-]+\/[a-zA-Z0-9.+-]+$/.exec(item.media_type)?.[0] === item.media_type, 'invalid_media_type');
    total += item.size;
    paths.push(item.path); byPath.set(item.path, { size: item.size });
  }
  pathSet(paths);
  requireGeneration(paths.every((path, index) => index === 0 || codePointCompare(paths[index - 1], path) < 0), 'noncanonical_inventory');
  requireGeneration(total <= GENERATION_LIMITS.generationBytes, 'generation_too_large');
  const inventory = value.inventory;
  fields(inventory, ['enumeration', 'file_count', 'total_bytes', 'inventory_sha256']);
  integer(inventory.file_count, GENERATION_LIMITS.files); integer(inventory.total_bytes, GENERATION_LIMITS.generationBytes);
  requireGeneration(inventory.enumeration === 'complete-within-declared-scope' && inventory.file_count === paths.length
    && inventory.total_bytes === total && inventory.inventory_sha256 === sha256(canonicalJson(value.files)), 'inventory_mismatch');
  requireGeneration(Array.isArray(value.presentations), 'invalid_presentations');
  const ids = new Set<string>();
  for (const item of value.presentations) {
    fields(item, ['id', 'kind', 'entry_path', 'preview_path', 'dependency_mode', 'required_paths']);
    opaque(item.id); requireGeneration(!ids.has(item.id), 'duplicate_presentation'); ids.add(item.id);
    requireGeneration(item.kind === 'file' || item.kind === 'static', 'unsupported_presentation');
    requireGeneration(Array.isArray(item.required_paths) && item.required_paths.length > 0, 'missing_dependencies');
    pathSet(item.required_paths);
    const required = item.required_paths as string[];
    requireGeneration(required.every((path, index) => index === 0 || codePointCompare(required[index - 1], path) < 0), 'noncanonical_inventory');
    requireGeneration(required.every(path => byPath.has(path)) && typeof item.entry_path === 'string'
      && required.includes(item.entry_path), 'missing_dependencies');
    if (item.preview_path !== null) {
      requireGeneration(typeof item.preview_path === 'string' && required.includes(item.preview_path)
        && byPath.get(item.preview_path)!.size <= GENERATION_LIMITS.previewBytes, 'preview_ineligible');
    }
    if (item.kind === 'file') {
      requireGeneration(item.dependency_mode === 'independent-file' && required.length === 1 && required[0] === item.entry_path, 'invalid_dependencies');
    } else {
      requireGeneration(item.dependency_mode === 'declared-transitive' || item.dependency_mode === 'entire-eligible-tree', 'invalid_dependencies');
      if (item.dependency_mode === 'entire-eligible-tree')
        requireGeneration(required.length === paths.length && required.every((path, i) => path === paths[i]), 'missing_dependencies');
    }
  }
  return value as unknown as GenerationManifest;
}

export function validateHealth(value: unknown, binding: GenerationBinding, ref: GenerationRef): PublisherHealth {
  fields(value, ['schema', 'publisher_id', 'publisher_instance_id', 'root_id', 'binding_revision', 'scope_digest', 'observation_sequence',
    'last_attempt_at', 'last_success_at', 'last_success_age_ms', 'source_status', 'reason', 'observed_inventory_sha256', 'published', 'pending_change', 'storage_status']);
  requireGeneration(value.schema === 'hq-sync.health/v1', 'unsupported_schema');
  for (const name of ['publisher_id', 'publisher_instance_id', 'root_id', 'binding_revision']) opaque(value[name]);
  digest(value.scope_digest); counter(value.observation_sequence);
  for (const name of ['last_attempt_at', 'last_success_at']) if (value[name] !== null) instant(value[name]);
  if (value.last_success_age_ms !== null) integer(value.last_success_age_ms, Number.MAX_SAFE_INTEGER);
  if (value.observed_inventory_sha256 !== null) digest(value.observed_inventory_sha256);
  if (value.published !== null) publication(value.published);
  requireGeneration(typeof value.source_status === 'string' && ['ok', 'changing', 'missing', 'unreadable', 'limit_exceeded', 'held'].includes(value.source_status), 'invalid_status');
  requireGeneration(typeof value.reason === 'string' && /^[a-z0-9_]{1,128}$/.exec(value.reason)?.[0] === value.reason, 'invalid_reason');
  requireGeneration(typeof value.pending_change === 'boolean' && typeof value.storage_status === 'string' && ['ok', 'storage_full', 'unknown'].includes(value.storage_status), 'invalid_status');
  requireGeneration(value.publisher_id === binding.publisherId && value.root_id === binding.rootId
    && value.binding_revision === binding.bindingRevision && value.scope_digest === binding.scopeDigest, 'binding_mismatch');
  const health = value as unknown as GenerationHealth;
  const published = health.published;
  return { ...health, matchesRef: published !== null && published.epoch === ref.epoch && published.sequence === ref.sequence
    && published.manifest_sha256 === ref.manifest_sha256 };
}
export function parseHealth(bytes: Uint8Array, binding: GenerationBinding, ref: GenerationRef): PublisherHealth {
  return validateHealth(parseCanonicalJson(bytes, 64 * 1024), binding, ref);
}
export function requiredFiles(manifest: GenerationManifest): string[] {
  return [...new Set(manifest.presentations.flatMap(item => item.required_paths))].sort(codePointCompare);
}
