import assert from 'node:assert/strict';
import { test } from 'node:test';
import { projectId } from '../src/contract.ts';
import {
  TasteConflictError, TasteInvalidInputError, TasteJournalFaultError, TasteProjectBindingError, TasteReadOnlyError, TasteUnavailableError,
  type TasteJournalDocument,
} from '../src/project-service.ts';
import { SCHEMA, Documents, bind } from './document-port.ts';
import { PROJECT_A, rate, subject } from './helpers.ts';

const A = projectId('project-a');
const B = projectId('project-b');
const item = subject('synthetic-version');
const exportAll = { scope: { kind: 'general' as const }, includeNotes: true, includeCounterevidence: true };

const bridgeError = (kind: string) => Object.assign(new Error(`Design storage bridge: ${kind}`), { name: 'DesignBridgeError', kind });

test('every error has a stable name, because the composition classifies by name and never by message', () => {
  assert.deepEqual([
    new TasteUnavailableError(), new TasteProjectBindingError(), new TasteConflictError(), new TasteReadOnlyError('unsupported-stored-schema'),
    new TasteInvalidInputError('x'), new TasteJournalFaultError('incomplete-tail'),
  ].map((error) => error.name), [
    'TasteUnavailableError', 'TasteProjectBindingError', 'TasteConflictError', 'TasteReadOnlyError', 'TasteInvalidInputError', 'TasteJournalFaultError',
  ]);
  assert.equal(new TasteConflictError().code, 'conflict');
  assert.equal(new TasteReadOnlyError('store-read-only').reason, 'store-read-only');
  assert.equal(new TasteJournalFaultError('hash-mismatch').reason, 'hash-mismatch');
  assert.ok(new TasteJournalFaultError('hash-mismatch') instanceof TasteUnavailableError);
  assert.ok(new TasteInvalidInputError('x') instanceof TypeError);
});

test('a save that loses the revision compare-and-set rejects as a conflict and never overwrites the winner', async () => {
  const documents = new Documents();
  const winning = rate({ scope: PROJECT_A, subject: item, value: 4 });
  const losing = rate({ scope: { kind: 'project', projectId: B }, subject: item, value: 2 });
  // Both clients read the empty journal before either writes, so the second put carries a stale revision.
  const [first, second] = await Promise.allSettled([bind(documents, A).submit(winning), bind(documents, B).submit(losing)]);
  assert.deepEqual(first.status === 'fulfilled' ? first.value.status : first.reason, 'appended');
  assert.equal(second.status, 'rejected');
  assert.ok(second.status === 'rejected' && second.reason instanceof TasteConflictError);
  assert.equal(second.status === 'rejected' && (second.reason as TasteConflictError).code, 'conflict');
  assert.equal(documents.revision, 1);
  const stored = (documents.value as TasteJournalDocument).jsonl.trim().split('\n');
  assert.equal(stored.length, 1);
  assert.deepEqual((JSON.parse(stored[0]!) as { payload: { scope: unknown } }).payload.scope, { kind: 'project', projectId: A });
  // Nothing was retried for the loser. Its explicit replay, after reading the new journal, appends once.
  assert.equal(documents.writes, 2);
  assert.equal((await bind(documents, B).submit(losing)).status, 'appended');
  assert.equal(documents.revision, 2);
});

