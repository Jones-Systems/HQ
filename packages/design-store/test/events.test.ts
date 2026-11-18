import assert from 'node:assert/strict';
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import type { EventRecord, Projection, StreamId } from '../src/contract.ts';
import { isStoreError } from '../src/errors.ts';
import { streamId } from '../src/ids.ts';
import { liveGenerationDir, open, scratch, WORKSPACE } from './helpers.ts';

const STREAM: StreamId = streamId('taste/general');

function journal(root: string): string {
  return join(liveGenerationDir(root), 'ns', 'workspace', 'events', 'taste~2fgeneral.jsonl');
}

const counter: Projection<{ count: number; last: string | null }> = {
  name: 'counter',
  version: 1,
  initial: () => ({ count: 0, last: null }),
  reduce: (state, event: EventRecord) => ({ count: state.count + 1, last: event.type }),
};

describe('append-only events', () => {
  it('appends a verified hash chain', async (t) => {
    const root = join(scratch(t), 'store');
    const { store } = await open(root);
    const one = await store.appendEvent(WORKSPACE, STREAM, { type: 'rated', payload: { overall: 4 } });
    const two = await store.appendEvent(WORKSPACE, STREAM, { type: 'noted', payload: { text: 'tight spacing' } });
    assert.equal(one.seq, 1);
    assert.equal(one.prev, null);
    assert.equal(two.prev, one.hash);
    await store.close();
    const reopened = (await open(root)).store;
    const read = await reopened.readEvents(WORKSPACE, STREAM);
    assert.deepEqual(read.status, { state: 'ok' });
    assert.deepEqual(read.events, [one, two]);
    assert.deepEqual(read.head, { seq: 2, hash: two.hash });
    const three = await reopened.appendEvent(WORKSPACE, STREAM, { type: 'rated', payload: { overall: 5 } });
    assert.equal(three.prev, two.hash);
    await reopened.close();
  });

  it('treats a replayed clientEventId as a no-op and a changed payload as a conflict', async (t) => {
    const root = join(scratch(t), 'store');
    const { store } = await open(root);
    const first = await store.appendEvent(WORKSPACE, STREAM, { type: 'rated', payload: { overall: 3 }, clientEventId: 'evt-1' });
    const before = readFileSync(journal(root));
    assert.deepEqual(await store.appendEvent(WORKSPACE, STREAM, { type: 'rated', payload: { overall: 3 }, clientEventId: 'evt-1' }), first);
    await assert.rejects(store.appendEvent(WORKSPACE, STREAM, { type: 'rated', payload: { overall: 5 }, clientEventId: 'evt-1' }), (error) => isStoreError(error, 'conflict'));
    assert.deepEqual(readFileSync(journal(root)), before);
    await store.close();
    const reopened = (await open(root)).store;
    assert.deepEqual(await reopened.appendEvent(WORKSPACE, STREAM, { type: 'rated', payload: { overall: 3 }, clientEventId: 'evt-1' }), first);
    await reopened.close();
  });

  it('detects a tampered link, fails closed and never truncates', async (t) => {
    const root = join(scratch(t), 'store');
    const { store } = await open(root);
    for (const overall of [1, 2, 3]) await store.appendEvent(WORKSPACE, STREAM, { type: 'rated', payload: { overall } });
    await store.close();
    const tampered = readFileSync(journal(root), 'utf8').replace('"overall":2', '"overall":5');
    writeFileSync(journal(root), tampered);
    const reopened = (await open(root)).store;
    const read = await reopened.readEvents(WORKSPACE, STREAM);
    assert.equal(read.status.state, 'corrupt');
    assert.equal(read.status.state === 'corrupt' && read.status.atSeq, 2);
    assert.equal(read.events.length, 1);
    await assert.rejects(reopened.appendEvent(WORKSPACE, STREAM, { type: 'rated', payload: { overall: 9 } }), (error) => isStoreError(error, 'stream-unavailable'));
    await assert.rejects(reopened.repairTornTail(WORKSPACE, STREAM), (error) => isStoreError(error, 'invalid-argument'));
    assert.equal(readFileSync(journal(root), 'utf8'), tampered);
    await reopened.close();
  });

  it('holds a torn tail fail-closed until an explicit repair that preserves the original bytes', async (t) => {
    const root = join(scratch(t), 'store');
    const { store } = await open(root);
    await store.appendEvent(WORKSPACE, STREAM, { type: 'rated', payload: { overall: 2 } });
    await store.close();
    appendFileSync(journal(root), '{"at":"2026-01-01T00:00:09.000Z","clientEv');
    const original = readFileSync(journal(root));
    const reopened = (await open(root)).store;
    const read = await reopened.readEvents(WORKSPACE, STREAM);
    assert.equal(read.status.state, 'torn-tail');
    assert.equal(read.events.length, 1);
    await assert.rejects(reopened.appendEvent(WORKSPACE, STREAM, { type: 'rated', payload: { overall: 3 } }), (error) => isStoreError(error, 'stream-unavailable'));
    assert.deepEqual(readFileSync(journal(root)), original, 'no automatic truncation');
    const repair = await reopened.repairTornTail(WORKSPACE, STREAM);
    assert.equal(repair.removedTailBytes, 42);
    assert.deepEqual(readFileSync(join(root, repair.quarantinedAs)), original);
    assert.deepEqual((await reopened.readEvents(WORKSPACE, STREAM)).status, { state: 'ok' });
    const next = await reopened.appendEvent(WORKSPACE, STREAM, { type: 'rated', payload: { overall: 3 } });
    assert.equal(next.seq, 2);
    await reopened.close();
  });

  it('rejects malformed events before writing', async (t) => {
    const { store } = await open(join(scratch(t), 'store'));
    await assert.rejects(store.appendEvent(WORKSPACE, STREAM, { type: '', payload: 1 }), (error) => isStoreError(error, 'invalid-argument'));
    await assert.rejects(store.appendEvent(WORKSPACE, STREAM, { type: 'x', payload: { n: Number.NaN } }), (error) => isStoreError(error, 'invalid-argument'));
    assert.equal((await store.readEvents(WORKSPACE, STREAM)).events.length, 0);
    await store.close();
  });
});

