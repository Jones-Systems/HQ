import {
  GENESIS_HASH, isIdentifier,
  type AppendResult, type ClientEventId, type Clock, type JournalRecord, type JournalStatus,
  type ProfileExportOptions, type ProjectId, type Sha256Hex, type TasteClientPort, type TasteCommand, type TasteEvent, type TasteScope,
} from './contract.ts';
import { canonicalize } from './jcs.ts';
import { createJournalRecord, verifyJournalBytes, type AppendPrecondition } from './journal.ts';
import { parseExportOptions, parseTasteCommand, TasteService, type TasteJournalPort } from './service.ts';

export const TASTE_DOCUMENT_KEY = 'design/taste/journal.v1';
const SCHEMA = 'hq.design.taste-journal/v1';

export type TasteJournalDocument = {
  readonly schema: typeof SCHEMA;
  readonly jsonl: string;
};

/**
 * Structural subset of WorkspaceDocuments. The composition owner supplies the
 * authoritative workspace view through its typed bridge, never a raw file port.
 * A resolved put must be durable and enforce expectedRevision atomically.
 * Null from get means absent; read failures must reject rather than return null.
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

export class TasteUnavailableError extends Error {
  constructor() {
    super('Taste storage is unavailable.');
    this.name = 'TasteUnavailableError';
  }
}

export class TasteProjectBindingError extends Error {
  constructor() {
    super('Taste client does not belong to the selected project.');
    this.name = 'TasteProjectBindingError';
  }
}

const encoder = new TextEncoder();

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
    try {
      const saved = await this.#options.documents.putDocument(TASTE_DOCUMENT_KEY,
        { schema: SCHEMA, jsonl: `${this.#jsonl}${canonicalize(record)}\n` }, { expectedRevision: this.#revision });
      if (!Number.isSafeInteger(saved.revision) || saved.revision <= (this.#revision ?? 0)) {
        return { status: 'fail-closed', reason: 'sync-failed' };
      }
    } catch {
      // CAS rejection or a lost acknowledgement must never overwrite or be retried automatically.
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
  let queue: Promise<unknown> = Promise.resolve();
  const run = <T>(action: (service: TasteService, journal: DocumentJournal) => Promise<T>): Promise<T> => {
    const pending = queue.then(async () => {
      let journal: DocumentJournal;
      try { journal = await DocumentJournal.read(bound); } catch { throw new TasteUnavailableError(); }
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
          assessments: snapshot.assessments.filter((item) => allows(item.scope)),
          notes: snapshot.notes.filter((item) => allows(item.scope)),
          examples: snapshot.examples.filter((item) => allows(item.scope)),
          contributions: Object.fromEntries(Object.entries(snapshot.contributions).filter(([id]) => id === bound.projectId)),
        };
      });
    },
    async submit(command: TasteCommand): Promise<AppendResult> {
      const parsed = parseTasteCommand(command);
      if (!parsed) return { status: 'rejected', reason: 'invalid-command' };
      if (!allowsEvent(parsed.event)) return { status: 'rejected', reason: 'project-mismatch' };
      // Detach before queuing so caller mutation cannot change the validated binding or payload.
      const captured = structuredClone(parsed);
      return run<AppendResult>(async (service, journal) => {
        const existing = journal.records().find((record) => record.clientEventId === captured.clientEventId);
        if (existing && !allowsEvent(existing.payload)) return { status: 'rejected', reason: 'client-event-id-unavailable' };
        return service.submit(captured);
      });
    },
    async exportProfile(options: ProfileExportOptions) {
      const parsed = parseExportOptions(options);
      if (!parsed) throw new TypeError('Invalid export options');
      if (!allows(parsed.scope)) throw new TasteProjectBindingError();
      const captured = structuredClone(parsed);
      return run(async (service, journal) => {
        if (journal.status.state !== 'open') throw new TasteUnavailableError();
        return service.exportProfile(captured);
      });
    },
  });
  return Object.freeze({ projectId: bound.projectId, client });
}
