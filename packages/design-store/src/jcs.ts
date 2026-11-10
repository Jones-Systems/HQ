import { createHash } from 'node:crypto';
import type { BlobDigest, JsonValue } from './contract.ts';
import { StoreError } from './errors.ts';

/**
 * RFC 8785 JSON Canonicalization Scheme. Section-local until root promotes one shared
 * implementation; golden vectors in test/jcs.test.ts pin the behaviour.
 */
export function canonicalize(value: unknown): string {
  return serialize(value, new Set(), '$');
}

function serialize(value: unknown, stack: Set<object>, path: string): string {
  if (value === null) return 'null';
  switch (typeof value) {
    case 'boolean':
      return value ? 'true' : 'false';
    case 'number':
      if (!Number.isFinite(value)) throw reject(path, 'non-finite number');
      // ECMAScript Number serialization is the RFC 8785 number form; -0 serializes as 0.
      return Object.is(value, -0) ? '0' : String(value);
    case 'string':
      assertWellFormed(value, path);
      return JSON.stringify(value);
    case 'object':
      break;
    default:
      throw reject(path, `unsupported ${typeof value}`);
  }
  const object = value as object;
  if (stack.has(object)) throw reject(path, 'cycle');
  stack.add(object);
  try {
    if (Array.isArray(object)) {
      const items: string[] = [];
      for (let index = 0; index < object.length; index += 1) {
        if (!(index in object)) throw reject(`${path}[${index}]`, 'sparse array');
        items.push(serialize(object[index], stack, `${path}[${index}]`));
      }
      return `[${items.join(',')}]`;
    }
    const proto = Object.getPrototypeOf(object);
    if (proto !== Object.prototype && proto !== null) throw reject(path, 'non-plain object');
    // Default sort compares UTF-16 code units, which is the RFC 8785 property order.
    const keys = Object.keys(object).sort();
    const members: string[] = [];
    for (const key of keys) {
      assertWellFormed(key, `${path}.<key>`);
      const member = (object as Record<string, unknown>)[key];
      if (member === undefined) throw reject(`${path}.${key}`, 'undefined member');
      members.push(`${JSON.stringify(key)}:${serialize(member, stack, `${path}.${key}`)}`);
    }
    return `{${members.join(',')}}`;
  } finally {
    stack.delete(object);
  }
}

function assertWellFormed(text: string, path: string): void {
  for (let index = 0; index < text.length; index += 1) {
    const unit = text.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = text.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) throw reject(path, 'lone surrogate');
      index += 1;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      throw reject(path, 'lone surrogate');
    }
  }
}

function reject(path: string, reason: string): StoreError {
  return new StoreError('invalid-argument', `Value is not canonical JSON at ${path}: ${reason}`, { path, reason });
}

const encoder = new TextEncoder();

export function canonicalBytes(value: unknown): Uint8Array {
  return encoder.encode(canonicalize(value));
}

export function sha256Hex(bytes: Uint8Array | string): string {
  return createHash('sha256').update(bytes).digest('hex');
}

export function digestOfBytes(bytes: Uint8Array): BlobDigest {
  return `sha256:${sha256Hex(bytes)}` as BlobDigest;
}

/** Authoring digest of a JSON value: SHA-256 over its RFC 8785 canonical bytes. */
export function digestOfJson(value: JsonValue): BlobDigest {
  return digestOfBytes(canonicalBytes(value));
}

/** Validates that a value is canonical-JSON representable and returns a detached copy. */
export function cloneJson<T extends JsonValue>(value: T): T {
  return JSON.parse(canonicalize(value)) as T;
}
