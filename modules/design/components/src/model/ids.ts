import type { Brand } from '../contract.ts';

const MAX_ID = 160;

/** Validates a nonempty, bounded, trimmed identifier without control characters. */
export function brandId<K extends string>(kind: K, value: unknown): Brand<K> {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_ID
    || value.trim() !== value || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw new TypeError(`Invalid ${kind}: expected a nonempty identifier of at most ${MAX_ID} characters.`);
  }
  return value as Brand<K>;
}
