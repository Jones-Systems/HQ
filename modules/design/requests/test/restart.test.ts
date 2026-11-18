import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DRAFT_PRIVACY } from '../src/contract.ts';
import { WRITE_STAGES } from '../src/fakes.ts';
import { env, readyDraft } from './fixtures.ts';

const draftKey = (requestId: string) => `design/requests/${requestId}/draft`;

test('drafts autosave after the debounce and carry the privacy label', async () => {
  const e = env();
  const created = await e.store.createRequest({ title: 'Autosave' });
  const session = await e.open(created.requestId);
  assert.equal(session.state.draft?.privacy, DRAFT_PRIVACY);
  const writesBefore = e.storage.calls.filter((call) => call.op === 'write').length;
  session.edit({ type: 'set-intent', intent: 'one' });
  session.edit({ type: 'set-intent', intent: 'one two' });
  assert.equal(session.state.save, 'unsaved');
  e.scheduler.advance(399);
  assert.equal(e.storage.calls.filter((call) => call.op === 'write').length, writesBefore, 'no write before the debounce');
  e.scheduler.advance(1);
  await session.flush();
  assert.equal(e.storage.calls.filter((call) => call.op === 'write').length, writesBefore + 1, 'two edits coalesce into one write');
  assert.equal(session.state.save, 'saved');
  assert.deepEqual(e.storage.peek('workspace', draftKey(created.requestId)), session.draftBytes());
});

for (const stage of WRITE_STAGES) {
  test(`restart mid-edit after a crash before ${stage}: draft comes back byte-identical`, async () => {
    const e = env();
    const { requestId, session } = await readyDraft(e);
    const saved = e.storage.peek('workspace', draftKey(requestId));
    assert.ok(saved);
    assert.deepEqual(saved, session.draftBytes());

    session.edit({ type: 'set-title', title: 'Edited while the crash happens ✂︎' });
    const attempted = session.draftBytes();
    e.storage.crashAt({ op: 'write', stage, key: (key) => key === draftKey(requestId) });
    await session.flush();
    assert.equal(session.state.save, 'error');
    assert.match(session.state.error ?? '', /Simulated crash/u);

    const { session: reopened } = await e.restart(requestId);
    const expected = stage === 'ack' ? attempted : saved; // `ack`: durable, only the reply was lost
    assert.deepEqual(e.storage.peek('workspace', draftKey(requestId)), expected);
    assert.deepEqual(reopened.draftBytes(), expected, 'reloaded draft re-serializes to exactly the stored bytes');
    assert.equal(reopened.state.recovered.length, 0);
  });
}

test('a torn temp file never becomes visible and edits continue after restart', async () => {
  const e = env();
  const { requestId, session } = await readyDraft(e);
  const saved = session.draftBytes();
  session.edit({ type: 'set-intent', intent: 'x'.repeat(5000) });
  e.storage.crashAt({ op: 'write', stage: 'temp-fsync' });
  await session.flush();
  const { session: reopened } = await e.restart(requestId);
  assert.deepEqual(reopened.draftBytes(), saved);
  assert.ok(reopened.edit({ type: 'set-title', title: 'After restart' }));
  await reopened.flush();
  assert.equal(reopened.state.save, 'saved');
});

test('a draft from a newer schema opens read-only and is never rewritten', async () => {
  const e = env();
  const created = await e.store.createRequest({ title: 'Future' });
  const future = new TextEncoder().encode('{"schema":"hq.design.request-draft/v9","privacy":"local-unsent"}');
  e.storage.corrupt('workspace', draftKey(created.requestId), future);
  const { session } = await e.restart(created.requestId);
  assert.match(session.state.readOnly ?? '', /newer format/u);
  assert.equal(session.edit({ type: 'set-title', title: 'nope' }), false);
  await session.flush();
  assert.deepEqual(e.storage.peek('workspace', draftKey(created.requestId)), future);
});

test('invalid stored draft is preserved, not repaired', async () => {
  const e = env();
  const created = await e.store.createRequest({ title: 'Broken' });
  const broken = new TextEncoder().encode('{"schema":"hq.design.request-draft/v1","privacy":"shared"}');
  e.storage.corrupt('workspace', draftKey(created.requestId), broken);
  const { session } = await e.restart(created.requestId);
  assert.match(session.state.readOnly ?? '', /failed validation/u);
  assert.deepEqual(e.storage.peek('workspace', draftKey(created.requestId)), broken);
});
