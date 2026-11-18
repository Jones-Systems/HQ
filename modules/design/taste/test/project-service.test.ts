import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { WorkspaceDocuments } from '../../app/storage/backing.ts';
import {
  assessmentId, clientEventId, counterevidenceId, noteId, projectId,
  type TasteClientPort, type TasteCommand,
} from '../src/contract.ts';
import { nodeSha256 } from '../src/node-file-system.ts';
import {
  createProjectTasteContribution, TASTE_DOCUMENT_KEY, TasteProjectBindingError, TasteUnavailableError,
  type TasteDocumentPort, type TasteJournalDocument,
} from '../src/project-service.ts';
import { aspect, fixedClock, GENERAL, rate, subject } from './helpers.ts';

type Assert<T extends true> = T;
export type WorkspaceDocumentsFitTaste = Assert<WorkspaceDocuments extends TasteDocumentPort ? true : false>;

const A = projectId('synthetic-a');
const B = projectId('synthetic-b');
const scopeA = { kind: 'project' as const, projectId: A };
const scopeB = { kind: 'project' as const, projectId: B };
const item = subject('shared-subject');

/** Synthetic durable-port model: reopening clients retains these canonical document bytes. */
class Documents implements TasteDocumentPort {
  readonly kind = 'workspace';
  readonly namespace = 'workspace';
  value: unknown = null;
  revision = 0;
  reads = 0;
  writes = 0;
  readFails = false;
  writeFault: 'before' | 'after' | null = null;

  async getDocument(key: string) {
    assert.equal(key, TASTE_DOCUMENT_KEY);
    this.reads += 1;
    if (this.readFails) throw new Error('synthetic read failure');
    return this.revision ? { revision: this.revision, value: structuredClone(this.value) } : null;
  }

  async putDocument(key: string, value: TasteJournalDocument, options: { readonly expectedRevision: number | null }) {
    assert.equal(key, TASTE_DOCUMENT_KEY);
    this.writes += 1;
    if (this.writeFault === 'before') throw new Error('synthetic write failure');
    if (options.expectedRevision !== (this.revision || null)) throw new Error('synthetic CAS conflict');
    this.value = structuredClone(value);
    this.revision += 1;
    if (this.writeFault === 'after') throw new Error('synthetic lost acknowledgement');
    return { revision: this.revision };
  }
}

function bind(documents: Documents, id = A) {
  return createProjectTasteContribution({ documents, projectId: id, sha256: nodeSha256, clock: fixedClock() }).client;
}

function promote(id: typeof A, enabled: boolean): TasteCommand {
  return { clientEventId: clientEventId(`promote-${id}-${enabled}`),
    event: { type: 'project-contribution.set', projectId: id, contributesToGeneral: enabled } };
}

async function snapshot(client: TasteClientPort, id = A) { return client.snapshot(id); }

test('construction and navigation do not create records; a missing document is an honest empty state', async () => {
  const documents = new Documents();
  const a = bind(documents);
  const b = bind(documents, B);
  assert.equal(documents.reads, 0);
  assert.equal(documents.writes, 0);
  const empty = await snapshot(a);
  assert.equal(empty.journal.state, 'open');
  assert.deepEqual(empty.assessments, []);
  assert.equal(empty.project?.sample.count, 0);
  assert.equal(empty.general.sample.count, 0);
  await snapshot(b, B);
  await a.exportProfile({ scope: scopeA, includeNotes: true, includeCounterevidence: true });
  assert.equal(documents.writes, 0);
  assert.equal(documents.revision, 0);
});

