/** Branded opaque identifiers. Stable IDs never derive from display titles. */

export type Brand<K extends string> = string & { readonly __kind: K };

export type HostId = Brand<'HostId'>;
export type DestinationId = Brand<'DestinationId'>;
export type ReceiverId = Brand<'ReceiverId'>;
export type ThreadRef = Brand<'ThreadRef'>;
export type PacketId = Brand<'PacketId'>;
export type DispatchId = Brand<'DispatchId'>;
export type AttemptId = Brand<'AttemptId'>;
export type ConfirmationId = Brand<'ConfirmationId'>;
export type ReceiptId = Brand<'ReceiptId'>;
export type EvidenceId = Brand<'EvidenceId'>;
export type CandidateId = Brand<'CandidateId'>;
export type VersionId = Brand<'VersionId'>;

export const MAX_ID_LENGTH = 200;

export function isIdText(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= MAX_ID_LENGTH
    && value.trim() === value && !/[\u0000-\u001f\u007f]/u.test(value);
}

/** Validating constructor; throws on an empty, oversized or control-bearing value. */
export function brandId<K extends string>(kind: K, value: string): Brand<K> {
  if (!isIdText(value)) throw new TypeError(`Invalid ${kind}`);
  return value as Brand<K>;
}

export function parseId<K extends string>(_kind: K, value: unknown): Brand<K> | null {
  return isIdText(value) ? (value as Brand<K>) : null;
}
