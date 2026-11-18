import { createHash } from 'node:crypto';
import { record } from '../../services.js';
import { GenerationError, requireGeneration } from './types.js';

export function codePointCompare(left: string, right: string): number {
  const a = Array.from(left), b = Array.from(right);
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    const delta = a[i].codePointAt(0)! - b[i].codePointAt(0)!;
    if (delta) return delta;
  }
  return a.length - b.length;
}
export function wellFormed(value: string): boolean {
  return !Array.from(value).some(char => { const cp = char.codePointAt(0)!; return cp >= 0xd800 && cp <= 0xdfff; });
}

function encode(value: unknown, depth: number, seen: Set<object>): string {
  requireGeneration(depth <= 48, 'document_too_deep');
  if (value === null || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'string') {
    requireGeneration(wellFormed(value), 'invalid_encoding');
    return JSON.stringify(value);
  }
  if (typeof value === 'number') {
    requireGeneration(Number.isInteger(value), 'invalid_json');
    requireGeneration(Number.isSafeInteger(value), 'unsupported_integer');
    requireGeneration(!Object.is(value, -0), 'invalid_json');
    return String(value);
  }
  requireGeneration(Array.isArray(value) || record(value), 'invalid_json');
  requireGeneration(!seen.has(value), 'invalid_json');
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      requireGeneration(Object.keys(value).length === value.length, 'invalid_json');
      return '[' + Array.from(value, item => encode(item, depth + 1, seen)).join(',') + ']';
    }
    return '{' + Object.keys(value).sort(codePointCompare).map(key => {
      requireGeneration(wellFormed(key), 'invalid_encoding');
      return JSON.stringify(key) + ':' + encode(value[key], depth + 1, seen);
    }).join(',') + '}';
  } finally { seen.delete(value); }
}
export function canonicalJson(value: unknown): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(encode(value, 0, new Set()));
}
export function sha256(bytes: Uint8Array): string { return createHash('sha256').update(bytes).digest('hex'); }
export function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  return a.byteLength === b.byteLength && a.every((value, i) => value === b[i]);
}
export function parseCanonicalJson(bytes: Uint8Array, maximum = 8 * 1024 * 1024): unknown {
  requireGeneration(bytes.byteLength <= maximum, 'document_too_large');
  let value: unknown;
  try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes)); }
  catch { throw new GenerationError('invalid_json'); }
  requireGeneration(equalBytes(canonicalJson(value), bytes), 'invalid_json');
  return value;
}
