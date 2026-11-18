import { GENESIS_HASH, clientEventId, type ProjectId, type TasteEvent } from '../src/contract.ts';
import { canonicalize } from '../src/jcs.ts';
import { createJournalRecord } from '../src/journal.ts';
import { nodeSha256 } from '../src/node-file-system.ts';
import { createProjectTasteContribution, TASTE_DOCUMENT_KEY, type TasteDocumentPort, type TasteJournalDocument } from '../src/project-service.ts';
import { fixedClock } from './helpers.ts';

export const SCHEMA = 'hq.design.taste-journal/v1';

/** Synthetic durable-port model with revision compare-and-set and injectable typed or untyped write faults. */
export class Documents implements TasteDocumentPort {
  readonly kind = 'workspace';
  readonly namespace = 'workspace';
  value: unknown = null;
  revision = 0;
  reads = 0;
  writes = 0;
  /** Thrown instead of writing; the document stays unchanged. */
  putError: unknown = null;

  async getDocument(key: string) {
    if (key !== TASTE_DOCUMENT_KEY) throw new Error('synthetic wrong key');
    this.reads += 1;
    return this.revision ? { revision: this.revision, value: structuredClone(this.value) } : null;
  }

  async putDocument(key: string, value: TasteJournalDocument, options: { readonly expectedRevision: number | null }) {
    if (key !== TASTE_DOCUMENT_KEY) throw new Error('synthetic wrong key');
    this.writes += 1;
    if (this.putError !== null) throw this.putError;
    if (options.expectedRevision !== (this.revision || null)) throw Object.assign(new Error('synthetic revision conflict'), { code: 'conflict' });
    this.value = structuredClone(value);
    this.revision += 1;
    return { revision: this.revision };
  }
}

export function bind(documents: Documents, project: ProjectId) {
  return createProjectTasteContribution({ documents, projectId: project, sha256: nodeSha256, clock: fixedClock() }).client;
}

/**
 * Stores events exactly as an earlier build did: the same record format with whatever subject IDs the events carry.
 * Used to build journals written before version subjects were project-qualified.
 */
export async function seedJournal(documents: Documents, events: readonly { readonly id: string; readonly event: TasteEvent }[]): Promise<string> {
  const clock = fixedClock(Date.UTC(2026, 8, 1));
  let head = { seq: 0, hash: GENESIS_HASH };
  let jsonl = '';
  for (const { id, event } of events) {
    const record = await createJournalRecord(head, clientEventId(id), event, clock.now(), nodeSha256);
    jsonl += `${canonicalize(record)}\n`;
    head = { seq: record.seq, hash: record.hash };
  }
  documents.value = { schema: SCHEMA, jsonl } satisfies TasteJournalDocument;
  documents.revision = 1;
  return jsonl;
}
