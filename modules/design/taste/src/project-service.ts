import {
  GENESIS_HASH, isIdentifier, parseQualifiedSubjectId, qualifySubjectId,
  type AppendResult, type ClientEventId, type Clock, type JournalRecord, type JournalStatus,
  type ProfileExportOptions, type ProjectId, type Sha256Hex, type TasteClientPort, type TasteCommand, type TasteEvent, type TasteScope,
  type TasteSubject,
} from './contract.ts';
import {
  TasteConflictError, TasteInvalidInputError, TasteJournalFaultError, TasteJournalFullError, TasteProjectBindingError, TasteReadOnlyError,
  TasteUnavailableError,
} from './errors.ts';
import { canonicalize } from './jcs.ts';
import { createJournalRecord, verifyJournalBytes, type AppendPrecondition } from './journal.ts';
import { parseExportOptions, parseTasteCommand, TasteService, type TasteJournalPort } from './service.ts';

export {
  TasteConflictError, TasteInvalidInputError, TasteJournalFaultError, TasteJournalFullError, TasteProjectBindingError, TasteReadOnlyError,
  TasteUnavailableError,
};

export const TASTE_DOCUMENT_KEY = 'design/taste/journal.v1';
/**
 * The most bytes of JSON one stored document may hold. This is the desktop host's `DESIGN_VALUE_CAP`. The host
 * answers an oversized put with a bare `invalid`, so a refused put of a well-formed journal over this size is a
 * full journal; the host test pins the two numbers together.
 */
export const MAX_JOURNAL_DOCUMENT_BYTES = 2_000_000;
const SCHEMA = 'hq.design.taste-journal/v1';
/** A document whose schema is a later version of this one: it is read-only here, never "unavailable". */
const SCHEMA_VERSION = /^hq\.design\.taste-journal\/v([1-9][0-9]*)$/u;

export type TasteJournalDocument = {
  readonly schema: typeof SCHEMA;
  readonly jsonl: string;
};

/**
 * Structural subset of WorkspaceDocuments. The composition owner supplies the
 * authoritative workspace view through its typed bridge, never a raw file port.
 * A resolved put must be durable and enforce expectedRevision atomically.
 * Null from get means absent; read failures must reject rather than return null.
 *
 * A put that rejects with proof that nothing was written says so, and the client rethrows it typed: `code`
 * `conflict` (revision changed), `read-only`, `too-large` (the journal is full), `invalid-argument`, `closed`, or a
 * `DesignBridgeError` of kind `read-only`, `invalid` or `unavailable`. A bridge `invalid` for a document over
 * `MAX_JOURNAL_DOCUMENT_BYTES` is also a full journal; any other `invalid` is a refused request. Any other rejection is a lost acknowledgement: the write may
 * have happened, so the append resolves `fail-closed` / `sync-failed` and is reconciled by replaying its event ID.
 */
export interface TasteDocumentPort {
  readonly kind: 'workspace';
  readonly namespace: string;
  getDocument(key: string): Promise<{ readonly revision: number; readonly value: unknown } | null>;
  putDocument(key: string, value: TasteJournalDocument,
    options: { readonly expectedRevision: number | null }): Promise<{ readonly revision: number }>;
}

export interface ProjectTasteOptions {
  readonly documents: TasteDocumentPort;
  readonly projectId: ProjectId;
  readonly sha256: Sha256Hex;
  readonly clock: Clock;
  readonly sampleThreshold?: number;
}

export interface ProjectTasteContribution {
  readonly projectId: ProjectId;
  readonly client: TasteClientPort;
}

const encoder = new TextEncoder();

const isNewerSchema = (value: unknown): boolean => {
  if (typeof value !== 'object' || value === null || Array.isArray(value) || !('schema' in value) || typeof value.schema !== 'string') return false;
  const match = SCHEMA_VERSION.exec(value.schema);
  return match !== null && Number(match[1]) > 1;
};

/** A rejected put that proves nothing was written, as a typed Taste failure; null when the outcome is unknown. */
function definitePutFailure(error: unknown, document: TasteJournalDocument): Error | null {
  if (typeof error !== 'object' || error === null) return null;
  const { code, name, kind } = error as { code?: unknown; name?: unknown; kind?: unknown };
  const bridge = name === 'DesignBridgeError';
  if (code === 'conflict' || name === 'StorageConflictError') return new TasteConflictError();
  if (code === 'read-only' || (bridge && kind === 'read-only')) return new TasteReadOnlyError('store-read-only');
  if (code === 'too-large') return new TasteJournalFullError();
  if (bridge && kind === 'invalid') {
    // The bridge carries no reason for a size refusal. Our document is always well formed, so over the cap is the size.
    return encoder.encode(JSON.stringify(document)).byteLength > MAX_JOURNAL_DOCUMENT_BYTES
      ? new TasteJournalFullError() : new TasteInvalidInputError('The store refused the taste journal. Nothing was saved.');
  }
  if (code === 'invalid-argument') return new TasteInvalidInputError('The store refused the taste journal. Nothing was saved.');
  if (code === 'closed' || (bridge && kind === 'unavailable')) return new TasteUnavailableError();
  return null;
}

