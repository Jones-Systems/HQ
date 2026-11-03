/**
 * Taste failures. Each class sets a stable `name`, so the Design composition classifies it
 * (`classifyDesignError`, see app/compose/BACKEND-CONTRACT.md) without importing Taste or parsing messages.
 * Renderer-safe: no Node imports.
 */

/** The journal could not be read or its stored envelope is unusable. Nothing was changed. */
export class TasteUnavailableError extends Error {
  constructor() {
    super('Taste storage is unavailable.');
    this.name = 'TasteUnavailableError';
  }
}

/** The journal verified with a fault, so HQ keeps its verified prefix and refuses the operation. Never repaired. */
export class TasteJournalFaultError extends TasteUnavailableError {
  /** The fail-closed reason, for example `incomplete-tail`. */
  readonly reason: string;
  constructor(reason: string) {
    super();
    this.name = 'TasteJournalFaultError';
    this.message = 'The taste journal has a storage fault, so it is read-only.';
    this.reason = reason;
  }
}

/** A client bound to one project was used for another. Nothing was read or written. */
export class TasteProjectBindingError extends Error {
  constructor() {
    super('Taste client does not belong to the selected project.');
    this.name = 'TasteProjectBindingError';
  }
}

/** The journal changed since it was read (revision compare-and-set failed). Nothing was written. */
export class TasteConflictError extends Error {
  readonly code = 'conflict';
  constructor() {
    super('The taste journal changed since it was read. Nothing was saved.');
    this.name = 'TasteConflictError';
  }
}

/** The stored journal, or the store holding it, is newer than this build understands. It is open read-only. */
export class TasteReadOnlyError extends Error {
  readonly reason: 'unsupported-stored-schema' | 'store-read-only';
  constructor(reason: 'unsupported-stored-schema' | 'store-read-only') {
    super(reason === 'unsupported-stored-schema'
      ? 'The taste journal was saved by a newer version of HQ, so it is read-only.'
      : 'The store is read-only. Nothing was saved.');
    this.name = 'TasteReadOnlyError';
    this.reason = reason;
  }
}

/** The input was refused as invalid. Still a `TypeError`, so existing handlers keep working. */
export class TasteInvalidInputError extends TypeError {
  constructor(message: string) {
    super(message);
    this.name = 'TasteInvalidInputError';
  }
}
