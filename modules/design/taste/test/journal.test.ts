import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { clientEventId } from '../src/contract.ts';
import { createFakeTasteFileSystem } from '../src/fake-file-system.ts';
import { TasteJournal } from '../src/journal.ts';
import { nodeSha256 } from '../src/node-file-system.ts';
import { GENERAL, JOURNAL, LOCK, fixedClock, openJournal, rate, subject } from './helpers.ts';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

async function seeded(count: number) {
  const opened = await openJournal();
  for (let index = 0; index < count; index += 1) {
    const result = await opened.journal.append(clientEventId(`seed-${index}`), rate({ scope: GENERAL, subject: subject(`s${index}`), value: 3 }).event);
    assert.equal(result.status, 'appended');
  }
  await opened.journal.close();
  return opened.fs;
}

describe('taste journal hash chain', () => {
  it('chains records, acknowledges only after sync, and verifies on reopen', async () => {
    const { fs, journal } = await openJournal();
    const first = await journal.append(clientEventId('e1'), rate({ scope: GENERAL, subject: subject('a'), value: 4 }).event);
    assert.equal(first.status, 'appended');
    assert.equal(fs.calls.sync, 1, 'one fsync per acknowledged append');
    assert.equal(fs.calls.directorySync, 1, 'new journal directory entry synced once');
    const second = await journal.append(clientEventId('e2'), rate({ scope: GENERAL, subject: subject('b'), value: 2 }).event);
    assert.equal(second.status, 'appended');
    assert.equal(fs.calls.directorySync, 1);
    if (first.status !== 'appended' || second.status !== 'appended') return;
    assert.equal(second.record.prev, first.record.hash);
    assert.equal(second.record.seq, 2);
    await journal.close();

    const lines = decoder.decode(fs.bytes(JOURNAL)!).split('\n');
    assert.equal(lines.length, 3);
    assert.equal(lines[2], '', 'every record is newline-terminated');

    const reopened = await openJournal(fs, 'writer-2');
    assert.deepEqual(reopened.journal.status, { state: 'open', head: { seq: 2, hash: second.record.hash } });
    await reopened.journal.close();
  });

  it('a tampered link fails validation and nothing is truncated', async () => {
    const fs = await seeded(3);
    const original = fs.bytes(JOURNAL)!;
    const lines = decoder.decode(original).split('\n');
    // Change line 2's rating value and recompute nothing: payload digest and hash no longer match.
    lines[1] = lines[1].replace('"value":3', '"value":5');
    const tampered = encoder.encode(lines.join('\n'));
    fs.setBytes(JOURNAL, tampered);

    const { journal } = await openJournal(fs, 'writer-2');
    const status = journal.status;
    assert.equal(status.state, 'fail-closed');
    if (status.state !== 'fail-closed') return;
    assert.equal(status.reason, 'payload-digest-mismatch');
    assert.equal(status.line, 2);
    assert.equal(status.verifiedRecords, 1);
    assert.equal(journal.records().length, 1, 'verified prefix stays readable');

    const attempt = await journal.append(clientEventId('after-tamper'), rate({ scope: GENERAL, subject: subject('x'), value: 1 }).event);
    assert.deepEqual(attempt, { status: 'fail-closed', reason: 'payload-digest-mismatch' });
    await journal.close();
    assert.deepEqual(fs.bytes(JOURNAL), tampered, 'file bytes are untouched: no truncation or repair');
  });

  it('detects a removed record and a relinked record', async () => {
    const fs = await seeded(3);
    const lines = decoder.decode(fs.bytes(JOURNAL)!).split('\n');
    const spliced = encoder.encode([lines[0], lines[2], ''].join('\n'));
    fs.setBytes(JOURNAL, spliced);
    let opened = await openJournal(fs, 'writer-2');
    assert.equal(opened.journal.status.state === 'fail-closed' && opened.journal.status.reason, 'sequence-gap');
    await opened.journal.close();
    assert.deepEqual(fs.bytes(JOURNAL), spliced);

    const prev = /"prev":"([0-9a-f]{64})"/u.exec(lines[1])![1];
    const relinked = encoder.encode([lines[0], lines[1].replace(prev, '0'.repeat(64)), lines[2], ''].join('\n'));
    fs.setBytes(JOURNAL, relinked);
    opened = await openJournal(fs, 'writer-3');
    assert.equal(opened.journal.status.state === 'fail-closed' && opened.journal.status.reason, 'broken-link');
    await opened.journal.close();
    assert.deepEqual(fs.bytes(JOURNAL), relinked);
  });

  it('rejects non-canonical whitespace as tampering', async () => {
    const fs = await seeded(1);
    const text = decoder.decode(fs.bytes(JOURNAL)!).replace('{"clientEventId"', '{ "clientEventId"');
    fs.setBytes(JOURNAL, encoder.encode(text));
    const { journal } = await openJournal(fs, 'writer-2');
    assert.equal(journal.status.state, 'fail-closed');
    if (journal.status.state === 'fail-closed') assert.equal(journal.status.reason, 'non-canonical-record');
    await journal.close();
  });
});

