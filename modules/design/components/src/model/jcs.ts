import type { Digest, DigestPort } from '../contract.ts';

/**
 * RFC 8785 JSON Canonicalization Scheme. Section-local until root promotes one
 * shared implementation; golden vectors live in tests/jcs.test.ts.
 */
export function canonicalize(value: unknown): string {
  if (value === null) return 'null';
  switch (typeof value) {
    case 'boolean':
      return value ? 'true' : 'false';
    case 'number':
      if (!Number.isFinite(value)) throw new TypeError('JCS rejects non-finite numbers.');
      return JSON.stringify(value);
    case 'string':
      return JSON.stringify(value);
    case 'object':
      break;
    default:
      throw new TypeError(`JCS rejects ${typeof value} values.`);
  }
  if (Array.isArray(value)) return `[${value.map((item) => canonicalize(item)).join(',')}]`;
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) throw new TypeError('JCS accepts only plain objects.');
  const record = value as Record<string, unknown>;
  // Default sort compares UTF-16 code units, as RFC 8785 section 3.2.3 requires.
  const keys = Object.keys(record).sort();
  return `{${keys.map((key) => {
    if (record[key] === undefined) throw new TypeError(`JCS rejects undefined at "${key}".`);
    return `${JSON.stringify(key)}:${canonicalize(record[key])}`;
  }).join(',')}}`;
}

export async function sha256Hex(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const hash = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function jcsDigest(value: unknown): Promise<Digest> {
  return `sha256:${await sha256Hex(canonicalize(value))}` as Digest;
}

/** Section-local WebCrypto digest; works in Node 24 and the renderer. */
export const webCryptoDigest: DigestPort = { digest: jcsDigest };

export function isDigest(value: unknown): value is Digest {
  return typeof value === 'string' && /^sha256:[0-9a-f]{64}$/u.test(value);
}

/** Recursively freezes plain data so stored records cannot be mutated in place. */
export function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const item of Object.values(value as Record<string, unknown>)) deepFreeze(item);
  }
  return value;
}