test('ratings, superseded history, notes, counterevidence and descriptive signals survive adapter reopen', async () => {
  const documents = new Documents();
  const first = bind(documents);
  const original = rate({ scope: scopeA, subject: item, value: 2, assessment: 'original', event: 'original-event' });
  assert.equal((await first.submit(original)).status, 'appended');
  await first.submit(rate({ scope: scopeA, subject: item, value: 5, supersedes: 'original', assessment: 'replacement' }));
  await first.submit(rate({ scope: scopeA, subject: item, value: 1, judgment: 'descriptive', target: aspect('contrast') }));
  await first.submit({ clientEventId: clientEventId('note'), event: { type: 'note.added', noteId: noteId('note-a'),
    scope: scopeA, subjectId: item.id, about: assessmentId('original'), text: 'Synthetic retained explanation' } });
  await first.submit({ clientEventId: clientEventId('counter'), event: { type: 'counterevidence.added',
    counterevidenceId: counterevidenceId('counter-a'), scope: scopeA, subjectId: item.id,
    contradicts: assessmentId('replacement'), judgment: 'liking', target: { kind: 'overall' }, text: 'Synthetic exception' } });
  const before = await snapshot(first);
  const reopened = bind(documents);
  assert.deepEqual(await snapshot(reopened), before);
  assert.equal(before.assessments[0].supersededBy, 'replacement');
  assert.equal(before.project?.summaries.find((entry) => entry.judgment === 'liking')?.mean, 5);
  assert.equal(before.project?.summaries.find((entry) => entry.judgment === 'descriptive')?.mean, 1);
  assert.equal(before.notes.length, 2);
  const exported = await reopened.exportProfile({ scope: scopeA, includeNotes: true, includeCounterevidence: true });
  assert.match(exported.json, /Synthetic retained explanation/);
  assert.match(exported.json, /Synthetic exception/);
  const writes = documents.writes;
  assert.equal((await reopened.submit(original)).status, 'duplicate');
  assert.equal(documents.writes, writes);
});

test('project clients isolate raw history and reject foreign commands, snapshots, exports and id collisions', async () => {
  const documents = new Documents();
  const a = bind(documents);
  const b = bind(documents, B);
  await a.submit(rate({ scope: scopeA, subject: item, value: 5, event: 'a-event', assessment: 'a-rating' }));
  await b.submit(rate({ scope: scopeB, subject: item, value: 1, event: 'b-event' }));
  const fromB = await snapshot(b, B);
  assert.equal(fromB.assessments.length, 1);
  assert.equal(fromB.assessments[0].value, 1);
  assert.equal(fromB.general.sample.count, 0);
  const reads = documents.reads;
  assert.deepEqual(await b.submit(promote(A, true)), { status: 'rejected', reason: 'project-mismatch' });
  assert.deepEqual(await b.submit(rate({ scope: scopeA, subject: item, value: 3 })), { status: 'rejected', reason: 'project-mismatch' });
  await assert.rejects(b.snapshot(A), TasteProjectBindingError);
  await assert.rejects(b.snapshot(null), TasteProjectBindingError);
  await assert.rejects(b.exportProfile({ scope: scopeA, includeNotes: true, includeCounterevidence: true }), TasteProjectBindingError);
  assert.equal(documents.reads, reads);
  assert.deepEqual(await b.submit(rate({ scope: scopeB, subject: item, value: 3, event: 'a-event' })),
    { status: 'rejected', reason: 'client-event-id-unavailable' });
  assert.deepEqual(await b.submit({ clientEventId: clientEventId('cross-note'), event: {
    type: 'note.added', noteId: noteId('cross-note'), scope: scopeB, subjectId: item.id,
    about: assessmentId('a-rating'), text: 'Synthetic cross-project reference' } }),
  { status: 'rejected', reason: 'unknown-assessment' });
});

test('general ratings are shared; project signals enter general profiles only after explicit promotion', async () => {
  const documents = new Documents();
  const a = bind(documents);
  const b = bind(documents, B);
  await a.submit(rate({ scope: GENERAL, subject: subject('general-subject'), value: 3 }));
  await a.submit(rate({ scope: scopeA, subject: item, value: 5 }));
  assert.equal((await snapshot(b, B)).general.sample.count, 1);
  await a.submit(promote(A, true));
  const promoted = await snapshot(b, B);
  assert.equal(promoted.general.sample.count, 2);
  assert.deepEqual(promoted.general.scope, { kind: 'general', includedProjects: [A] });
  assert.equal(promoted.assessments.length, 1); // General history only, even after project promotion.
  assert.deepEqual(promoted.contributions, {});
  assert.equal(promoted.project?.sample.count, 0);
  await a.submit(promote(A, false));
  assert.equal((await snapshot(bind(documents, B), B)).general.sample.count, 1);
});

