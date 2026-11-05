import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PACKET_SCHEMA, type FreezeRecord } from '../src/contract.ts';
import { WRITE_STAGES } from '../src/fakes.ts';
import { decodeJson, digestOf } from '../src/jcs.ts';
import { authoringBody, verifyPacket } from '../src/packet.ts';
import { parseFreezeRecord } from '../src/validate.ts';
import { env, readyDraft } from './fixtures.ts';

const draftKey = (requestId: string) => `design/requests/${requestId}/draft`;
const packetKey = (requestId: string, sequence = 1) => `design/requests/${requestId}/packets/${String(sequence).padStart(6, '0')}`;

test('freeze saves the packet and clears the draft in one atomic record', async () => {
  const e = env();
  const { requestId, session } = await readyDraft(e);
  const frozenDraft = session.state.draft!;
  const writesBefore = e.storage.calls.filter((call) => call.op === 'create' || call.op === 'write').length;

  const packet = await session.freeze();
  assert.ok(packet);
  assert.equal(packet.schema, PACKET_SCHEMA);
  assert.equal(packet.authoringDigest, await digestOf(authoringBody(packet)));
  assert.equal(packet.lineage.sequence, 1);
  assert.equal(packet.lineage.parent, null);
  assert.equal(packet.supersedes, null);
  assert.equal(packet.lineage.rootPacketId, packet.packetId);
  assert.deepEqual(packet.lineage.draft, { draftId: frozenDraft.draftId, revision: frozenDraft.revision });
  assert.ok(Object.isFrozen(packet) && Object.isFrozen(packet.sources), 'packet objects are immutable');

  const freezeWrites = e.storage.calls.filter((call) => call.op === 'create' || call.op === 'write').slice(writesBefore);
  assert.deepEqual(freezeWrites.map((call) => call.op), ['create', 'write'], 'one write-once record, then continuation cleanup');
  const record: FreezeRecord = parseFreezeRecord(decodeJson(e.storage.peek('workspace', packetKey(requestId))!));
  assert.deepEqual(record.packet, packet);
  assert.deepEqual(record.consumed, { draftId: frozenDraft.draftId, revision: frozenDraft.revision });
  assert.deepEqual(record.consumedDraft, frozenDraft, 'consumed draft kept as recoverable history');

  const active = session.state.draft!;
  assert.notEqual(active.draftId, frozenDraft.draftId, 'the frozen draft is cleared');
  assert.equal(active.origin, 'continuation');
  assert.deepEqual(active.continuesFrom, { packetId: packet.packetId, authoringDigest: packet.authoringDigest });
  assert.deepEqual(decodeJson(e.storage.peek('workspace', draftKey(requestId))!), active);
  assert.deepEqual(session.state.blockers, ['No changes since packet 1.']);
});

for (const stage of WRITE_STAGES) {
  test(`crash before ${stage} of the freeze record: packet and draft-consumed are all-or-nothing`, async () => {
    const e = env();
    const { requestId, session } = await readyDraft(e);
    const before = e.storage.peek('workspace', draftKey(requestId))!;
    const beforeId = (decodeJson(before) as { draftId: string }).draftId;
    e.storage.crashAt({ op: 'create', stage, key: (key) => key.includes('/packets/') });

    const packet = await session.freeze();
    assert.equal(packet, null);
    assert.equal(session.state.unknown, true, 'a failed freeze write is an unknown outcome');
    assert.equal(session.edit({ type: 'set-title', title: 'held' }), false, 'edits are held until reconciliation');

    const { session: reopened } = await e.restart(requestId);
    if (stage === 'ack') {
      assert.equal(reopened.state.packets.length, 1, 'durable record means frozen');
      assert.notEqual(reopened.state.draft?.draftId, beforeId);
      assert.match(reopened.state.recovered.join(' '), /consumed draft cleared/u);
      await verifyPacket(JSON.parse(JSON.stringify(reopened.state.packets[0])));
    } else {
      assert.equal(reopened.state.packets.length, 0, 'no packet without its consumed marker');
      assert.deepEqual(e.storage.peek('workspace', draftKey(requestId)), before);
      assert.deepEqual(reopened.draftBytes(), before, 'draft intact and byte-identical');
      assert.ok(await reopened.freeze(), 'freezing again after reconciliation succeeds');
    }
  });
}

