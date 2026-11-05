/** Branded identifiers per spec.hq-design#iface.contracts.001. Stable IDs never derive from display titles. */
export type Id<K extends string> = string & { readonly __kind: K };
export type ProjectId = Id<'ProjectId'>;
export type ViewId = Id<'ViewId'>;
export type VersionId = Id<'VersionId'>;
export type CaptureId = Id<'CaptureId'>;
export type ComparisonId = Id<'ComparisonId'>;
export type PanelId = Id<'PanelId'>;

const MAX_ID_LENGTH = 128;
/**
 * Moving aliases are never identifiers here. A comparison panel binds one exact
 * version; resolving "the newest one" is the caller's explicit choice, not ours.
 */
const MOVING_ALIASES = new Set(['latest', 'head', 'current', 'newest', 'tip']);

function validId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= MAX_ID_LENGTH
    && value.trim() === value && !/[\u0000-\u001f\u007f\s]/u.test(value);
}

function brand<K extends string>() {
  return (value: unknown): Id<K> | null => (validId(value) ? (value as Id<K>) : null);
}

export const parseProjectId = brand<'ProjectId'>();
export const parseViewId = brand<'ViewId'>();
export const parseCaptureId = brand<'CaptureId'>();
export const parseComparisonId = brand<'ComparisonId'>();
export const parsePanelId = brand<'PanelId'>();

export function parseVersionId(value: unknown): VersionId | null {
  if (!validId(value) || MOVING_ALIASES.has(value.toLowerCase())) return null;
  return value as VersionId;
}

/** Throwing variants for fixtures and trusted call sites. */
export function versionId(value: string): VersionId {
  const id = parseVersionId(value);
  if (id === null) throw new TypeError(`Invalid VersionId: ${JSON.stringify(value)}`);
  return id;
}

function must<K extends string>(parse: (value: unknown) => Id<K> | null, kind: K) {
  return (value: string): Id<K> => {
    const id = parse(value);
    if (id === null) throw new TypeError(`Invalid ${kind}: ${JSON.stringify(value)}`);
    return id;
  };
}

export const projectId = must(parseProjectId, 'ProjectId');
export const viewId = must(parseViewId, 'ViewId');
export const captureId = must(parseCaptureId, 'CaptureId');
export const comparisonId = must(parseComparisonId, 'ComparisonId');
export const panelId = must(parsePanelId, 'PanelId');