describe('projections', () => {
  it('folds events, resumes from a verified checkpoint and rebuilds when it cannot be trusted', async (t) => {
    const root = join(scratch(t), 'store');
    const { store } = await open(root);
    assert.deepEqual(await store.project(WORKSPACE, STREAM, counter), { state: { count: 0, last: null }, head: null, status: { state: 'ok' }, source: 'rebuilt' });
    await store.appendEvent(WORKSPACE, STREAM, { type: 'a', payload: null });
    await store.appendEvent(WORKSPACE, STREAM, { type: 'b', payload: null });
    const first = await store.project(WORKSPACE, STREAM, counter);
    assert.deepEqual([first.state, first.source], [{ count: 2, last: 'b' }, 'rebuilt']);
    await store.appendEvent(WORKSPACE, STREAM, { type: 'c', payload: null });
    let calls = 0;
    const counting: typeof counter = { ...counter, reduce: (state, event) => { calls += 1; return counter.reduce(state, event); } };
    const resumed = await store.project(WORKSPACE, STREAM, counting);
    assert.deepEqual([resumed.state, resumed.source, calls], [{ count: 3, last: 'c' }, 'checkpoint', 1]);

    const bumped = await store.project(WORKSPACE, STREAM, { ...counter, version: 2 });
    assert.deepEqual([bumped.state, bumped.source], [{ count: 3, last: 'c' }, 'rebuilt']);

    const checkpoint = join(liveGenerationDir(root), 'ns', 'workspace', 'projections', 'counter@taste~2fgeneral.json');
    const body = JSON.parse(readFileSync(checkpoint, 'utf8')) as Record<string, unknown>;
    writeFileSync(checkpoint, JSON.stringify({ ...body, hash: '0'.repeat(64), state: { count: 99, last: 'forged' } }));
    const distrusted = await store.project(WORKSPACE, STREAM, { ...counter, version: 2 });
    assert.deepEqual([distrusted.state, distrusted.source], [{ count: 3, last: 'c' }, 'rebuilt']);
    await store.close();
  });
});
