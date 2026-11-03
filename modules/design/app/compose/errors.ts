/**
 * Typed Design failures for toasts and inline indicators (B3 backend contract, stable; see BACKEND-CONTRACT.md).
 *
 * Every Design backend operation the UI calls either resolves or rejects with an error that
 * `classifyDesignError` maps to a `DesignFailure`. The failure says what happened (`kind`), whether durable
 * state may have changed (`outcome`) and what the UI may safely offer (`recovery`). `designFeedback` turns it
 * into the props of the shared `@hq/ui` toast / InlineNotice / StatusIndicator primitives.
 *
 * Renderer-safe: no Node, Electron or section imports beyond the document bridge.
 */
import { DesignBridgeConflictError, DesignBridgeError } from './bridge-documents.ts';

export const DESIGN_FAILURE_KINDS = [
  'conflict', 'invalid', 'read-only', 'unavailable', 'disabled', 'not-found', 'too-large', 'cancelled', 'stale', 'corrupt', 'unknown',
] as const;
export type DesignFailureKind = (typeof DESIGN_FAILURE_KINDS)[number];

/** `unknown-effect` means a write may have happened; only `unknown` failures carry it. */
export type DesignFailureOutcome = 'no-effect' | 'unknown-effect';

/**
 * What the UI may offer. `retry` is offered only when repeating cannot duplicate an effect;
 * an unconfirmed write offers `check` (read back, then decide), never a blind retry.
 */
export type DesignRecovery = 'retry' | 'reload' | 'check' | 'choose-again' | 'none';

export const DESIGN_SECTIONS = [
  'projects', 'gallery', 'captures', 'compare', 'canvas', 'annotations', 'imports', 'taste', 'references', 'components',
  'flows', 'discovery', 'requests', 'runs', 'storage',
] as const;
export type DesignSection = (typeof DESIGN_SECTIONS)[number];

export interface DesignFailure {
  readonly kind: DesignFailureKind;
  readonly outcome: DesignFailureOutcome;
  readonly recovery: DesignRecovery;
  readonly section: DesignSection;
  /** `<section>.<verb>`, for example `projects.create` or `imports.apply`. Stable for tests and telemetry. */
  readonly operation: string;
  /** One short plain sentence for a toast title or inline notice. */
  readonly message: string;
  /** Optional second sentence: what was kept, or what to do next. */
  readonly description?: string;
  /** Machine reason from the backend, for example `disabled` or `capture-timeout`. Show as mono meta. */
  readonly reason?: string;
}

export interface DesignFailureContext {
  readonly section: DesignSection;
  readonly operation: string;
  /** Lowercase imperative phrase used in messages, for example `save the project`. */
  readonly action: string;
  /** True when the operation writes. A transport loss during a write is an unknown effect. */
  readonly write?: boolean;
}

/** A failure that is also an Error, so it can be thrown through existing promise chains. */
export class DesignOperationError extends Error implements DesignFailure {
  readonly kind: DesignFailureKind;
  readonly outcome: DesignFailureOutcome;
  readonly recovery: DesignRecovery;
  readonly section: DesignSection;
  readonly operation: string;
  readonly description?: string;
  readonly reason?: string;
  readonly cause: unknown;
  constructor(failure: DesignFailure, cause?: unknown) {
    super(failure.message);
    this.name = 'DesignOperationError';
    this.kind = failure.kind;
    this.outcome = failure.outcome;
    this.recovery = failure.recovery;
    this.section = failure.section;
    this.operation = failure.operation;
    if (failure.description !== undefined) this.description = failure.description;
    if (failure.reason !== undefined) this.reason = failure.reason;
    this.cause = cause;
  }
  toJSON(): DesignFailure { return designFailureOf(this); }
}

export type DesignResult<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly failure: DesignFailure };

const RECOVERY: Readonly<Record<DesignFailureKind, DesignRecovery>> = {
  conflict: 'reload', invalid: 'none', 'read-only': 'none', unavailable: 'retry', disabled: 'none', 'not-found': 'reload',
  'too-large': 'none', cancelled: 'none', stale: 'choose-again', corrupt: 'none', unknown: 'check',
};

const capitalize = (text: string) => (text.length === 0 ? text : text[0]!.toUpperCase() + text.slice(1));