test('a corrupt journal keeps its verified prefix, refuses writes and exports, and is never repaired', async () => {
  const documents = new Documents();
  await bind(documents).submit(rate({ scope: scopeA, subject: item, value: 4 }));
  documents.value = { ...(documents.value as TasteJournalDocument),
    jsonl: (documents.value as TasteJournalDocument).jsonl + '{interrupted' };
  const corrupted = structuredClone(documents.value);
  const writes = documents.writes;
  const reopened = bind(documents);
  const view = await snapshot(reopened);
  assert.equal(view.journal.state, 'fail-closed');
  assert.equal(view.assessments.length, 1);
  assert.deepEqual(await reopened.submit(rate({ scope: scopeA, subject: subject('another'), value: 1 })),
    { status: 'fail-closed', reason: 'incomplete-tail' });
  await assert.rejects(reopened.exportProfile({ scope: scopeA, includeNotes: false, includeCounterevidence: false }), TasteUnavailableError);
  assert.equal(documents.writes, writes);
  assert.deepEqual(documents.value, corrupted);
});

test('failed reads and malformed documents are unavailable, never empty or overwritten', async () => {
  const documents = new Documents();
  const client = bind(documents);
  documents.readFails = true;
  await assert.rejects(snapshot(client), TasteUnavailableError);
  await assert.rejects(client.submit(rate({ scope: scopeA, subject: item, value: 2 })), TasteUnavailableError);
  documents.readFails = false;
  documents.revision = 1;
  for (const invalid of [null, {}, { schema: 'foreign', jsonl: '' }, { schema: 'hq.design.taste-journal/v1', jsonl: '', extra: true }]) {
    documents.value = invalid;
    await assert.rejects(snapshot(client), TasteUnavailableError);
  }
  assert.equal(documents.writes, 0);
});

test('failed writes are not acknowledged or retried; reopen reconciles a lost acknowledgement by event ID', async () => {
  for (const fault of ['before', 'after'] as const) {
    const documents = new Documents();
    documents.writeFault = fault;
    const command = rate({ scope: scopeA, subject: item, value: 4 });
    assert.deepEqual(await bind(documents).submit(command), { status: 'fail-closed', reason: 'sync-failed' });
    assert.equal(documents.writes, 1);
    documents.writeFault = null;
    const reopened = bind(documents);
    assert.equal((await snapshot(reopened)).assessments.length, fault === 'after' ? 1 : 0);
    assert.equal((await reopened.submit(command)).status, fault === 'after' ? 'duplicate' : 'appended');
    assert.equal((await snapshot(reopened)).assessments.length, 1);
    assert.equal(documents.writes, fault === 'after' ? 1 : 2);
  }
});

test('concurrent reopened adapters use CAS, preserving the winner without losing a journal entry', async () => {
  const documents = new Documents();
  const first = bind(documents);
  const second = bind(documents, B);
  const results = await Promise.all([
    first.submit(rate({ scope: scopeA, subject: item, value: 4 })),
    second.submit(rate({ scope: scopeB, subject: item, value: 2 })),
  ]);
  assert.equal(results.filter((result) => result.status === 'appended').length, 1);
  assert.equal(results.filter((result) => result.status === 'fail-closed').length, 1);
  assert.equal(documents.revision, 1);
  const view = await snapshot(bind(documents));
  assert.equal(view.journal.state, 'open');
  if (view.journal.state === 'open') assert.equal(view.journal.head.seq, 1);
});

test('options and queued command mutation cannot rebind a client', async () => {
  const documents = new Documents();
  const options = { documents, projectId: A, sha256: nodeSha256, clock: fixedClock() };
  const contribution = createProjectTasteContribution(options);
  options.projectId = B;
  const command = rate({ scope: { ...scopeA }, subject: item, value: 4 });
  const pending = contribution.client.submit(command);
  if (command.event.type === 'assessment.recorded' && command.event.scope.kind === 'project') {
    Object.assign(command.event.scope, { projectId: B });
  }
  assert.equal((await pending).status, 'appended');
  assert.equal(contribution.projectId, A);
  assert.equal((await snapshot(contribution.client)).project?.sample.count, 1);
  assert.equal((await snapshot(bind(documents, B), B)).project?.sample.count, 0);
});
