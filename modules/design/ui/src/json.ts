import type { JsonValue } from '../contract.ts';

export const MAX_JSON_DEPTH = 32;

export function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/** Plain JSON only: finite numbers, plain objects/arrays, bounded depth. No coercion. */
export function isJsonValue(value: unknown, depth = 0): value is JsonValue {
  if (depth > MAX_JSON_DEPTH) return false;
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.every((item) => isJsonValue(item, depth + 1));
  if (!isPlainRecord(value)) return false;
  return Object.values(value).every((item) => isJsonValue(item, depth + 1));
}

/** UTF-16 length of the serialised value; a cheap, deterministic bound. */
export function jsonSize(value: JsonValue): number {
  return JSON.stringify(value).length;
}

export function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}

/** Bounded identifier: lowercase, digits and hyphens, starting with a letter. */
export function isSectionId(value: unknown): value is string {
  return typeof value === 'string' && /^[a-z][a-z0-9-]{0,63}$/u.test(value);
}