test('a put refused with proof that nothing was written rejects typed; an unproven failure stays unconfirmed', async () => {
  const cases: readonly [unknown, new (...args: never[]) => Error, string?][] = [
    [Object.assign(new Error(), { code: 'conflict' }), TasteConflictError],
    [Object.assign(new Error(), { name: 'StorageConflictError' }), TasteConflictError],
    [Object.assign(new Error(), { code: 'read-only' }), TasteReadOnlyError, 'store-read-only'],
    [bridgeError('read-only'), TasteReadOnlyError, 'store-read-only'],
    [Object.assign(new Error(), { code: 'invalid-argument' }), TasteInvalidInputError],
    [Object.assign(new Error(), { code: 'too-large' }), TasteInvalidInputError],
    [bridgeError('invalid'), TasteInvalidInputError],
    [Object.assign(new Error(), { code: 'closed' }), TasteUnavailableError],
    [bridgeError('unavailable'), TasteUnavailableError],
  ];
  for (const [fault, expected, reason] of cases) {
    const documents = new Documents();
    documents.putError = fault;
    await assert.rejects(bind(documents, A).submit(rate({ scope: PROJECT_A, subject: item, value: 4 })), (error: Error) => {
      assert.ok(error instanceof expected, `${String((fault as Error).name)} ${String((fault as { code?: string }).code)} -> ${error.name}`);
      if (reason !== undefined) assert.equal((error as TasteReadOnlyError).reason, reason);
      return true;
    });
    assert.equal(documents.revision, 0);
  }
  for (const fault of [new Error('socket hang up'), bridgeError('unknown'), Object.assign(new Error(), { code: 'integrity' }), 'lost', undefined]) {
    const documents = new Documents();
    documents.putError = fault;
    assert.deepEqual(await bind(documents, A).submit(rate({ scope: PROJECT_A, subject: item, value: 4 })), { status: 'fail-closed', reason: 'sync-failed' });
  }
});

test('a journal saved by a newer schema is read-only on every path, and is left exactly as stored', async () => {
  for (const schema of ['hq.design.taste-journal/v2', 'hq.design.taste-journal/v10']) {
    const documents = new Documents();
    documents.revision = 3;
    documents.value = { schema, jsonl: '', futureField: { anything: true } };
    const before = structuredClone(documents.value);
    const client = bind(documents, A);
    const readOnly = (error: Error) => error instanceof TasteReadOnlyError && error.reason === 'unsupported-stored-schema';
    await assert.rejects(client.snapshot(A), readOnly);
    await assert.rejects(client.submit(rate({ scope: PROJECT_A, subject: item, value: 4 })), readOnly);
    await assert.rejects(client.exportProfile(exportAll), readOnly);
    assert.deepEqual(documents.value, before);
    assert.equal(documents.writes, 0);
  }
});

test('an unrecognised or malformed stored document is unavailable, not read-only', async () => {
  const documents = new Documents();
  documents.revision = 1;
  for (const value of [
    { schema: 'foreign', jsonl: '' }, { schema: 'hq.design.taste-journal/v0', jsonl: '' }, { schema: 'hq.design.taste-journal/v01', jsonl: '' },
    { schema: 'hq.design.taste-journal/v1', jsonl: '', extra: true }, { schema: 'hq.design.taste-journal/v1' }, { schema: 7, jsonl: '' }, [], null,
  ]) {
    documents.value = value;
    await assert.rejects(bind(documents, A).snapshot(A), TasteUnavailableError, JSON.stringify(value));
  }
  documents.value = { schema: SCHEMA, jsonl: '' } satisfies TasteJournalDocument;
  assert.equal((await bind(documents, A).snapshot(A)).journal.state, 'open');
});

test('exporting a journal with a verified fault rejects as a fault with its reason, and repairs nothing', async () => {
  const documents = new Documents();
  const client = bind(documents, A);
  await client.submit(rate({ scope: PROJECT_A, subject: item, value: 4 }));
  documents.value = { schema: SCHEMA, jsonl: `${(documents.value as TasteJournalDocument).jsonl}{interrupted` };
  const damaged = structuredClone(documents.value);
  await assert.rejects(bind(documents, A).exportProfile(exportAll), (error: Error) => {
    assert.ok(error instanceof TasteJournalFaultError);
    assert.equal(error.reason, 'incomplete-tail');
    return error instanceof TasteUnavailableError;
  });
  assert.deepEqual(documents.value, damaged);
});

test('invalid input rejects as invalid input, still a TypeError', async () => {
  const documents = new Documents();
  const client = bind(documents, A);
  for (const options of [null, {}, { ...exportAll, includeNotes: 'yes' }, { ...exportAll, extra: 1 }, { ...exportAll, scope: { kind: 'project' } }]) {
    await assert.rejects(client.exportProfile(options as never), (error: Error) => error instanceof TasteInvalidInputError && error instanceof TypeError);
  }
  await assert.rejects(client.exportProfile({ ...exportAll, scope: { kind: 'project', projectId: B } }), TasteProjectBindingError);
  assert.throws(() => projectId(''), TasteInvalidInputError);
  assert.equal(documents.writes, 0);
});