function describe(kind: DesignFailureKind, action: string): { message: string; description?: string } {
  switch (kind) {
    case 'conflict': return { message: `Couldn't ${action}`, description: 'It changed in another window. Reload to see the latest version, then try again.' };
    case 'invalid': return { message: `Couldn't ${action}`, description: 'HQ refused the request because some details are not valid. Nothing was changed.' };
    case 'read-only': return { message: `Couldn't ${action}`, description: 'This data was saved by a newer version of HQ, so it is open read-only. Nothing was changed.' };
    case 'unavailable': return { message: `Couldn't ${action}`, description: 'Design storage is not available right now. Nothing was changed.' };
    case 'disabled': return { message: `${capitalize(action)} is not available in this build` };
    case 'not-found': return { message: `Couldn't ${action}`, description: 'It no longer exists. Reload to see the current list.' };
    case 'too-large': return { message: `Couldn't ${action}`, description: 'It is larger than HQ can store. Nothing was changed.' };
    case 'cancelled': return { message: `Stopped: ${action}` };
    case 'stale': return { message: `Couldn't ${action}`, description: 'What you selected changed in the meantime. Choose it again.' };
    case 'corrupt': return { message: `Couldn't ${action}`, description: 'The saved data is damaged. HQ did not change or repair it.' };
    case 'unknown': return { message: `${capitalize(action)}: result not confirmed`, description: 'HQ could not confirm whether this finished. Check before trying again.' };
  }
}

/** Builds a failure with the standard outcome, recovery and wording for its kind. */
export function designFailure(kind: DesignFailureKind, context: DesignFailureContext, overrides: { readonly reason?: string; readonly message?: string; readonly description?: string } = {}): DesignFailure {
  const text = describe(kind, context.action);
  const description = overrides.description ?? text.description;
  return {
    kind, outcome: kind === 'unknown' ? 'unknown-effect' : 'no-effect', recovery: RECOVERY[kind],
    section: context.section, operation: context.operation, message: overrides.message ?? text.message,
    ...(description === undefined ? {} : { description }),
    ...(overrides.reason === undefined ? {} : { reason: overrides.reason }),
  };
}

const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;
const named = (error: unknown, ...names: readonly string[]) => record(error) && typeof error.name === 'string' && names.includes(error.name);

export function isDesignFailure(value: unknown): value is DesignFailure {
  return record(value) && typeof value.kind === 'string' && (DESIGN_FAILURE_KINDS as readonly string[]).includes(value.kind)
    && (value.outcome === 'no-effect' || value.outcome === 'unknown-effect') && typeof value.recovery === 'string'
    && typeof value.section === 'string' && (DESIGN_SECTIONS as readonly string[]).includes(value.section)
    && typeof value.operation === 'string' && typeof value.message === 'string';
}

export function designFailureOf(failure: DesignFailure): DesignFailure {
  return {
    kind: failure.kind, outcome: failure.outcome, recovery: failure.recovery, section: failure.section, operation: failure.operation,
    message: failure.message, ...(failure.description === undefined ? {} : { description: failure.description }),
    ...(failure.reason === undefined ? {} : { reason: failure.reason }),
  };
}

/**
 * Maps any rejection from a Design backend call to a typed failure. Known classes are matched by their stable
 * `name`/`kind`/`reason` fields, so this module does not import every section. Anything unrecognised during a
 * write is an unknown effect; during a read it is `unavailable` (nothing was changed by reading).
 */
