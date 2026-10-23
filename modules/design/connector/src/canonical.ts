/**
 * RFC 8785 (JCS) canonical JSON and SHA-256 digests for connector records.
 *
 * Section-local until root promotes one shared implementation; the golden
 * vectors in canonical.test.ts are the conformance evidence to compare against.
 * Uses WebCrypto so the same code runs in Node and in a sandboxed renderer.
 */

export type Digest = `sha256:${string}`;

const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/u;

export function isDigest(value: unknown): value is Digest {
  return typeof value === 'string' && DIGEST_PATTERN.test(value);
}

export class CanonicalJsonError extends Error {
  override readonly name = 'CanonicalJsonError';
}

function isPlainObject(value: object): boolean {
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function serialize(value: unknown, path: string, seen: Set<object>): string {
  if (value === null) return 'null';
  switch (typeof value) {
    case 'boolean':
      return value ? 'true' : 'false';
    case 'string':
      // JSON.stringify emits the JCS string form: minimal escapes, lowercase \u00xx.
      return JSON.stringify(value);
    case 'number':
      if (!Number.isFinite(value)) throw new CanonicalJsonError(`Non-finite number at ${path}`);
      // ECMAScript Number serialization is the JCS number form; -0 becomes 0.
      return JSON.stringify(value);
    case 'object': {
      if (seen.has(value)) throw new CanonicalJsonError(`Cycle at ${path}`);
      seen.add(value);
      let out: string;
      if (Array.isArray(value)) {
        out = `[${value.map((item, index) => serialize(item, `${path}[${index}]`, seen)).join(',')}]`;
      } else if (isPlainObject(value)) {
        const record = value as Record<string, unknown>;
        // Default sort compares UTF-16 code units, which is the JCS key order.
        const keys = Object.keys(record).sort();
        out = `{${keys.map((key) => {
          const item = record[key];
          if (item === undefined) throw new CanonicalJsonError(`Undefined value at ${path}.${key}`);
          return `${JSON.stringify(key)}:${serialize(item, `${path}.${key}`, seen)}`;
        }).join(',')}}`;
      } else {
        throw new CanonicalJsonError(`Unsupported object at ${path}`);
      }
      seen.delete(value);
      return out;
    }
    default:
      throw new CanonicalJsonError(`Unsupported ${typeof value} at ${path}`);
  }
}

/** Serialize a JSON value in JCS form; rejects anything JSON cannot represent exactly. */
export function canonicalJson(value: unknown): string {
  return serialize(value, '$', new Set());
}

export async function sha256Hex(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const hash = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function digestOf(value: unknown): Promise<Digest> {
  return `sha256:${await sha256Hex(canonicalJson(value))}`;
}