describe('clientEventId idempotency', () => {
  it('same id and payload is a no-op; a changed payload is a conflict', async () => {
    const { fs, journal } = await openJournal();
    const command = rate({ scope: GENERAL, subject: subject('a'), value: 4, event: 'click-1' });
    const first = await journal.append(command.clientEventId, command.event);
    assert.equal(first.status, 'appended');
    const bytes = fs.bytes(JOURNAL);
    const writes = fs.calls.write;

    const replay = await journal.append(command.clientEventId, command.event);
    assert.equal(replay.status, 'duplicate');
    if (first.status === 'appended' && replay.status === 'duplicate') assert.deepEqual(replay.record, first.record);

    const changed = { ...command.event, value: 2 as const };
    const conflict = await journal.append(command.clientEventId, changed);
    assert.equal(conflict.status, 'conflict');
    assert.equal(fs.calls.write, writes, 'neither replay nor conflict writes');
    assert.deepEqual(fs.bytes(JOURNAL), bytes);
    await journal.close();

    const reopened = await openJournal(fs, 'writer-2');
    assert.equal((await reopened.journal.append(command.clientEventId, command.event)).status, 'duplicate', 'idempotency survives restart');
    assert.equal((await reopened.journal.append(command.clientEventId, changed)).status, 'conflict');
    await reopened.journal.close();
  });

  it('concurrent appends with the same id produce exactly one record', async () => {
    const { journal } = await openJournal();
    const command = rate({ scope: GENERAL, subject: subject('a'), value: 4 });
    const results = await Promise.all([1, 2, 3].map(() => journal.append(command.clientEventId, command.event)));
    assert.deepEqual(results.map((item) => item.status).sort(), ['appended', 'duplicate', 'duplicate']);
    assert.equal(journal.records().length, 1);
    await journal.close();
  });
});

