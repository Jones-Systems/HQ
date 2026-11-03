// Small dependency-free checking helpers. Internal: not re-exported from index.ts.

import { invalid, type WikiError } from './result.ts';

export function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

const CONTROL = /[\u0000-\u001f\u007f-\u009f]/;
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

export function hasControlChar(text: string): boolean {
  return CONTROL.test(text);
}

export function hasLoneSurrogate(text: string): boolean {
  return LONE_SURROGATE.test(text);
}

export function codePointLength(text: string): number {
  return Array.from(text).length;
}

/** UTF-8 length in bytes; a lone surrogate counts as U+FFFD (3 bytes), matching TextEncoder. */
export function utf8ByteLength(text: string): number {
  let bytes = 0;
  for (let i = 0; i < text.length; i++) {
    const unit = text.charCodeAt(i);
    if (unit < 0x80) bytes += 1;
    else if (unit < 0x800) bytes += 2;
    else if (unit >= 0xd800 && unit <= 0xdbff && i + 1 < text.length) {
      const next = text.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4;
        i++;
      } else bytes += 3;
    } else bytes += 3;
  }
  return bytes;
}

const ISO_UTC = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?Z$/;

/** Strict `YYYY-MM-DDTHH:mm:ss[.fff]Z` that names a real calendar instant. */
export function isIsoUtcTimestamp(text: string): boolean {
  const m = ISO_UTC.exec(text);
  if (m === null) return false;
  const [y, mo, d, h, mi, s] = [1, 2, 3, 4, 5, 6].map((i) => Number(m[i]));
  const date = new Date(Date.UTC(y as number, (mo as number) - 1, d as number, h as number, mi as number, s as number));
  return (
    date.getUTCFullYear() === y &&
    date.getUTCMonth() === (mo as number) - 1 &&
    date.getUTCDate() === d &&
    date.getUTCHours() === h &&
    date.getUTCMinutes() === mi &&
    date.getUTCSeconds() === s
  );
}

/** Text that is stored and shown verbatim (never interpreted): no NUL, no lone surrogates. */
export function checkInertText(value: unknown, path: string, maxLength: number): WikiError | null {
  if (typeof value !== 'string') return invalid('wrong-type', 'expected a string', path);
  if (value.length > maxLength) return invalid('too-long', `text exceeds ${maxLength} characters`, path);
  if (value.includes('\u0000')) return invalid('nul', 'text contains NUL', path);
  if (hasLoneSurrogate(value)) return invalid('lone-surrogate', 'text contains a lone surrogate', path);
  return null;
}

/** Single-line display text: non-empty, no control characters, bounded. */
export function checkLabel(value: unknown, path: string, maxLength: number): WikiError | null {
  if (typeof value !== 'string') return invalid('wrong-type', 'expected a string', path);
  if (value.length === 0) return invalid('empty', 'value is empty', path);
  if (value.length > maxLength) return invalid('too-long', `value exceeds ${maxLength} characters`, path);
  if (value.includes('\u0000')) return invalid('nul', 'value contains NUL', path);
  if (hasControlChar(value)) return invalid('control-character', 'value contains a control character', path);
  if (hasLoneSurrogate(value)) return invalid('lone-surrogate', 'value contains a lone surrogate', path);
  return null;
}

export function checkInteger(value: unknown, path: string, min: number, max: number): WikiError | null {
  if (typeof value !== 'number' || !Number.isInteger(value)) return invalid('wrong-type', 'expected an integer', path);
  if (value < min || value > max) return invalid('out-of-range', `integer must be within ${min}..${max}`, path);
  return null;
}

/**
 * Closed-object check: every key must be allowed, every required key present.
 * Keys that would hand the renderer a filesystem/ref/URL/argv capability get their own reason.
 */
export function checkKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  required: readonly string[],
  path: string,
  forbidden: readonly string[] = [],
): WikiError | null {
  const keys = Object.keys(value);
  for (const key of keys) {
    if (forbidden.includes(key.toLowerCase())) {
      return invalid('forbidden-capability', `property "${key}" would supply a root, ref, URL, path or argv`, `${path}.${key}`);
    }
  }
  for (const key of keys) {
    if (!allowed.includes(key)) return invalid('unknown-property', `unknown property "${key}"`, `${path}.${key}`);
  }
  for (const key of required) {
    if (!(key in value)) return invalid('missing-property', `missing property "${key}"`, `${path}.${key}`);
  }
  return null;
}