export function classifyDesignError(error: unknown, context: DesignFailureContext): DesignFailure {
  if (isDesignFailure(error)) return designFailureOf(error);
  const failure = (kind: DesignFailureKind, reason?: string) => designFailure(kind, context, reason === undefined ? {} : { reason });
  if (error instanceof DesignBridgeConflictError) return failure('conflict');
  if (error instanceof DesignBridgeError) {
    if (error.reason === 'disabled') return failure('disabled', 'disabled');
    return failure(error.kind, error.reason);
  }
  if (named(error, 'AbortError') || (record(error) && error.name === 'PreviewError' && error.reason === 'aborted')) return failure('cancelled');
  if (named(error, 'StorageConflictError', 'CanvasWriteConflictError', 'FreezeConflictError', 'ProposalConflictError', 'TasteConflictError')) return failure('conflict');
  if (record(error) && error.code === 'conflict') return failure('conflict');
  if (named(error, 'ReadOnlyContentError', 'ReadOnlyRequestError')) return failure('read-only');
  if (named(error, 'TasteReadOnlyError')) return failure('read-only', record(error) && typeof error.reason === 'string' ? error.reason : undefined);
  if (named(error, 'TasteJournalFaultError')) return failure('corrupt', record(error) && typeof error.reason === 'string' ? error.reason : undefined);
  if (named(error, 'OutcomeUnknownError')) return failure('unknown');
  if (named(error, 'StaleDraftError')) return failure('stale');
  if (named(error, 'TasteProjectBindingError')) return failure('stale', 'project-binding');
  if (named(error, 'TasteUnavailableError', 'SourceUnavailableError')) return failure('unavailable');
  if (record(error) && typeof error.reason === 'string' && (error.reason === 'unsupported-stored-schema')) return failure('read-only', error.reason);
  if (record(error) && typeof error.reason === 'string' && (error.reason === 'corrupt-stored-record')) return failure('corrupt', error.reason);
  if (record(error) && error.name === 'PreviewError' && error.reason === 'too-large') return failure('too-large');
  if (named(error, 'ContentError', 'VersionMutationError', 'InvalidIdError', 'ValidationError', 'SectionStorageScopeError', 'CanvasScopeError',
    'RequestsStorageScopeError', 'DiscoveryCacheScopeError', 'CanonicalJsonError', 'CanonicalizationError', 'NonCanonicalBytesError',
    'TasteInvalidInputError')) return failure('invalid');
  if (named(error, 'UnsupportedSchemaError')) return failure('read-only');
  if (named(error, 'IntegrityError')) return failure(record(error) && error.reason === 'exists' ? 'conflict' : 'corrupt');
  return failure(context.write ? 'unknown' : 'unavailable');
}

/** Rejects with a `DesignOperationError` built from any failure, preserving the original as `cause`. */
export function toDesignOperationError(error: unknown, context: DesignFailureContext): DesignOperationError {
  if (error instanceof DesignOperationError) return error;
  return new DesignOperationError(classifyDesignError(error, context), error);
}

/** Runs a backend call and returns a typed result instead of throwing. */
export async function attemptDesign<T>(run: () => Promise<T>, context: DesignFailureContext): Promise<DesignResult<T>> {
  try { return { ok: true, value: await run() }; }
  catch (error) { return { ok: false, failure: classifyDesignError(error, context) }; }
}

/** Tones of the shared `@hq/ui` feedback primitives (toast, InlineNotice, StatusIndicator). */
export type DesignFeedbackTone = 'danger' | 'unknown' | 'warning' | 'info';
/** Inline indicator state beside the control that failed. */
export type DesignInlineState = 'failed' | 'unknown';

export interface DesignFeedback {
  readonly tone: DesignFeedbackTone;
  readonly title: string;
  readonly description?: string;
  /** Mono provenance line, for example `projects.save · disabled`. */
  readonly meta: string;
  readonly inline: DesignInlineState;
  /** Absent when nothing safe can be offered. The UI supplies the handler. */
  readonly action?: { readonly kind: Exclude<DesignRecovery, 'none'>; readonly label: string };
  /** Persistent failures stay until dismissed; transient notices may auto-dismiss. */
  readonly persistent: boolean;
}

const ACTION_LABEL: Readonly<Record<Exclude<DesignRecovery, 'none'>, string>> = {
  retry: 'Retry', reload: 'Reload', check: 'Check', 'choose-again': 'Choose again',
};

/** Presentation for a failure. Callers keep the current screen and show this as a toast and/or inline notice. */
export function designFeedback(failure: DesignFailure): DesignFeedback {
  const tone: DesignFeedbackTone = failure.kind === 'unknown' ? 'unknown'
    : failure.kind === 'disabled' || failure.kind === 'cancelled' ? 'info'
      : failure.kind === 'read-only' || failure.kind === 'stale' || failure.kind === 'not-found' ? 'warning' : 'danger';
  return {
    tone, title: failure.message, ...(failure.description === undefined ? {} : { description: failure.description }),
    meta: failure.reason === undefined ? failure.operation : `${failure.operation} · ${failure.reason}`,
    inline: failure.outcome === 'unknown-effect' ? 'unknown' : 'failed',
    ...(failure.recovery === 'none' ? {} : { action: { kind: failure.recovery, label: ACTION_LABEL[failure.recovery] } }),
    persistent: tone === 'danger' || tone === 'unknown',
  };
}
