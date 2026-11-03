import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DesignServiceTransport } from '@hq/contracts/services';
import { openDesignStorage } from '../../../modules/design/app/storage/node.ts';
import { createBridgeWorkspaceDocuments, DesignBridgeError } from '../../../modules/design/app/compose/bridge-documents.ts';
import { classifyDesignError, type DesignFailureContext } from '../../../modules/design/app/compose/errors.ts';
import {
  assessmentId, clientEventId, projectId, projectVersionSubject, qualifySubjectId,
  type TasteClientPort, type TasteCommand, type TasteScope,
} from '../../../modules/design/taste/src/contract.ts';
import { nodeSha256 } from '../../../modules/design/taste/src/node-file-system.ts';
import {
  createProjectTasteContribution, TasteConflictError, TasteInvalidInputError, TasteJournalFaultError, TasteProjectBindingError,
  TasteReadOnlyError, TasteUnavailableError, type TasteDocumentPort, type TasteJournalDocument,
} from '../../../modules/design/taste/src/project-service.ts';
import { createDesignHost, TASTE_JOURNAL_KEY } from './design-host';

/**
 * The Taste journal through the real desktop host: a real store in a temporary directory, the renderer's document
 * bridge, and a transport that structured-clones every request and reply like Electron IPC does.
 */

type Host = ReturnType<typeof createDesignHost>;
const A = projectId('project-a');
const B = projectId('project-b');
// Deterministic capture IDs repeat across projects: the same digest names a version in each.
const SHARED = 'capture-0123456789abcdef';
const SAVE: DesignFailureContext = { section: 'taste', operation: 'taste.save', action: 'save to your taste journal', write: true };
const LOAD: DesignFailureContext = { section: 'taste', operation: 'taste.load', action: 'load your taste ratings', write: false };
const EXPORT: DesignFailureContext = { section: 'taste', operation: 'taste.export', action: 'export your taste profile', write: false };
const GENERAL: TasteScope = { kind: 'general' };
const SCHEMA = 'hq.design.taste-journal/v1';

const roots: string[] = [];
const hosts: Host[] = [];
afterEach(async () => {
  for (const host of hosts.splice(0).reverse()) await host.close();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function emptyStoreRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'hq-taste-host-'));
  roots.push(root);
  return root;
}

function ipc(host: Host): DesignServiceTransport {
  return {
    async call(route, params) {
      const result = await host.call(route, structuredClone(params));
      return structuredClone(result) as never;
    },
  };
}

function open(root: string, options: { readonly readOnly?: boolean } = {}) {
  const host = createDesignHost(() => openDesignStorage({ root, ...options }));
  hosts.push(host);
  return { host, documents: createBridgeWorkspaceDocuments(ipc(host)) };
}

function clientFor(documents: TasteDocumentPort, project = A): TasteClientPort {
  let tick = 0;
  return createProjectTasteContribution({
    documents, projectId: project, sha256: nodeSha256, clock: { now: () => new Date(Date.UTC(2026, 10, 3) + tick++ * 1000).toISOString() },
  }).client;
}

function rating(id: string, project: typeof A, scope: TasteScope, value: 1 | 2 | 3 | 4 | 5, supersedes: string | null = null): TasteCommand {
  return {
    clientEventId: clientEventId(`event-${id}`),
    event: {
      type: 'assessment.recorded', assessmentId: assessmentId(id), scope, subject: projectVersionSubject(project, SHARED, 'Synthetic landing v2'),
      judgment: 'liking', target: { kind: 'overall' }, value, supersedes: supersedes === null ? null : assessmentId(supersedes),
    },
  };
}

const stored = async (documents: TasteDocumentPort) => documents.getDocument(TASTE_JOURNAL_KEY);
const jsonlOf = (value: unknown) => (value as TasteJournalDocument).jsonl;
async function failure(promise: Promise<unknown>) {
  try { await promise; } catch (error) { return error; }
  throw new Error('Expected a rejection');
}

