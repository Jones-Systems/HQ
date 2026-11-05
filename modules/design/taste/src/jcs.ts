/**
 * RFC 8785 JSON Canonicalization Scheme for the taste journal.
 *
 * Section-local until root promotes one shared implementation. Rejects values
 * that are not I-JSON: non-finite numbers, lone surrogates, undefined,
 * functions, symbols, bigint and non-plain objects.
 */

export class CanonicalizationError extends Error {}

function isPlainObject(value: object): boolean {
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function checkString(value: string): string {
  if (!value.isWellFormed()) throw new CanonicalizationError('Lone surrogate');
  return value;
}

/** ECMAScript number and string serialization is exactly what JCS specifies. */
export function canonicalize(value: unknown): string {
  if (value === null) return 'null';
  switch (typeof value) {
    case 'boolean':
      return value ? 'true' : 'false';
    case 'number':
      if (!Number.isFinite(value)) throw new CanonicalizationError('Non-finite number');
      return JSON.stringify(value);
    case 'string':
      return JSON.stringify(checkString(value));
    case 'object': {
      if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
      if (!isPlainObject(value)) throw new CanonicalizationError('Unsupported object');
      const record = value as Record<string, unknown>;
      // Default sort compares UTF-16 code units, as RFC 8785 requires.
      const keys = Object.keys(record).sort();
      return `{${keys.map((key) => `${JSON.stringify(checkString(key))}:${canonicalize(record[key])}`).join(',')}}`;
    }
    default:
      throw new CanonicalizationError(`Unsupported ${typeof value}`);
  }
}

const encoder = new TextEncoder();

export function canonicalBytes(value: unknown): Uint8Array {
  return encoder.encode(canonicalize(value));
}
