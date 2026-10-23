import type { BlobDigest, DocumentKey, NamespaceId, StreamId } from './contract.ts';
import { StoreError } from './errors.ts';

const NAMESPACE = /^[a-z][a-z0-9-]{0,31}$/u;
const DIGEST = /^sha256:[0-9a-f]{64}$/u;
const PROJECTION = /^[a-z][a-z0-9-]{0,63}$/u;
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/u;
// Without the `u` flag this matches unpaired surrogate code units.
const LONE_SURROGATE = /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/;
export const MAX_KEY_LENGTH = 256;

export function namespaceId(value: string): NamespaceId {
  if (!NAMESPACE.test(value)) throw invalid('namespace', value);
  return value as NamespaceId;
}

export function documentKey(value: string): DocumentKey {
  return keyLike(value, 'document key') as DocumentKey;
}

export function streamId(value: string): StreamId {
  return keyLike(value, 'stream id') as StreamId;
}

export function blobDigest(value: string): BlobDigest {
  if (!DIGEST.test(value)) throw invalid('blob digest', value);
  return value as BlobDigest;
}

export function isBlobDigest(value: unknown): value is BlobDigest {
  return typeof value === 'string' && DIGEST.test(value);
}

export function assertProjectionName(value: string): void {
  if (!PROJECTION.test(value)) throw invalid('projection name', value);
}

function keyLike(value: string, label: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_KEY_LENGTH
    || CONTROL.test(value) || value.trim() !== value || LONE_SURROGATE.test(value)) {
    throw invalid(label, value);
  }
  return value;
}

function invalid(label: string, value: unknown): StoreError {
  const shown = typeof value === 'string' ? value.slice(0, 80) : typeof value;
  return new StoreError('invalid-argument', `Invalid ${label}: ${JSON.stringify(shown)}`, { label });
}
