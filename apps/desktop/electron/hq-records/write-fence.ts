import { contentKey, PROVISIONAL_KEY, validateLegacyContent } from './adoption-classifier.js';
import { decodeRegistry, expectedRevision, projectId } from './projects-registry.js';

/** D2 ordering PLAN. No barrier, schema floor, store, gate or writer is constructed. */
// D3 stays owner-held: cutover needs a compatible current-data recovery reader.
// Reverting a snapshot is not lossless rollback of post-cutover writes.
export const D2_ORDERING_PLAN = Object.freeze([
  'barrier',
  'schema1-reconciliation',
  'facade-visible-preflight-and-diagnostics',
  'recheck-pins',
  'copy-forward-schema2-publish',
  'verify',
  'main-writer-fence',
] as const);

export function canGenericWrite(input: {
  readonly actor: 'main' | 'renderer' | 'import'; readonly key: string; readonly mainWriterFenced: boolean;
}): boolean {
  if (!['main', 'renderer', 'import'].includes(input.actor) || typeof input.key !== 'string'
    || typeof input.mainWriterFenced !== 'boolean') return false;
  if (input.key.startsWith('hq/') || input.key.startsWith('design.projects/content/')) return false;
  return !(input.mainWriterFenced && input.key === PROVISIONAL_KEY);
}

// Legacy viewports admit finite fractions. They are compared, never canonicalized into HQ records.
function sameLegacyValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || a === null || typeof b !== 'object' || b === null) return false;
  if (Array.isArray(a) || Array.isArray(b)) return Array.isArray(a) && Array.isArray(b)
    && a.length === b.length && a.every((value, index) => sameLegacyValue(value, b[index]));
  const left = a as Record<string, unknown>, right = b as Record<string, unknown>;
  const keys = Object.keys(left);
  return keys.length === Object.keys(right).length && keys.every(key => Object.hasOwn(right, key) && sameLegacyValue(left[key], right[key]));
}

/** Opaque creation is planned separately; writing content never enrolls an ID or source. */
export function canWriteContent(input: {
  readonly registry: unknown; readonly projectId: string; readonly key: string;
  readonly expectedRevision: number | null; readonly actualRevision: number | null;
  readonly previous: unknown; readonly next: unknown;
}): boolean {
  try {
    const registry = decodeRegistry(input.registry), id = projectId(input.projectId);
    if (!registry.projects.some(p => p.id === id) || input.key !== contentKey(id)
      || expectedRevision(input.expectedRevision) !== expectedRevision(input.actualRevision)) return false;
    const next = validateLegacyContent(input.next);
    if (next.projectId !== id || input.actualRevision === Number.MAX_SAFE_INTEGER) return false;
    if (input.actualRevision === null) return input.previous === null;
    const previous = validateLegacyContent(input.previous);
    if (previous.projectId !== id) return false;
    const versions = previous.versions as unknown[], nextVersions = next.versions as unknown[];
    if (!versions.every((version, index) => index < nextVersions.length && sameLegacyValue(version, nextVersions[index]))) return false;
    const nextViews = new Set((next.views as Record<string, unknown>[]).map(v => v.id));
    return (previous.views as Record<string, unknown>[]).every(v => nextViews.has(v.id));
  } catch {
    return false;
  }
}
