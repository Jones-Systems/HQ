import assert from 'node:assert/strict';
import { appendFile, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { clientEventId } from '../src/contract.ts';
import { TasteJournal } from '../src/journal.ts';
import { createNodeTasteFileSystem, nodeSha256 } from '../src/node-file-system.ts';
import { GENERAL, fixedClock, rate, subject } from './helpers.ts';

/** Real-disk adapter checks in a test-owned temporary directory removed afterwards. */

let directory = '';

before(async () => { directory = await mkdtemp(join(tmpdir(), 'hq-taste-test-')); });
after(async () => { if (directory) await rm(directory, { recursive: true, force: true }); });

function options(name: string, token: string, pid = process.pid) {
  return {
    fs: createNodeTasteFileSystem(), path: join(directory, `${name}.jsonl`), lockPath: join(directory, `${name}.lock`),
    sha256: nodeSha256, clock: fixedClock(), lockToken: token, pid,
  };
}

async function open(name: string, token: string, pid?: number) {
  const result = await TasteJournal.open(options(name, token, pid));
  if (result.status !== 'opened') throw new Error(`Expected open, got ${result.status}`);
  return result.journal;
}

describe('Node taste file system adapter', () => {
  it('appends durably, holds an exclusive lock and reopens verified', async () => {
    const journal = await open('basic', 'a');
    assert.equal((await journal.append(clientEventId('e1'), rate({ scope: GENERAL, subject: subject('a'), value: 4 }).event)).status, 'appended');
    assert.equal((await TasteJournal.open(options('basic', 'b'))).status, 'locked');
    const mode = (await stat(join(directory, 'basic.jsonl'))).mode & 0o777;
    assert.equal(mode, 0o600);
    await journal.close();
    await assert.rejects(stat(join(directory, 'basic.lock')), { code: 'ENOENT' });

    const reopened = await open('basic', 'c');
    assert.equal(reopened.status.state, 'open');
    assert.equal(reopened.records().length, 1);
    await reopened.close();
  });

  it('a torn tail on disk fails closed and the file keeps every byte', async () => {
    const journal = await open('torn', 'a');
    await journal.append(clientEventId('e1'), rate({ scope: GENERAL, subject: subject('a'), value: 4 }).event);
    await journal.close();
    const path = join(directory, 'torn.jsonl');
    await appendFile(path, '{"clientEventId":"half');
    const before = await readFile(path);

    const reopened = await open('torn', 'b');
    assert.equal(reopened.status.state === 'fail-closed' && reopened.status.reason, 'incomplete-tail');
    assert.equal((await reopened.append(clientEventId('e2'), rate({ scope: GENERAL, subject: subject('b'), value: 1 }).event)).status, 'fail-closed');
    await reopened.close();
    assert.deepEqual(await readFile(path), before);
  });

  it('reclaims a lock only when its holder process is provably gone', async () => {
    const lockPath = join(directory, 'stale.lock');
    // A pid far above Linux's default pid_max stands in for a crashed writer.
    await writeFile(lockPath, JSON.stringify({ token: 'dead', pid: 2 ** 30, acquiredAt: '2026-10-20T00:00:00.000Z' }));
    assert.equal((await TasteJournal.open(options('stale', 'next'))).status, 'locked');
    const reclaimed = await TasteJournal.open({ ...options('stale', 'next'), reclaimStaleLock: true });
    assert.equal(reclaimed.status, 'opened');
    if (reclaimed.status === 'opened') await reclaimed.journal.close();

    await writeFile(lockPath, JSON.stringify({ token: 'alive', pid: process.pid, acquiredAt: '2026-10-20T00:00:00.000Z' }));
    assert.equal((await TasteJournal.open({ ...options('stale', 'other'), reclaimStaleLock: true })).status, 'locked');
    await rm(lockPath);
  });
});
