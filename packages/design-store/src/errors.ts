export type StoreErrorCode =
  | 'invalid-argument'
  | 'not-found'
  | 'read-only'
  | 'conflict'
  | 'digest-mismatch'
  | 'integrity'
  | 'too-large'
  | 'stream-unavailable'
  | 'locked'
  | 'migration-failed'
  | 'unsupported-format'
  | 'closed';

/** Every failure crossing the port carries a stable `code` so root IPC can map it without parsing text. */
export class StoreError extends Error {
  readonly code: StoreErrorCode;
  readonly details: Readonly<Record<string, unknown>>;

  constructor(code: StoreErrorCode, message: string, details: Readonly<Record<string, unknown>> = {}, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'StoreError';
    this.code = code;
    this.details = details;
  }
}

export function isStoreError(value: unknown, code?: StoreErrorCode): value is StoreError {
  return value instanceof StoreError && (code === undefined || value.code === code);
}
