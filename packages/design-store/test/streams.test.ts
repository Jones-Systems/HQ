import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { isStoreError } from '../src/errors.ts';
import { streamId } from '../src/ids.ts';
import { CACHE, liveGenerationDir, namespaces, open, scratch, WORKSPACE } from './helpers.ts';

describe('listStreams', () => {
  it('lists streams sorted, filtered by prefix, per namespace and across a reopen', async (t) => {
    const root = join(scratch(t), 'store');
    const { store } = await open(root);
    assert.deepEqual(await store.listStreams(WORKSPACE), []);
    for (const id of ['imports/b', 'imports/a', 'taste/general', 'Upper Case']) {
      await store.appendEvent(WORKSPACE, streamId(id), { type: 'x', payload: id });
    }
    await store.appendEvent(CACHE, streamId('cache-only'), { type: 'x', payload: null });
    const all = ['Upper Case', 'imports/a', 'imports/b', 'taste/general'];
    assert.deepEqual(await store.listStreams(WORKSPACE), all);
    assert.deepEqual(await store.listStreams(WORKSPACE, { prefix: 'imports/' }), ['imports/a', 'imports/b']);
    assert.deepEqual(await store.listStreams(CACHE), ['cache-only']);
    await store.close();
    const reopened = (await open(root)).store;
    assert.deepEqual(await reopened.listStreams(WORKSPACE), all);
    await reopened.close();
  });

  it('still lists a torn stream so its status can be read, and ignores temp files', async (t) => {
    const root = join(scratch(t), 'store');
    const { store } = await open(root);
    const id = streamId('journal');
    await store.appendEvent(WORKSPACE, id, { type: 'x', payload: 1 });
    const events = join(liveGenerationDir(root), 'ns', 'workspace', 'events');
    writeFileSync(join(events, 'journal.jsonl'), '{"torn":', { flag: 'a' });
    writeFileSync(join(events, '.tmp-leftover.jsonl'), 'ignored');
    assert.deepEqual(await store.listStreams(WORKSPACE), ['journal']);
    assert.equal((await store.readEvents(WORKSPACE, id)).status.state, 'torn-tail');
    await store.close();
  });

  it('fails closed for an authoritative stream whose id was hashed, and skips it in a cache', async (t) => {
    const root = join(scratch(t), 'store');
    const { store } = await open(root, { namespaces: namespaces(1 << 20) });
    const long = streamId('s'.repeat(200));
    await store.appendEvent(WORKSPACE, long, { type: 'x', payload: 1 });
    await store.appendEvent(CACHE, long, { type: 'x', payload: 1 });
    await assert.rejects(store.listStreams(WORKSPACE), (error) => isStoreError(error, 'integrity'));
    assert.deepEqual(await store.listStreams(CACHE), []);
    await store.close();
  });

  it('works read-only on a reopened store without writing', async (t) => {
    const root = join(scratch(t), 'store');
    const { store } = await open(root);
    await store.appendEvent(WORKSPACE, streamId('one'), { type: 'x', payload: 1 });
    await store.close();
    const readOnly = (await open(root, { readOnly: true })).store;
    assert.deepEqual(await readOnly.listStreams(WORKSPACE), ['one']);
    await readOnly.close();
  });
});
