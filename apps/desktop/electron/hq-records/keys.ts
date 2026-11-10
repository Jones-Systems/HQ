import { ContractError } from './canonical.js';

export const PROJECTS_REGISTRY_KEY = 'hq/projects/registry';
export const MAX_ENCODED_NAME = 179;
const SEGMENT = /^[a-z0-9][a-z0-9-]{0,63}$/u;
const LONE_SURROGATE = /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/;

export function isOpaqueSegment(value: unknown): value is string {
  return typeof value === 'string' && SEGMENT.test(value);
}

export function opaqueSegment(value: unknown): string {
  if (!isOpaqueSegment(value)) throw new ContractError('Invalid operation/adoption segment');
  return value;
}

/** Mirrors the store's UTF-8 encoding, but refuses its long-name hash fallback. */
export function encodedStoreName(key: string): string {
  if (typeof key !== 'string' || key.length === 0 || LONE_SURROGATE.test(key)) throw new ContractError('Invalid store key');
  let name = '';
  for (const byte of new TextEncoder().encode(key)) {
    const char = String.fromCharCode(byte);
    name += /^[a-z0-9_-]$/u.test(char) ? char : `~${byte.toString(16).padStart(2, '0')}`;
    if (name.length > MAX_ENCODED_NAME) throw new ContractError('Encoded key exceeds 179 characters');
  }
  return name;
}

function identityKey(kind: 'operations' | 'adoptions', id: unknown): string {
  const key = `hq/projects/${kind}/${opaqueSegment(id)}`;
  encodedStoreName(key);
  return key;
}

export const operationKey = (id: unknown): string => identityKey('operations', id);
export const adoptionKey = (id: unknown): string => identityKey('adoptions', id);

export function isIdentityKey(key: unknown): key is string {
  if (key === PROJECTS_REGISTRY_KEY) return true;
  if (typeof key !== 'string') return false;
  const match = /^hq\/projects\/(?:operations|adoptions)\/(.+)$/u.exec(key);
  return match !== null && isOpaqueSegment(match[1]);
}

function captureKey(kind: 'receipts' | 'operations', id: unknown): string {
  const key = `hq/captures/${kind}/${opaqueSegment(id)}`;
  encodedStoreName(key);
  return key;
}

export const captureReceiptKey = (id: unknown): string => captureKey('receipts', id);
export const captureOperationKey = (id: unknown): string => captureKey('operations', id);

export function captureBindingKey(tupleHex: unknown): string {
  if (typeof tupleHex !== 'string' || !/^[0-9a-f]{64}$/u.test(tupleHex)) throw new ContractError('Invalid capture tuple digest');
  const key = `hq/captures/bindings/${tupleHex}`;
  encodedStoreName(key);
  return key;
}

export function isCaptureKey(key: unknown): key is string {
  if (typeof key !== 'string') return false;
  const id = /^hq\/captures\/(?:receipts|operations)\/(.+)$/u.exec(key);
  return (id !== null && isOpaqueSegment(id[1])) || /^hq\/captures\/bindings\/[0-9a-f]{64}$/u.test(key);
}