describe('Taste journal through the real design host', () => {
  it('survives closing and reopening the host, extends from where it left off, and replays idempotently', async () => {
    const root = await emptyStoreRoot();
    const first = open(root);
    const writer = clientFor(first.documents);
    const general = rating('general-a', A, GENERAL, 5);
    const project = rating('project-a', A, { kind: 'project', projectId: A }, 3);
    expect((await writer.submit(general)).status).toBe('appended');
    expect((await writer.submit(project)).status).toBe('appended');
    const written = await stored(first.documents);
    expect(written).toMatchObject({ revision: 2, value: { schema: SCHEMA } });
    expect(jsonlOf(written?.value).trim().split('\n')).toHaveLength(2);

    await first.host.close();
    // A closed host never answers from memory.
    const afterClose = await failure(writer.snapshot(A));
    expect(afterClose).toBeInstanceOf(TasteUnavailableError);
    expect(classifyDesignError(afterClose, LOAD)).toMatchObject({ kind: 'unavailable', outcome: 'no-effect', recovery: 'retry' });

    const second = open(root);
    const reopened = clientFor(second.documents);
    const view = await reopened.snapshot(A);
    expect(view.journal).toMatchObject({ state: 'open', head: { seq: 2 } });
    expect(view.assessments.map(({ assessmentId: id, scope, subject, value }) => [id, scope.kind, subject.id, value])).toEqual([
      ['general-a', 'general', qualifySubjectId(A, SHARED), 5],
      ['project-a', 'project', qualifySubjectId(A, SHARED), 3],
    ]);
    expect(view.general.sample.count).toBe(1);
    expect(await stored(second.documents)).toEqual(written);

    // An acknowledged command replayed after reopen is a duplicate and writes nothing.
    expect((await reopened.submit(general)).status).toBe('duplicate');
    expect((await stored(second.documents))?.revision).toBe(2);
    // The chain continues from the durable head.
    expect((await reopened.submit(rating('general-a-2', A, GENERAL, 2, 'general-a'))).status).toBe('appended');
    const extended = await stored(second.documents);
    expect(extended?.revision).toBe(3);
    expect(jsonlOf(extended?.value).startsWith(jsonlOf(written?.value))).toBe(true);
    await second.host.close();
    expect((await clientFor(open(root).documents).snapshot(A)).journal).toMatchObject({ state: 'open', head: { seq: 3 } });
  });

  it('keeps two projects’ general ratings of a reused version ID apart across a reopen', async () => {
    const root = await emptyStoreRoot();
    const first = open(root);
    expect((await clientFor(first.documents, A).submit(rating('general-a', A, GENERAL, 5))).status).toBe('appended');
    expect((await clientFor(first.documents, B).submit(rating('general-b', B, GENERAL, 1))).status).toBe('appended');
    await first.host.close();
    const view = await clientFor(open(root).documents, B).snapshot(B);
    expect(view.assessments.map(({ assessmentId: id, subject }) => [id, subject.id])).toEqual([
      ['general-a', qualifySubjectId(A, SHARED)], ['general-b', qualifySubjectId(B, SHARED)],
    ]);
    expect(view.general.sample.count).toBe(2);
    expect(view.general.summaries[0]).toMatchObject({ count: 2, mean: 3 });
  });

  it('rejects a save that lost the revision compare-and-set as a typed conflict and keeps the winner', async () => {
    const root = await emptyStoreRoot();
    const { documents } = open(root);
    // Window B read the empty journal before window A saved.
    const staleRead = await stored(documents);
    expect(staleRead).toBeNull();
    const winner = rating('general-a', A, GENERAL, 5);
    expect((await clientFor(documents, A).submit(winner)).status).toBe('appended');
    const durable = await stored(documents);
    expect(durable?.revision).toBe(1);

    const lagging: TasteDocumentPort = { ...documents, getDocument: async () => staleRead };
    const loser = rating('general-b', B, GENERAL, 1);
    const error = await failure(clientFor(lagging, B).submit(loser));
    expect(error).toBeInstanceOf(TasteConflictError);
    expect(classifyDesignError(error, SAVE)).toMatchObject({ kind: 'conflict', outcome: 'no-effect', recovery: 'reload' });
    expect(await stored(documents)).toEqual(durable);

    // The same refusal at the document bridge, for a create-only write and for a stale numeric revision.
    const createOnly = await failure(documents.putDocument(TASTE_JOURNAL_KEY, { schema: SCHEMA, jsonl: '' }, { expectedRevision: null }));
    expect(classifyDesignError(createOnly, SAVE).kind).toBe('conflict');
    const stale = await failure(documents.putDocument(TASTE_JOURNAL_KEY, { schema: SCHEMA, jsonl: '' }, { expectedRevision: 7 }));
    expect(classifyDesignError(stale, SAVE).kind).toBe('conflict');
    expect(await stored(documents)).toEqual(durable);

    // Nothing was retried for the loser. After reading the new journal, its explicit replay appends once.
    expect((await clientFor(documents, B).submit(loser)).status).toBe('appended');
    expect((await stored(documents))?.revision).toBe(2);
  });

  it('refuses every taste key except the journal, for reads, writes and listing, and creates nothing', async () => {
    const root = await emptyStoreRoot();
    const { host, documents } = open(root);
    for (const key of ['design/taste/other', 'design/taste/journal.v1/x', 'design/taste/journal.v2', 'design/taste/', 'design/taste/journal.v1/../x']) {
      expect(await host.call('doc.get', { key })).toEqual({ ok: false, kind: 'invalid' });
      expect(await host.call('doc.put', { key, value: { schema: SCHEMA, jsonl: '' } })).toEqual({ ok: false, kind: 'invalid' });
      const read = await failure(documents.getDocument(key));
      const write = await failure(documents.putDocument(key, { schema: SCHEMA, jsonl: '' }, { expectedRevision: null }));
      for (const error of [read, write]) {
        expect(error).toBeInstanceOf(DesignBridgeError);
        expect(classifyDesignError(error, SAVE)).toMatchObject({ kind: 'invalid', outcome: 'no-effect' });
      }
    }
    for (const prefix of ['design/taste/', TASTE_JOURNAL_KEY]) {
      expect(await host.call('doc.list', { prefix })).toEqual({ ok: false, kind: 'invalid' });
      expect(classifyDesignError(await failure(documents.listDocuments(prefix)), LOAD).kind).toBe('invalid');
    }
    expect(await host.call('import.commit', { ops: [{ op: 'put-document', namespace: 'workspace', key: TASTE_JOURNAL_KEY, value: {}, expectedRevision: null }] }))
      .toEqual({ ok: false, kind: 'invalid' });
    expect(await stored(documents)).toBeNull();
    expect(await documents.listDocuments('design/projects/')).toEqual([]);
  });

  it('opens a journal saved by a newer schema read-only on every path, and leaves it as stored', async () => {
    const root = await emptyStoreRoot();
    const { documents } = open(root);
    const future = { schema: 'hq.design.taste-journal/v2', jsonl: '', synthetic: 'a field this build does not know' };
    await documents.putDocument(TASTE_JOURNAL_KEY, future, { expectedRevision: null });
    const client = clientFor(documents);
    const readOnly = { kind: 'read-only', outcome: 'no-effect', reason: 'unsupported-stored-schema' };
    for (const [call, context] of [
      [() => client.snapshot(A), LOAD], [() => client.submit(rating('general-a', A, GENERAL, 4)), SAVE],
      [() => client.exportProfile({ scope: GENERAL, includeNotes: false, includeCounterevidence: false }), EXPORT],
    ] as const) {
      const error = await failure(call());
      expect(error).toBeInstanceOf(TasteReadOnlyError);
      expect(classifyDesignError(error, context)).toMatchObject(readOnly);
    }
    expect(await stored(documents)).toMatchObject({ revision: 1, value: future });
  });

  it('opens a read-only store for reading and refuses a save as read-only', async () => {
    const root = await emptyStoreRoot();
    const first = open(root);
    expect((await clientFor(first.documents).submit(rating('general-a', A, GENERAL, 5))).status).toBe('appended');
    const written = await stored(first.documents);
    await first.host.close();

    const readOnly = open(root, { readOnly: true });
    const client = clientFor(readOnly.documents);
    expect((await client.snapshot(A)).journal).toMatchObject({ state: 'open', head: { seq: 1 } });
    const error = await failure(client.submit(rating('general-a-2', A, GENERAL, 2, 'general-a')));
    expect(error).toBeInstanceOf(TasteReadOnlyError);
    expect(classifyDesignError(error, SAVE)).toMatchObject({ kind: 'read-only', outcome: 'no-effect', reason: 'store-read-only' });
    expect(await stored(readOnly.documents)).toEqual(written);
  });

  it('rejects a journal the host refuses as invalid without writing it', async () => {
    const root = await emptyStoreRoot();
    const { documents } = open(root);
    // The host caps one document at 2,000,000 bytes, so a journal that outgrows it is refused whole.
    const oversized: TasteDocumentPort = { ...documents, putDocument: (key, value, options) =>
      documents.putDocument(key, { ...value, padding: 'x'.repeat(2_100_000) } as never, options) };
    const error = await failure(clientFor(oversized).submit(rating('general-a', A, GENERAL, 5)));
    expect(error).toBeInstanceOf(TasteInvalidInputError);
    expect(classifyDesignError(error, SAVE)).toMatchObject({ kind: 'invalid', outcome: 'no-effect' });
    expect(await stored(documents)).toBeNull();
  });

  it('keeps a damaged journal’s verified prefix readable, refuses saves and exports, and repairs nothing', async () => {
    const root = await emptyStoreRoot();
    const { documents } = open(root);
    expect((await clientFor(documents).submit(rating('general-a', A, GENERAL, 5))).status).toBe('appended');
    const good = await stored(documents);
    const damaged = { schema: SCHEMA, jsonl: `${jsonlOf(good?.value)}{interrupted` };
    await documents.putDocument(TASTE_JOURNAL_KEY, damaged, { expectedRevision: good!.revision });

    const client = clientFor(documents);
    const view = await client.snapshot(A);
    expect(view.journal).toMatchObject({ state: 'fail-closed', reason: 'incomplete-tail', verifiedRecords: 1 });
    expect(view.assessments).toHaveLength(1);
    expect(await client.submit(rating('general-a-2', A, GENERAL, 2, 'general-a'))).toEqual({ status: 'fail-closed', reason: 'incomplete-tail' });
    const error = await failure(client.exportProfile({ scope: GENERAL, includeNotes: false, includeCounterevidence: false }));
    expect(error).toBeInstanceOf(TasteJournalFaultError);
    expect(classifyDesignError(error, EXPORT)).toMatchObject({ kind: 'corrupt', outcome: 'no-effect', reason: 'incomplete-tail' });
    expect((await stored(documents))?.value).toEqual(damaged);
  });

  it('refuses a client bound to another project before reading anything', async () => {
    const root = await emptyStoreRoot();
    const { documents } = open(root);
    const error = await failure(clientFor(documents, A).snapshot(B));
    expect(error).toBeInstanceOf(TasteProjectBindingError);
    expect(classifyDesignError(error, LOAD)).toMatchObject({ kind: 'stale', reason: 'project-binding' });
  });
});
