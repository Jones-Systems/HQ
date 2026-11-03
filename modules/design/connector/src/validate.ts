/** Strict structural validation helpers shared by the connector's persisted formats. */

export function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/** True when every present key is allowed and every required key is present. */
export function hasExactKeys(value: Record<string, unknown>, required: readonly string[], optional: readonly string[] = []): boolean {
  const keys = Object.keys(value);
  return required.every((key) => key in value)
    && keys.every((key) => required.includes(key) || optional.includes(key));
}

export function isText(value: unknown, max = 300): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= max
    && value.trim() === value && !/[\u0000-\u001f\u007f]/u.test(value);
}

export function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

/** ISO-8601 UTC timestamp as produced by Date#toISOString. */
export function isTimestamp(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/u.test(value)
    && !Number.isNaN(Date.parse(value));
}

export function oneOf<T extends string>(options: readonly T[], value: unknown): value is T {
  return typeof value === 'string' && options.some((option) => option === value);
}

/** Recognize a versioned schema name and report whether it is a different (often future) version. */
export function schemaVariance(value: unknown, expected: string): 'match' | 'other-version' | 'invalid' {
  if (value === expected) return 'match';
  const base = expected.slice(0, expected.lastIndexOf('/v') + 2);
  return typeof value === 'string' && value.startsWith(base) && /^\d+$/u.test(value.slice(base.length))
    ? 'other-version'
    : 'invalid';
}