test('crash between the freeze record and the continuation write is completed on reopen', async () => {
  const e = env();
  const { requestId, session } = await readyDraft(e);
  const consumedId = session.state.draft!.draftId;
  e.storage.crashAt({ op: 'write', stage: 'temp-write', key: (key) => key === draftKey(requestId) });
  const packet = await session.freeze();
  assert.ok(packet, 'the freeze itself is durable');
  const { session: reopened } = await e.restart(requestId);
  assert.equal(reopened.state.packets.length, 1);
  assert.notEqual(reopened.state.draft!.draftId, consumedId);
  assert.equal(reopened.state.draft!.origin, 'continuation');
  assert.match(reopened.state.recovered.join(' '), /consumed draft cleared/u);
  assert.deepEqual(reopened.draftBytes(), e.storage.peek('workspace', draftKey(requestId)), 'recovery wrote the continuation');
});

test('reconcile after an unknown freeze reads the outcome without writing it again', async () => {
  const e = env();
  const { session } = await readyDraft(e);
  e.storage.crashAt({ op: 'create', stage: 'ack' });
  assert.equal(await session.freeze(), null);
  e.storage.restart();
  const creates = e.storage.calls.filter((call) => call.op === 'create').length;
  await session.reconcile();
  assert.equal(e.storage.calls.filter((call) => call.op === 'create').length, creates, 'reconciliation never re-creates');
  assert.equal(session.state.packets.length, 1);
  assert.equal(session.state.unknown, false);
});

test('a late autosave cannot resurrect a frozen draft', async () => {
  const e = env();
  const { requestId, session } = await readyDraft(e);
  session.edit({ type: 'set-title', title: 'Edited just before freeze' });
  const consumed = session.state.draft!;
  const packet = await session.freeze();
  assert.equal(packet?.title, 'Edited just before freeze', 'freeze captures the in-memory revision');
  e.scheduler.advance(10_000);
  await session.flush();
  await assert.rejects(e.store.saveDraft(consumed), /frozen or replaced/u);
  assert.notEqual((decodeJson(e.storage.peek('workspace', draftKey(requestId))!) as { draftId: string }).draftId, consumed.draftId);
});

test('double-click freeze produces exactly one packet', async () => {
  const e = env();
  const { session } = await readyDraft(e);
  const [first, second] = await Promise.all([session.freeze(), session.freeze()]);
  assert.ok(first);
  assert.equal(second, null);
  assert.equal(e.storage.calls.filter((call) => call.op === 'create' && call.key.includes('/packets/')).length, 1);
});

test('freeze is blocked by open clarifications, missing sources and an empty request', async () => {
  const e = env();
  const created = await e.store.createRequest();
  const session = await e.open(created.requestId);
  assert.deepEqual(session.state.blockers, ['Add a title.', 'Describe what should change.', 'Add at least one source version.']);
  session.edit({ type: 'set-title', title: 'T' });
  session.edit({ type: 'set-intent', intent: 'I' });
  session.edit({ type: 'add-source', source: { projectId: 'p' as never, viewId: 'v' as never, versionId: 'x1' as never, sourceRevision: 'r' } });
  session.edit({ type: 'ask', clarificationId: 'q-1' as never, question: 'Which breakpoint?' });
  assert.equal(session.state.draft!.phase, 'clarify');
  assert.deepEqual(session.state.blockers, ['Answer or dismiss 1 open clarification.']);
  assert.equal(await session.freeze(), null);
  assert.match(session.state.error ?? '', /open clarification/u);
  session.edit({ type: 'answer', clarificationId: 'q-1' as never, answer: 'Desktop only.' });
  assert.deepEqual(session.state.blockers, []);
  const packet = await session.freeze();
  assert.deepEqual(packet?.clarifications, [{ clarificationId: 'q-1', question: 'Which breakpoint?', answer: 'Desktop only.' }]);
});

test('a corrupted packet record opens read-only and nothing is written', async () => {
  const e = env();
  const { requestId, session } = await readyDraft(e);
  await session.freeze();
  const bytes = e.storage.peek('workspace', packetKey(requestId))!;
  const tampered = new TextDecoder().decode(bytes).replaceAll('Tighten home heading', 'Tampered home heading');
  e.storage.corrupt('workspace', packetKey(requestId), new TextEncoder().encode(tampered));
  const draftBefore = e.storage.peek('workspace', draftKey(requestId));
  const { session: reopened } = await e.restart(requestId);
  assert.match(reopened.state.readOnly ?? '', /digest mismatch/u);
  assert.equal(reopened.edit({ type: 'set-title', title: 'x' }), false);
  assert.equal(await reopened.freeze(), null);
  assert.deepEqual(e.storage.peek('workspace', draftKey(requestId)), draftBefore);
});
