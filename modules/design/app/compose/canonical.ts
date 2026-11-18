/**
 * Canonical JSON for composition (RFC 8785 JCS, SHA-256 over WebCrypto, so it runs in the renderer and
 * Node 24). Composition only needs it to compare and fingerprint records it forwards between lanes; every
 * lane keeps its own digest rules. `test/jcs-conformance.test.ts` pins this file against the lanes'
 * implementations and the store's, and records where they deliberately differ.
 *
 * Two digest kinds exist and must never be confused:
 * - an AUTHORING digest fingerprints a record as a Design lane authors it (JCS of that record);
 * - a WIRE digest fingerprints the frozen packet bytes a connector verifies (held with the T6 -> T12
 *   adapter; composition constructs none).
 */

export type AuthoringDigest = `sha256:${string}` & { readonly __digest: 'authoring' };
export type WireDigest = `sha256:${string}` & { readonly __digest: 'wire' };

const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u;

export class CanonicalJsonError extends TypeError {
  constructor(message: string) {
    super(message);
    this.name = 'CanonicalJsonError';
  }
}

/** RFC 8785 serialization of plain JSON data. Rejects non-finite numbers, undefined, lone surrogates and non-plain objects. */
export function canonicalize(value: unknown): string {
  return serialize(value, new Set());
}

function serialize(value: unknown, stack: Set<object>): string {
  if (value === null) return 'null';
  switch (typeof value) {
    case 'boolean': return value ? 'true' : 'false';
    case 'number':
      if (!Number.isFinite(value)) throw new CanonicalJsonError('canonical JSON rejects non-finite numbers');
      // ECMAScript Number serialization is the RFC 8785 number form; -0 serializes as 0.
      return JSON.stringify(value);
    case 'string':
      if (LONE_SURROGATE.test(value)) throw new CanonicalJsonError('canonical JSON rejects lone surrogates');
      return JSON.stringify(value);
    case 'object': break;
    default: throw new CanonicalJsonError(`canonical JSON rejects ${typeof value}`);
  }
  const object = value as object;
  if (stack.has(object)) throw new CanonicalJsonError('canonical JSON rejects cycles');
  stack.add(object);
  try {
    if (Array.isArray(object)) {
      const items: string[] = [];
      for (let index = 0; index < object.length; index += 1) {
        if (!(index in object)) throw new CanonicalJsonError('canonical JSON rejects sparse arrays');
        items.push(serialize(object[index], stack));
      }
      return `[${items.join(',')}]`;
    }
    const prototype = Object.getPrototypeOf(object);
    if (prototype !== Object.prototype && prototype !== null) throw new CanonicalJsonError('canonical JSON accepts plain objects only');
    const record = object as Record<string, unknown>;
    // Default sort compares UTF-16 code units, which is the RFC 8785 property order.
    const members = Object.keys(record).sort().map((key) => {
      if (LONE_SURROGATE.test(key)) throw new CanonicalJsonError('canonical JSON rejects lone surrogates in keys');
      if (record[key] === undefined) throw new CanonicalJsonError(`canonical JSON rejects undefined at "${key}"`);
      return `${JSON.stringify(key)}:${serialize(record[key], stack)}`;
    });
    return `{${members.join(',')}}`;
  } finally {
    stack.delete(object);
  }
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** Authoring digest: `sha256:` + hex of the UTF-8 bytes of the record's canonical JSON. */
export async function authoringDigest(value: unknown): Promise<AuthoringDigest> {
  return `sha256:${await sha256Hex(new TextEncoder().encode(canonicalize(value)))}` as AuthoringDigest;
}

/** Equality of two records by canonical form (key order and number spelling do not matter). */
export function sameCanonical(a: unknown, b: unknown): boolean {
  try { return canonicalize(a) === canonicalize(b); } catch { return false; }
}
