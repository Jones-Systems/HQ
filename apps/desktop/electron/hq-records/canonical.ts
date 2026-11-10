import { createHash } from 'node:crypto';

export type Digest = `sha256:${string}`;
export type CanonicalValue = null | boolean | string | number | CanonicalValue[]
  | { [key: string]: CanonicalValue };

export class ContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ContractError';
  }
}

function dataProperties(value: object): PropertyDescriptorMap {
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (const key of Reflect.ownKeys(descriptors)) {
    if (typeof key !== 'string') throw new ContractError('Symbol properties are unsupported');
    const descriptor = descriptors[key];
    if (!descriptor || !('value' in descriptor)) throw new ContractError('Accessors are unsupported');
    if (!descriptor.enumerable && !(Array.isArray(value) && key === 'length')) {
      throw new ContractError('Non-enumerable properties are unsupported');
    }
  }
  return descriptors;
}

export function plainRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) {
    throw new ContractError('Expected a plain record');
  }
  dataProperties(value);
  return value as Record<string, unknown>;
}

export function closedRecord(value: unknown, required: readonly string[], optional: readonly string[] = []): Record<string, unknown> {
  const record = plainRecord(value);
  if (required.some(key => !Object.hasOwn(record, key))
    || Object.keys(record).some(key => !required.includes(key) && !optional.includes(key))) {
    throw new ContractError('Missing or unknown record field');
  }
  return record;
}

export function closedArray(value: unknown, maxLength: number): unknown[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length > maxLength) {
    throw new ContractError('Invalid or oversized array');
  }
  const descriptors = dataProperties(value);
  if (Object.keys(descriptors).length !== value.length + 1) throw new ContractError('Sparse or decorated array');
  for (let i = 0; i < value.length; i += 1) {
    if (!Object.hasOwn(descriptors, String(i))) throw new ContractError('Sparse array');
  }
  return value;
}

/** Closed JSON: no getters, sparse arrays, hidden fields, coercion or lossy numbers. */
function encodeCanonical(value: unknown, numberMode: 'integer' | 'finite'): string {
  const ancestors = new Set<object>();
  function encode(item: unknown, depth: number): string {
    if (depth > 128) throw new ContractError('Canonical JSON nesting exceeds 128');
    if (item === null || typeof item === 'boolean' || typeof item === 'string') return JSON.stringify(item);
    if (typeof item === 'number') {
      if (numberMode === 'integer') {
        if (!Number.isSafeInteger(item)) throw new ContractError('Only safe integers are supported');
      } else if (!Number.isFinite(item) || Object.is(item, -0)) {
        throw new ContractError('Only finite numbers other than negative zero are supported');
      }
      return JSON.stringify(item);
    }
    if (typeof item !== 'object') throw new ContractError('Unsupported JSON value');
    if (ancestors.has(item)) throw new ContractError('Cyclic JSON value');
    ancestors.add(item);
    try {
      if (Array.isArray(item)) {
        if (Object.getPrototypeOf(item) !== Array.prototype) throw new ContractError('Array subclasses are unsupported');
        const descriptors = dataProperties(item);
        if (Object.keys(descriptors).length !== item.length + 1) throw new ContractError('Sparse or decorated array');
        const entries: string[] = [];
        for (let i = 0; i < item.length; i += 1) {
          const descriptor = descriptors[String(i)];
          if (!descriptor) throw new ContractError('Sparse array');
          entries.push(encode(descriptor.value, depth + 1));
        }
        return `[${entries.join(',')}]`;
      }
      const record = plainRecord(item);
      return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${encode(record[key], depth + 1)}`).join(',')}}`;
    } finally {
      ancestors.delete(item);
    }
  }
  return encode(value, 0);
}

export function canonicalJson(value: unknown): string {
  return encodeCanonical(value, 'integer');
}

export function canonicalFiniteJson(value: unknown): string {
  return encodeCanonical(value, 'finite');
}

export function canonicalFiniteDigest(value: unknown): Digest {
  return sha256Bytes(canonicalFiniteJson(value));
}

export function canonicalBytes(value: unknown): Uint8Array {
  return new TextEncoder().encode(canonicalJson(value));
}

export function sha256Bytes(bytes: Uint8Array | string): Digest {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

export function canonicalDigest(value: unknown): Digest {
  return sha256Bytes(canonicalBytes(value));
}

export function isDigest(value: unknown): value is Digest {
  return typeof value === 'string' && /^sha256:[0-9a-f]{64}$/u.test(value);
}