describe('fail-closed after a partial or unknown write', () => {
  it('a short write fails closed now and on reopen, without truncation', async () => {
    const { fs, journal } = await openJournal();
    assert.equal((await journal.append(clientEventId('ok'), rate({ scope: GENERAL, subject: subject('a'), value: 4 }).event)).status, 'appended');
    fs.arm({ kind: 'short-write', bytes: 17 });
    const partial = await journal.append(clientEventId('torn'), rate({ scope: GENERAL, subject: subject('b'), value: 2 }).event);
    assert.deepEqual(partial, { status: 'fail-closed', reason: 'partial-write' });
    assert.equal(journal.status.state, 'fail-closed');
    const writes = fs.calls.write;
    const next = await journal.append(clientEventId('next'), rate({ scope: GENERAL, subject: subject('c'), value: 5 }).event);
    assert.equal(next.status, 'fail-closed');
    assert.equal(fs.calls.write, writes, 'no further writes once fail-closed');
    await journal.close();

    const torn = fs.bytes(JOURNAL)!;
    const reopened = await openJournal(fs, 'writer-2');
    const status = reopened.journal.status;
    assert.equal(status.state, 'fail-closed');
    if (status.state === 'fail-closed') {
      assert.equal(status.reason, 'incomplete-tail');
      assert.equal(status.verifiedRecords, 1);
      assert.equal(status.line, 2);
    }
    await reopened.journal.close();
    assert.deepEqual(fs.bytes(JOURNAL), torn, 'torn tail is preserved for inspection, not truncated');
  });

  it('a crash mid-write fails closed', async () => {
    const { fs, journal } = await openJournal();
    fs.arm({ kind: 'write-throws', bytesBeforeThrow: 5 });
    const result = await journal.append(clientEventId('crash'), rate({ scope: GENERAL, subject: subject('a'), value: 4 }).event);
    assert.deepEqual(result, { status: 'fail-closed', reason: 'write-failed' });
    assert.equal(journal.records().length, 0);
    await journal.close();
  });

  it('a failed fsync is never acknowledged; a replay after reopen is idempotent', async () => {
    const { fs, journal } = await openJournal();
    fs.arm({ kind: 'sync-throws' });
    const command = rate({ scope: GENERAL, subject: subject('a'), value: 4 });
    const result = await journal.append(command.clientEventId, command.event);
    assert.deepEqual(result, { status: 'fail-closed', reason: 'sync-failed' });
    assert.equal(journal.records().length, 0, 'not acknowledged');
    await journal.close();

    // The fake kept the bytes, standing in for "the OS may have persisted them".
    const reopened = await openJournal(fs, 'writer-2');
    assert.equal(reopened.journal.status.state, 'open');
    assert.equal((await reopened.journal.append(command.clientEventId, command.event)).status, 'duplicate');
    await reopened.journal.close();
  });

  it('a failed directory sync on creation is not acknowledged', async () => {
    const { fs, journal } = await openJournal();
    fs.arm({ kind: 'directory-sync-throws' });
    const result = await journal.append(clientEventId('first'), rate({ scope: GENERAL, subject: subject('a'), value: 4 }).event);
    assert.deepEqual(result, { status: 'fail-closed', reason: 'sync-failed' });
    await journal.close();
  });
});

describe('single-writer lock', () => {
  it('refuses a second writer until the first closes', async () => {
    const { fs, journal } = await openJournal();
    const second = await TasteJournal.open({
      fs, path: JOURNAL, lockPath: LOCK, sha256: nodeSha256, clock: fixedClock(), lockToken: 'writer-2', pid: 202,
    });
    assert.equal(second.status, 'locked');
    if (second.status === 'locked') assert.equal(second.holder?.token, 'writer-1');
    await journal.close();
    const third = await openJournal(fs, 'writer-3', 303);
    assert.equal(third.journal.status.state, 'open');
    await third.journal.close();
  });

  it('reclaims only a provably dead holder, and only when asked', async () => {
    const fs = createFakeTasteFileSystem();
    await openJournal(fs, 'crashed', 404); // never closed: the process "died"
    const options = { fs, path: JOURNAL, lockPath: LOCK, sha256: nodeSha256, clock: fixedClock(), lockToken: 'next', pid: 505 };
    assert.equal((await TasteJournal.open({ ...options, reclaimStaleLock: true })).status, 'locked', 'live holder is never forced');
    fs.markDead(404);
    assert.equal((await TasteJournal.open(options)).status, 'locked', 'no reclaim without the explicit option');
    const reclaimed = await TasteJournal.open({ ...options, reclaimStaleLock: true });
    assert.equal(reclaimed.status, 'opened');
    if (reclaimed.status === 'opened') await reclaimed.journal.close();
  });

  it('a closed journal refuses appends', async () => {
    const { journal } = await openJournal();
    await journal.close();
    assert.deepEqual(await journal.append(clientEventId('late'), rate({ scope: GENERAL, subject: subject('a'), value: 4 }).event), { status: 'closed' });
  });
});
