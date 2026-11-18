import type { Digest } from './contract.ts';

/**
 * RFC 8785 JSON Canonicalization Scheme. Section-local until root promotes one
 * shared implementation; golden vectors in test/jcs.test.ts pin behaviour.
 */
export function canonicalize(value: unknown): string {
  return write(value, new Set());
}

function write(value: unknown, seen: Set<object>): string {
  if (value === null) return 'null';
  switch (typeof value) {
    case 'boolean': return value ? 'true' : 'false';
    case 'number':
      if (!Number.isFinite(value)) throw new TypeError('JCS: non-finite number');
      return JSON.stringify(value);
    case 'string': return string(value);
    case 'object': break;
    default: throw new TypeError(`JCS: unsupported ${typeof value}`);
  }
  const object = value as object;
  if (seen.has(object)) throw new TypeError('JCS: cyclic value');
  seen.add(object);
  try {
    if (Array.isArray(object)) return `[${object.map((item) => write(item, seen)).join(',')}]`;
    const prototype = Object.getPrototypeOf(object);
    if (prototype !== Object.prototype && prototype !== null) throw new TypeError('JCS: non-plain object');
    const record = object as Record<string, unknown>;
    // Default string ordering compares UTF-16 code units, as RFC 8785 requires.
    const keys = Object.keys(record).filter((key) => record[key] !== undefined).sort();
    return `{${keys.map((key) => `${string(key)}:${write(record[key], seen)}`).join(',')}}`;
  } finally {
    seen.delete(object);
  }
}

function string(value: string): string {
  // In `u` mode paired surrogates form one code point, so \p{Cs} finds lone ones.
  if (/\p{Cs}/u.test(value)) throw new TypeError('JCS: lone surrogate');
  return JSON.stringify(value);
}

const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });

export function canonicalBytes(value: unknown): Uint8Array {
  return encoder.encode(canonicalize(value));
}

export function decodeJson(bytes: Uint8Array): unknown {
  return JSON.parse(decoder.decode(bytes));
}

export async function sha256(bytes: Uint8Array): Promise<Digest> {
  const hash = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>));
  let hex = '';
  for (const byte of hash) hex += byte.toString(16).padStart(2, '0');
  return `sha256:${hex}` as Digest;
}

export function digestOf(value: unknown): Promise<Digest> {
  return sha256(canonicalBytes(value));
}

export function isDigest(value: unknown): value is Digest {
  return typeof value === 'string' && /^sha256:[0-9a-f]{64}$/u.test(value);
}

export function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let index = 0; index < a.length; index += 1) if (a[index] !== b[index]) return false;
  return true;
}
