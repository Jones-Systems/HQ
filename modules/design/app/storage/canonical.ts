/**
 * Pure RFC 8785 (JCS) serializer for the JSON subset the storage adapters carry. It has no
 * runtime dependency, so renderer-safe code can use it. The store's own copy (packages/design-store)
 * is the reference; test/canonical.test.ts compares the two on the same inputs.
 */
export type Json = null | boolean | number | string | readonly Json[] | { readonly [key: string]: Json };

export class CanonicalJsonError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CanonicalJsonError';
  }
}

export function canonicalize(value: unknown): string {
  return write(value, new Set());
}

function write(value: unknown, seen: Set<object>): string {
  if (value === null) return 'null';
  switch (typeof value) {
    case 'boolean': return value ? 'true' : 'false';
    case 'number':
      if (!Number.isFinite(value)) throw new CanonicalJsonError('non-finite number');
      return JSON.stringify(value);
    case 'string': return text(value);
    case 'object': break;
    default: throw new CanonicalJsonError(`unsupported ${typeof value}`);
  }
  const object = value as object;
  if (seen.has(object)) throw new CanonicalJsonError('cyclic value');
  seen.add(object);
  try {
    if (Array.isArray(object)) return `[${object.map((item) => write(item, seen)).join(',')}]`;
    const prototype = Object.getPrototypeOf(object);
    if (prototype !== Object.prototype && prototype !== null) throw new CanonicalJsonError('non-plain object');
    const record = object as Record<string, unknown>;
    const keys = Object.keys(record).filter((key) => record[key] !== undefined).sort();
    return `{${keys.map((key) => `${text(key)}:${write(record[key], seen)}`).join(',')}}`;
  } finally {
    seen.delete(object);
  }
}

function text(value: string): string {
  if (/\p{Cs}/u.test(value)) throw new CanonicalJsonError('lone surrogate');
  return JSON.stringify(value);
}

/** Canonical JSON as plain JSON data (drops `undefined` properties, rejects non-JSON values). */
export function toJson(value: unknown): Json {
  return JSON.parse(canonicalize(value)) as Json;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });

export function canonicalBytes(value: unknown): Uint8Array {
  return encoder.encode(canonicalize(value));
}

export class NonCanonicalBytesError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NonCanonicalBytesError';
  }
}

/**
 * Parses bytes that must already be canonical JSON. Rejecting anything else means a document read
 * back from the store is byte-identical to what the consumer wrote.
 */
export function parseCanonicalBytes(bytes: Uint8Array): Json {
  let source: string;
  let value: Json;
  try {
    source = decoder.decode(bytes);
    value = JSON.parse(source) as Json;
  } catch (error) {
    throw new NonCanonicalBytesError(`bytes are not UTF-8 JSON (${error instanceof Error ? error.message : 'unreadable'})`);
  }
  if (canonicalize(value) !== source) throw new NonCanonicalBytesError('bytes are valid JSON but not RFC 8785 canonical form');
  return value;
}

export function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let index = 0; index < a.length; index += 1) if (a[index] !== b[index]) return false;
  return true;
}
