/**
 * RFC 8785 JCS canonical JSON and SHA-256 via Web Crypto (renderer and Node 24).
 * Section-local until root promotes its single shared implementation.
 */

function plain(value: object): boolean {
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

export function canonicalize(value: unknown): string {
  if (value === null || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('JCS rejects non-finite numbers');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  if (typeof value === 'object' && plain(value)) {
    const record = value as Record<string, unknown>;
    // Default sort compares UTF-16 code units, as RFC 8785 requires.
    const keys = Object.keys(record).sort();
    return `{${keys.map((key) => {
      if (record[key] === undefined) throw new TypeError(`JCS rejects undefined at ${key}`);
      return `${JSON.stringify(key)}:${canonicalize(record[key])}`;
    }).join(',')}}`;
  }
  throw new TypeError(`JCS rejects ${typeof value}`);
}

export async function sha256Hex(text: string): Promise<string> {
  const bytes = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function jcsDigest(value: unknown): Promise<string> {
  return `sha256:${await sha256Hex(canonicalize(value))}`;
}
