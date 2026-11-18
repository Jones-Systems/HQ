// Result and error model shared by every validator and by WikiService.
// Errors are data: a stable code, a machine-checkable reason and a JSON-path-like location.

export type WikiErrorCode = 'invalid-input' | 'not-found' | 'unavailable' | 'internal';

export const INVALID_INPUT_REASONS = [
  'wrong-type',
  'unknown-property',
  'forbidden-capability',
  'missing-property',
  'out-of-range',
  'too-long',
  'too-large',
  'empty',
  'nul',
  'control-character',
  'lone-surrogate',
  'unknown-namespace',
  'traversal',
  'absolute-path',
  'backslash',
  'drive-form',
  'scheme',
  'empty-segment',
  'invalid-format',
  'duplicate',
  'inconsistent',
  'unknown-node-type',
  'wrong-context',
  'image-not-allowed',
  'html-not-allowed',
  'unsafe-url',
  'too-deep',
  'too-many-nodes',
  'non-canonical',
  'invalid-destination',
] as const;

export const SERVICE_ERROR_REASONS = ['not-found', 'source-unavailable', 'index-unavailable', 'internal'] as const;

export type InvalidInputReason = (typeof INVALID_INPUT_REASONS)[number];
export type ServiceErrorReason = (typeof SERVICE_ERROR_REASONS)[number];
export type WikiErrorReason = InvalidInputReason | ServiceErrorReason;

export interface WikiError {
  readonly code: WikiErrorCode;
  readonly reason: WikiErrorReason;
  readonly message: string;
  /** Location of the offending value, e.g. `$.children[2].target`. Absent for service-level errors. */
  readonly path?: string;
}

export type WikiResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: WikiError };

export function ok<T>(value: T): WikiResult<T> {
  return { ok: true, value };
}

export function invalid(reason: InvalidInputReason, message: string, path: string = '$'): WikiError {
  return { code: 'invalid-input', reason, message, path };
}

export function serviceError(code: Exclude<WikiErrorCode, 'invalid-input'>, reason: ServiceErrorReason, message: string): WikiError {
  return { code, reason, message };
}

export function failWith(error: WikiError): WikiResult<never> {
  return { ok: false, error };
}

/** Lift a `WikiError | null` check into a result that returns the (now validated) input. */
export function resultOf<T>(error: WikiError | null, value: T): WikiResult<T> {
  return error === null ? { ok: true, value } : { ok: false, error };
}
