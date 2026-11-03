/**
 * RFC 8785 JSON Canonicalization Scheme plus SHA-256, section-local until T1
 * promotes one shared implementation. Rejects values JCS cannot represent.
 */

export class CanonicalizationError extends Error {
  override readonly name = 'CanonicalizationError';
}

function serializeString(value: string): string {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(i + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) throw new CanonicalizationError('lone surrogate');
      i += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      throw new CanonicalizationError('lone surrogate');
    }
  }
  // JSON.stringify escapes exactly the JCS set for well-formed strings.
  return JSON.stringify(value);
}

export function canonicalize(value: unknown): string {
  if (value === null) return 'null';
  switch (typeof value) {
    case 'boolean': return value ? 'true' : 'false';
    case 'string': return serializeString(value);
    case 'number':
      if (!Number.isFinite(value)) throw new CanonicalizationError('non-finite number');
      // ECMAScript Number serialization is the JCS number format; -0 becomes 0.
      return Object.is(value, -0) ? '0' : String(value);
    case 'object': {
      if (Array.isArray(value)) return `[${value.map((item) => canonicalize(item)).join(',')}]`;
      const proto = Object.getPrototypeOf(value);
      if (proto !== Object.prototype && proto !== null) throw new CanonicalizationError('unsupported object');
      const entries = Object.entries(value as Record<string, unknown>).filter(([, item]) => item !== undefined);
      // Default sort compares UTF-16 code units, as JCS requires.
      entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
      return `{${entries.map(([key, item]) => `${serializeString(key)}:${canonicalize(item)}`).join(',')}}`;
    }
    default: throw new CanonicalizationError(`unsupported ${typeof value}`);
  }
}

const HEX = Array.from({ length: 256 }, (_, i) => i.toString(16).padStart(2, '0'));

export async function sha256Hex(data: Uint8Array | string): Promise<string> {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
  const digest = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>));
  let out = '';
  for (const byte of digest) out += HEX[byte];
  return out;
}

export async function jcsDigest(value: unknown): Promise<string> {
  return sha256Hex(canonicalize(value));
}
