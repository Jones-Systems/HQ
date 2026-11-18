import type { DigestPort, JsonValue, Sha256Digest } from './contract.ts';

/**
 * RFC 8785 JSON Canonicalization Scheme. Section-local until the root promotes
 * one shared implementation (spec.hq-design#iface.contracts.001).
 */

export class CanonicalizationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CanonicalizationError';
  }
}

const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u;

function canonicalString(value: string): string {
  if (LONE_SURROGATE.test(value)) throw new CanonicalizationError('String contains a lone surrogate');
  // ES JSON.stringify string escaping matches RFC 8785 section 3.2.2.2.
  return JSON.stringify(value);
}

function isPlainObject(value: object): boolean {
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function write(value: unknown, out: string[], depth: number): void {
  if (depth > 256) throw new CanonicalizationError('Nesting too deep');
  if (value === null) { out.push('null'); return; }
  switch (typeof value) {
    case 'boolean': out.push(value ? 'true' : 'false'); return;
    case 'number':
      if (!Number.isFinite(value)) throw new CanonicalizationError('Non-finite number');
      // ES Number serialization is the RFC 8785 number format; -0 becomes 0.
      out.push(JSON.stringify(value));
      return;
    case 'string': out.push(canonicalString(value)); return;
    case 'object': break;
    default: throw new CanonicalizationError(`Unsupported value type ${typeof value}`);
  }
  if (Array.isArray(value)) {
    out.push('[');
    for (let index = 0; index < value.length; index += 1) {
      if (index > 0) out.push(',');
      if (!(index in value)) throw new CanonicalizationError('Sparse array');
      write(value[index], out, depth + 1);
    }
    out.push(']');
    return;
  }
  const object = value as Record<string, unknown>;
  if (!isPlainObject(object)) throw new CanonicalizationError('Only plain objects are canonicalizable');
  const keys = Object.keys(object).sort();
  out.push('{');
  let first = true;
  for (const key of keys) {
    const item = object[key];
    if (item === undefined) throw new CanonicalizationError(`Undefined value at ${JSON.stringify(key)}`);
    if (!first) out.push(',');
    first = false;
    out.push(canonicalString(key), ':');
    write(item, out, depth + 1);
  }
  out.push('}');
}

export function canonicalize(value: unknown): string {
  const out: string[] = [];
  write(value, out, 0);
  return out.join('');
}

const encoder = new TextEncoder();
export const utf8 = (text: string): Uint8Array => encoder.encode(text);
export const canonicalBytes = (value: unknown): Uint8Array => utf8(canonicalize(value));

/** Default digest adapter: WebCrypto exists in Node 24, browsers and Electron renderers. */
export const webCryptoDigest: DigestPort = {
  async sha256Hex(bytes) {
    const buffer = await globalThis.crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>);
    return Array.from(new Uint8Array(buffer), (byte) => byte.toString(16).padStart(2, '0')).join('');
  },
};

export async function digestBytes(port: DigestPort, bytes: Uint8Array): Promise<Sha256Digest> {
  const hex = await port.sha256Hex(bytes);
  if (!/^[0-9a-f]{64}$/u.test(hex)) throw new CanonicalizationError('Digest port returned a malformed digest');
  return `sha256:${hex}` as Sha256Digest;
}

export const digestJson = (port: DigestPort, value: unknown): Promise<Sha256Digest> => digestBytes(port, canonicalBytes(value));

/** Deep structural copy through JCS; rejects anything not JSON-representable. */
export const cloneJson = <T extends JsonValue>(value: T): T => JSON.parse(canonicalize(value)) as T;

export const jsonEqual = (left: unknown, right: unknown): boolean => canonicalize(left) === canonicalize(right);
