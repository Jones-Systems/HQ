import assert from 'node:assert/strict';
import { test } from 'node:test';
import { linkOf } from '../src/draft.ts';
import { annotation, env, readyDraft, source } from './fixtures.ts';

const packetKey = (requestId: string, sequence: number) => `design/requests/${requestId}/packets/${String(sequence).padStart(6, '0')}`;

test('a later edit creates a new linked packet and leaves the old one unchanged', async () => {
  const e = env();
  const { requestId, session } = await readyDraft(e);
  const first = (await session.freeze())!;
  const firstBytes = e.storage.peek('workspace', packetKey(requestId, 1))!;

  session.edit({ type: 'set-intent', intent: 'Also align the CTA with the heading.' });
  session.edit({ type: 'add-source', source: source('v-b1') });
  session.edit({ type: 'add-annotation', annotation: annotation('B') });
  const second = (await session.freeze())!;

  assert.notEqual(second.packetId, first.packetId);
  assert.notEqual(second.authoringDigest, first.authoringDigest);
  assert.equal(second.lineage.sequence, 2);
  assert.deepEqual(second.lineage.parent, linkOf(first));
  assert.deepEqual(second.supersedes, linkOf(first));
  assert.equal(second.lineage.rootPacketId, first.packetId);
  assert.equal(second.lineage.origin, 'continuation');
  assert.deepEqual(e.storage.peek('workspace', packetKey(requestId, 1)), firstBytes, 'first packet bytes unchanged');
  assert.equal(first.intent.startsWith('Reduce the gap'), true, 'first packet object unchanged');
  assert.throws(() => { (first as { title: string }).title = 'mutated'; }, TypeError);

  const { session: reopened } = await e.restart(requestId);
  assert.deepEqual(reopened.state.packets.map((packet) => packet.packetId), [first.packetId, second.packetId]);
});

test('freezing an unchanged continuation is refused', async () => {
  const e = env();
  const { session } = await readyDraft(e);
  await session.freeze();
  assert.equal(await session.freeze(), null);
  assert.match(session.state.error ?? '', /No changes since packet 1/u);
  assert.equal(session.state.packets.length, 1);
});

test('two writers racing for the same packet slot cannot both freeze', async () => {
  const e = env();
  const { requestId, session } = await readyDraft(e);
  const other = (await e.restart(requestId)).session; // independent store instance over the same storage
  assert.ok(await session.freeze());
  assert.equal(await other.freeze(), null);
  assert.match(other.state.error ?? '', /no longer continues the latest packet|Another freeze/u);
  assert.equal((await e.store.open(requestId)).packets.length, 1);
});

test('packet history loads in sequence order even when storage lists keys unordered', async () => {
  const e = env();
  const { requestId, session } = await readyDraft(e);
  const first = (await session.freeze())!;
  session.edit({ type: 'add-annotation', annotation: annotation('B') });
  const second = (await session.freeze())!;

  // The StoragePort contract does not promise ordering; only the fake sorts.
  const list = e.storage.listDocuments.bind(e.storage);
  e.storage.listDocuments = async (ns, prefix) => [...await list(ns, prefix)].reverse();
  const reopened = await e.store.open(requestId);
  assert.equal(reopened.readOnly, null);
  assert.deepEqual(reopened.packets.map((packet) => packet.packetId), [first.packetId, second.packetId]);
});
