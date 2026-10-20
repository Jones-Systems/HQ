/**
 * RFC 8785 JSON Canonicalization Scheme and SHA-256 over WebCrypto (available in Node 24 and the
 * Electron renderer). Section-local until root promotes one shared implementation.
 */

const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u;

export function canonicalize(value: unknown): string {
  if (value === null) return 'null';
  switch (typeof value) {
    case 'boolean':
      return value ? 'true' : 'false';
    case 'number':
      if (!Number.isFinite(value)) throw new TypeError('JCS rejects non-finite numbers');
      // ECMAScript Number serialization is the RFC 8785 number form; -0 serializes as 0.
      return JSON.stringify(value);
    case 'string':
      if (LONE_SURROGATE.test(value)) throw new TypeError('JCS rejects lone surrogates');
      return JSON.stringify(value);
    case 'object': {
      if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
      const prototype = Object.getPrototypeOf(value);
      if (prototype !== Object.prototype && prototype !== null) throw new TypeError('JCS accepts plain objects only');
      const record = value as Record<string, unknown>;
      // Default sort compares UTF-16 code units, which is the RFC 8785 property order.
      const keys = Object.keys(record).filter((key) => record[key] !== undefined).sort();
      return `{${keys.map((key) => `${canonicalize(key)}:${canonicalize(record[key])}`).join(',')}}`;
    }
    default:
      throw new TypeError(`JCS rejects ${typeof value}`);
  }
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function utf8(text: string): Uint8Array { return new TextEncoder().encode(text); }

export async function jcsSha256Hex(value: unknown): Promise<string> {
  return sha256Hex(utf8(canonicalize(value)));
}