/**
 * Version IDs repeat across projects, so a version subject written through a client bound to `project` is stored
 * project-qualified. Returns null when the event names another project's subject.
 */
function bindSubjects(event: TasteEvent, project: ProjectId): TasteEvent | null {
  const namesOther = (id: string | null) => {
    const named = id === null ? null : parseQualifiedSubjectId(id);
    return named !== null && named.projectId !== project;
  };
  switch (event.type) {
    case 'assessment.recorded':
    case 'example.imported': {
      const { subject } = event;
      if (parseQualifiedSubjectId(subject.id) !== null) return namesOther(subject.id) ? null : event;
      if (subject.kind !== 'version') return event;
      return { ...event, subject: { ...subject, id: qualifySubjectId(project, subject.id) } };
    }
    case 'note.added':
    case 'counterevidence.added':
      return namesOther(event.subjectId) ? null : event;
    case 'project-contribution.set':
      return event;
  }
}

/** One operation's verified view; the workspace document is the only persisted journal. */
class DocumentJournal implements TasteJournalPort {
  readonly #options: ProjectTasteOptions;
  readonly #revision: number | null;
  readonly #jsonl: string;
  readonly #records: readonly JournalRecord[];
  readonly status: JournalStatus;

  private constructor(options: ProjectTasteOptions, revision: number | null, jsonl: string,
    records: readonly JournalRecord[], status: JournalStatus) {
    this.#options = options;
    this.#revision = revision;
    this.#jsonl = jsonl;
    this.#records = records;
    this.status = status;
  }

  static async read(options: ProjectTasteOptions): Promise<DocumentJournal> {
    const stored = await options.documents.getDocument(TASTE_DOCUMENT_KEY);
    let jsonl = '';
    if (stored !== null) {
      const value = stored.value;
      if (isNewerSchema(value)) throw new TasteReadOnlyError('unsupported-stored-schema');
      if (!Number.isSafeInteger(stored.revision) || stored.revision < 1
        || typeof value !== 'object' || value === null || Array.isArray(value)
        || Object.keys(value).sort().join(',') !== 'jsonl,schema'
        || !('schema' in value) || value.schema !== SCHEMA
        || !('jsonl' in value) || typeof value.jsonl !== 'string' || !value.jsonl.isWellFormed()) {
        throw new TasteUnavailableError();
      }
      jsonl = value.jsonl;
    }
    const verified = await verifyJournalBytes(encoder.encode(jsonl), options.sha256);
    const last = verified.records.at(-1);
    const head = last ? { seq: last.seq, hash: last.hash } : { seq: 0, hash: GENESIS_HASH };
    const status: JournalStatus = verified.fault
      ? { state: 'fail-closed', ...verified.fault, verifiedRecords: verified.records.length, head }
      : { state: 'open', head };
    return new DocumentJournal(options, stored?.revision ?? null, jsonl, verified.records, status);
  }

  get head() {
    const last = this.#records.at(-1);
    return last ? { seq: last.seq, hash: last.hash } : { seq: 0, hash: GENESIS_HASH };
  }

