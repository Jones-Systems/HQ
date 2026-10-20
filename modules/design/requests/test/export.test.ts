import assert from 'node:assert/strict';
import { test } from 'node:test';
import { exportRequests } from '../src/export.ts';
import { env, frozenWithDestination, imageBytes, readyDraft } from './fixtures.ts';

function base64(bytes: Uint8Array): string { return Buffer.from(bytes).toString('base64'); }

test('attachments are only included when explicitly selected', async () => {
  const e = env();
  const { session } = await readyDraft(e);
  assert.ok(await session.addAttachment(imageBytes(1), { attachmentId: 'att-1', mediaType: 'image/png', label: 'Hero crop' }));
  assert.equal(session.state.draft!.attachments[0]!.selected, false, 'new attachments start unselected');
  const packet = (await session.freeze())!;
  assert.deepEqual(packet.attachments, []);
});

test('privacy/export output contains no unsent drafts and no unselected images', async () => {
  const e = env();
  const { requestId, session } = await readyDraft(e);
  const selected = imageBytes(1);
  const unselected = imageBytes(2);
  await session.addAttachment(selected, { attachmentId: 'att-selected', mediaType: 'image/png', label: 'Chosen crop' });
  await session.addAttachment(unselected, { attachmentId: 'att-private', mediaType: 'image/png', label: 'PRIVATE-UNSELECTED-LABEL' });
  session.edit({ type: 'select-attachment', attachmentId: 'att-selected' as never, selected: true });
  const packet = (await session.freeze())!;
  assert.deepEqual(packet.attachments.map((item) => item.attachmentId), ['att-selected']);

  // Unsent edits after freeze, plus a second request that was never frozen.
  session.edit({ type: 'set-intent', intent: 'UNSENT-CONTINUATION-SECRET' });
  await session.flush();
  const other = await e.store.createRequest({ title: 'UNSENT-DRAFT-TITLE' });

  const snapshots = await Promise.all([requestId, other.requestId].map((id) => e.store.open(id)));
  const { bundle, bytes } = await exportRequests(snapshots, e.storage, '2026-01-03T00:00:00.000Z');
  const text = new TextDecoder().decode(bytes);

  for (const secret of ['UNSENT-CONTINUATION-SECRET', 'UNSENT-DRAFT-TITLE', 'PRIVATE-UNSELECTED-LABEL', 'att-private', 'local-unsent', base64(unselected)]) {
    assert.equal(text.includes(secret), false, `export must not contain ${secret}`);
  }
  const unselectedDigest = snapshots[0]!.draft!.attachments.find((item) => item.attachmentId === 'att-private')!.blobDigest;
  assert.equal(text.includes(unselectedDigest), false, 'unselected image digest absent');
  assert.equal(text.includes(base64(selected)), true, 'selected image is exported');
  assert.deepEqual(bundle.requests.map((item) => item.requestId), [requestId], 'never-frozen requests are omitted');
  assert.deepEqual(bundle.omitted.map((item) => [item.store, item.count]), [['drafts', 2], ['draft-history', 1], ['unselected-attachments', 1], ['cache', 0], ['sends', 0], ['handoff', 0]]);
});

test('export reports the send records and handoff statuses it leaves out', async () => {
  const { e, requestId, session, packet, link } = await frozenWithDestination();
  assert.equal(await session.send(e.connector.dispatch, packet.packetId, 'dest-1'), 'sent');
  e.connector.set(link, 'queued');
  await session.refreshHandoff(e.connector.status);
  const snapshot = await e.store.open(requestId);
  assert.equal(snapshot.sends.length, 1);
  assert.equal(snapshot.handoff.length, 1);
  const { bundle, bytes } = await exportRequests([snapshot], e.storage, '2026-01-03T00:00:00.000Z');
  const text = new TextDecoder().decode(bytes);
  for (const schema of ['hq.design.request-send/v1', 'hq.design.request-handoff-status/v1']) assert.equal(text.includes(schema), false, `export must not contain ${schema}`);
  assert.deepEqual(bundle.omitted.filter((item) => item.store === 'sends' || item.store === 'handoff').map((item) => [item.store, item.count]), [['sends', 1], ['handoff', 1]]);
});