  records(): readonly JournalRecord[] { return this.#records; }

  async append(id: ClientEventId, payload: TasteEvent, precondition?: AppendPrecondition): Promise<AppendResult> {
    // Even replays stay read-only after corruption; callers can inspect the verified prefix.
    if (this.status.state === 'fail-closed') return { status: 'fail-closed', reason: this.status.reason };
    const existing = this.#records.find((record) => record.clientEventId === id);
    if (existing) return canonicalize(existing.payload) === canonicalize(payload)
      ? { status: 'duplicate', record: existing } : { status: 'conflict', existing };
    const rejection = precondition?.(this.#records);
    if (rejection) return { status: 'rejected', reason: rejection };
    const record = await createJournalRecord(this.head, id, payload, this.#options.clock.now(), this.#options.sha256);
    const document: TasteJournalDocument = { schema: SCHEMA, jsonl: `${this.#jsonl}${canonicalize(record)}\n` };
    try {
      const saved = await this.#options.documents.putDocument(TASTE_DOCUMENT_KEY, document, { expectedRevision: this.#revision });
      if (!Number.isSafeInteger(saved.revision) || saved.revision <= (this.#revision ?? 0)) {
        return { status: 'fail-closed', reason: 'sync-failed' };
      }
    } catch (error) {
      // A rejection that proves nothing was written (a lost compare-and-set, a refusal) is thrown typed.
      const definite = definitePutFailure(error, document);
      if (definite) throw definite;
      // A lost acknowledgement must never overwrite or be retried automatically.
      // Reopening and explicitly replaying the same clientEventId reconciles a durable append.
      return { status: 'fail-closed', reason: 'sync-failed' };
    }
    return { status: 'appended', record };
  }
}

/**
 * Creates an immutable project binding without reading, seeding or writing.
 * General and explicitly promoted profiles share the existing journal semantics.
 * Raw history and commands are restricted to general plus this selected project.
 */
export function createProjectTasteContribution(options: ProjectTasteOptions): ProjectTasteContribution {
  if (!isIdentifier(options.projectId)) throw new TasteProjectBindingError();
  if (options.documents.kind !== 'workspace' || options.documents.namespace !== 'workspace') {
    throw new TasteUnavailableError();
  }
  // Capture caller selection by value: changing a mutable options object cannot rebind this client.
  const bound = { ...options };
  const allows = (scope: TasteScope) => scope.kind === 'general' || scope.projectId === bound.projectId;
  const allowsEvent = (event: TasteEvent) => event.type === 'project-contribution.set'
    ? event.projectId === bound.projectId : allows(event.scope);
  // Entries saved before qualification keep their stored bytes. This client's own project-scope version subjects
  // are shown under the qualified ID so a rating made then is still found, and re-rated, from the same version.
  // General-scope entries from then name no project, so they stay as stored and match no project's version.
  const present = <T extends { readonly scope: TasteScope; readonly subject: TasteSubject }>(item: T): T => (
    item.scope.kind === 'project' && item.subject.kind === 'version' && parseQualifiedSubjectId(item.subject.id) === null
      ? { ...item, subject: { ...item.subject, id: qualifySubjectId(bound.projectId, item.subject.id) } } : item);
  let queue: Promise<unknown> = Promise.resolve();
  const run = <T>(action: (service: TasteService, journal: DocumentJournal) => Promise<T>): Promise<T> => {
    const pending = queue.then(async () => {
      let journal: DocumentJournal;
      try { journal = await DocumentJournal.read(bound); } catch (error) {
        throw error instanceof TasteReadOnlyError ? error : new TasteUnavailableError();
      }
      return action(new TasteService(journal, bound), journal);
    });
    queue = pending.catch(() => undefined);
    return pending;
  };
  const client: TasteClientPort = Object.freeze({
    label: 'Saved on this device',
    async snapshot(projectId: ProjectId | null) {
      if (projectId !== bound.projectId) throw new TasteProjectBindingError();
      return run(async (service) => {
        const snapshot = await service.snapshot(bound.projectId);
        return {
          ...snapshot,
          assessments: snapshot.assessments.filter((item) => allows(item.scope)).map(present),
          notes: snapshot.notes.filter((item) => allows(item.scope)),
          examples: snapshot.examples.filter((item) => allows(item.scope)).map(present),
          contributions: Object.fromEntries(Object.entries(snapshot.contributions).filter(([id]) => id === bound.projectId)),
        };
      });
    },
    async submit(command: TasteCommand): Promise<AppendResult> {
      const parsed = parseTasteCommand(command);
      if (!parsed) return { status: 'rejected', reason: 'invalid-command' };
      const event = allowsEvent(parsed.event) ? bindSubjects(parsed.event, bound.projectId) : null;
      if (!event) return { status: 'rejected', reason: 'project-mismatch' };
      // Detach before queuing so caller mutation cannot change the validated binding or payload.
      const captured = structuredClone({ ...parsed, event });
      return run<AppendResult>(async (service, journal) => {
        const existing = journal.records().find((record) => record.clientEventId === captured.clientEventId);
        if (existing && !allowsEvent(existing.payload)) return { status: 'rejected', reason: 'client-event-id-unavailable' };
        return service.submit(captured);
      });
    },
    async exportProfile(options: ProfileExportOptions) {
      const parsed = parseExportOptions(options);
      if (!parsed) throw new TasteInvalidInputError('Invalid export options');
      if (!allows(parsed.scope)) throw new TasteProjectBindingError();
      const captured = structuredClone(parsed);
      return run(async (service, journal) => {
        if (journal.status.state === 'fail-closed') throw new TasteJournalFaultError(journal.status.reason);
        if (journal.status.state !== 'open') throw new TasteUnavailableError();
        return service.exportProfile(captured);
      });
    },
  });
  return Object.freeze({ projectId: bound.projectId, client });
}
