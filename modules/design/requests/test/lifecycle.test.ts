// Labelled synthetic end-to-end loop over fakes: freeze → confirm → queued → running → returned → decide,
// with restart recovery. This is source evidence, not a live receiver, host catalog or thread-launch qualification.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { DispatchSlot, HandoffStatusPort, PacketLink, ReturnsPort } from '../src/contract.ts';
import { WRITE_STAGES } from '../src/fakes.ts';
import { inboxOf } from '../src/inbox.ts';
import { connectorReturn, draftKeyOf, env, frozenWithDestination, handoffKey, readyDraft, sendKey, versionless } from './fixtures.ts';

const WRITE_OPS = ['write', 'create', 'event', 'blob'];

test('freeze → confirm → queued → running → returned → decision, surviving a restart in the middle', async () => {
  const { e, requestId, session, packet, link } = await frozenWithDestination();
  assert.equal(session.handoffView(packet.packetId, '2026-01-01T01:00:00.000Z')?.state, 'not-sent');
  assert.equal(e.connector.sends.length, 0, 'freezing sends nothing');

  assert.equal(await session.send(e.connector.dispatch, packet.packetId, 'dest-1'), 'sent');
  assert.equal(e.connector.sends.length, 1);
  assert.deepEqual(e.connector.sends[0]!.binding?.destinationId, 'dest-1');
  assert.equal(session.handoffView(packet.packetId, '2026-01-01T01:00:00.000Z')?.state, 'submitting');

  e.connector.set(link, 'queued');
  await session.refreshHandoff(e.connector.status);
  assert.equal(session.handoffView(packet.packetId, '2026-01-01T01:00:30.000Z')?.state, 'queued');

  // Restart while queued: send record and last-known status come back from storage.
  const restarted = await e.restart(requestId);
  assert.equal(restarted.session.handoffView(packet.packetId, '2026-01-01T01:00:30.000Z')?.state, 'queued');
  assert.equal(restarted.session.state.sends.length, 1);

  e.connector.set(link, 'running', { actual: { host: 'fixture-host-a', model: 'fixture-model-1' } });
  await restarted.session.refreshHandoff(e.connector.status);
  assert.equal(restarted.session.handoffView(packet.packetId, '2026-01-01T01:00:40.000Z')?.state, 'running');

  e.connector.set(link, 'returned');
  e.connector.publishReturn(connectorReturn(link));
  await restarted.session.refreshHandoff(e.connector.status);
  await restarted.session.refreshReturns(e.connector.returns);
  const inbox = restarted.session.inbox;
  assert.equal(inbox.length, 1);
  assert.equal(inbox[0]!.decision, null, 'returned work waits for the owner');
  assert.equal(inbox[0]!.origin, 'connector');

  const again = await e.restart(requestId);
  assert.equal(again.session.state.candidates.length, 1, 'the inbox survives a restart');
  assert.ok(await again.session.review(again.session.state.candidates[0]!, 'accept', 'Looks right.'));
  assert.equal(again.session.inbox[0]!.decision, 'accept');
  assert.equal(e.connector.sends.length, 1, 'only the one explicit send ever reached transport');
});

for (const decision of ['accept', 'reject', 'defer'] as const) {
  test(`${decision} appends an event and sends nothing`, async () => {
    const { e, session, link } = await frozenWithDestination();
    const candidate = connectorReturn(link);
    const draftBefore = session.draftBytes();
    const writesBefore = e.storage.calls.length;
    assert.ok(await session.review(candidate, decision, 'note'));
    assert.equal(e.connector.sends.length, 0);
    assert.deepEqual(session.draftBytes(), draftBefore, 'no draft is created or changed');
    assert.equal(session.state.draft!.origin, 'continuation');
    const writes = e.storage.calls.slice(writesBefore).filter((call) => WRITE_OPS.includes(call.op));
    assert.ok(writes.every((call) => call.op === 'create' || call.op === 'event'), 'only the candidate snapshot and the event stream are written');
    assert.ok(!writes.some((call) => call.key === draftKeyOf(session.state.requestId)));
  });
}

test('reject keeps the request frozen: no new packet, no revision draft, no execution', async () => {
  const { e, requestId, session, link } = await frozenWithDestination();
  await session.review(connectorReturn(link), 'reject', 'Not what I asked for.');
  const reopened = (await e.restart(requestId)).session;
  assert.equal(reopened.state.packets.length, 1);
  assert.equal(reopened.state.draft!.origin, 'continuation');
  assert.deepEqual(reopened.state.reviews.map((event) => event.decision), ['reject']);
  assert.equal(reopened.state.reviews[0]!.revisionDraftId, undefined);
  assert.equal(reopened.inbox[0]!.decision, 'reject');
  assert.equal(e.connector.sends.length, 0);
});

test('revise still links a draft and also never sends', async () => {
  const { e, session, link } = await frozenWithDestination();
  await session.review(connectorReturn(link), 'revise', 'Again');
  assert.equal(session.state.draft!.origin, 'revision');
  assert.equal(e.connector.sends.length, 0);
});

// ---------------------------------------------------------------------------
// Send fences

test('the send record is durable before transport', async () => {
  const { e, requestId, session, packet } = await frozenWithDestination();
  let durableAtTransport = false;
  const dispatch: DispatchSlot = {
    requestSend: () => { durableAtTransport = e.storage.peek('workspace', sendKey(requestId, packet.packetId)) !== null; },
  };
  assert.equal(await session.send(dispatch, packet.packetId, 'dest-1'), 'sent');
  assert.equal(durableAtTransport, true);
});

test('a send is single-use and destination-bound; a double click reaches transport once', async () => {
  const { e, session, packet } = await frozenWithDestination();
  const [first, second] = await Promise.all([
    session.send(e.connector.dispatch, packet.packetId, 'dest-1'),
    session.send(e.connector.dispatch, packet.packetId, 'dest-1'),
  ]);
  assert.deepEqual([first, second], ['sent', 'blocked']);
  assert.equal(await session.send(e.connector.dispatch, packet.packetId, 'dest-1'), 'blocked');
  assert.match(session.state.error ?? '', /single-use/u);
  assert.equal(e.connector.sends.length, 1);
});

test('a confirmation for another destination is refused and nothing is written or sent', async () => {
  const { e, requestId, session, packet } = await frozenWithDestination();
  const before = e.storage.calls.length;
  assert.equal(await session.send(e.connector.dispatch, packet.packetId, 'dest-other'), 'blocked');
  assert.match(session.state.error ?? '', /destination changed/u);
  assert.equal(e.storage.peek('workspace', sendKey(requestId, packet.packetId)), null);
  assert.deepEqual(e.storage.calls.slice(before).filter((call) => WRITE_OPS.includes(call.op)), []);
  assert.equal(e.connector.sends.length, 0);
});

test('an unassigned packet and a superseded packet cannot be sent', async () => {
  const e = env();
  const { session } = await readyDraft(e);
  const first = (await session.freeze())!;
  assert.equal(await session.send(e.connector.dispatch, first.packetId, 'dest-1'), 'blocked');
  assert.match(session.state.error ?? '', /Choose a destination/u);

  session.edit({ type: 'set-destination', destination: { kind: 'existing-thread', destinationId: 'dest-1', label: 'Fixture thread' } });
  const second = (await session.freeze())!;
  assert.equal(await session.send(e.connector.dispatch, first.packetId, 'dest-1'), 'blocked');
  assert.match(session.state.error ?? '', /current packet/u);
  assert.equal(await session.send(e.connector.dispatch, second.packetId, 'dest-1'), 'sent');
  assert.deepEqual(e.connector.sends.map((item) => item.packet.packetId), [second.packetId]);
});

test('a transport failure leaves an unknown handoff that can never be resent, across restarts', async () => {
  const { e, requestId, session, packet } = await frozenWithDestination();
  e.connector.failTransport = 'link dropped';
  assert.equal(await session.send(e.connector.dispatch, packet.packetId, 'dest-1'), 'unknown');
  assert.match(session.state.error ?? '', /unknown/u);
  const view = session.handoffView(packet.packetId, '2026-01-01T01:00:00.000Z')!;
  assert.equal(view.canSend, false);
  assert.ok(view.blockers.some((reason) => /do not resend/u.test(reason)));

  e.connector.failTransport = null;
  assert.equal(await session.send(e.connector.dispatch, packet.packetId, 'dest-1'), 'blocked');
  const reopened = (await e.restart(requestId)).session;
  assert.equal(reopened.handoffView(packet.packetId, '2026-01-01T01:00:00.000Z')?.state, 'unknown', 'a lost transport result reads as unknown, never not-sent');
  assert.equal(await reopened.send(e.connector.dispatch, packet.packetId, 'dest-1'), 'blocked');
  assert.equal(e.connector.sends.length, 1, 'exactly the one original transport attempt');
});

test('a connector status of unknown also blocks any resend', async () => {
  const { e, session, packet, link } = await frozenWithDestination();
  await session.send(e.connector.dispatch, packet.packetId, 'dest-1');
  e.connector.set(link, 'unknown', { detail: 'Receipt not confirmed.' });
  await session.refreshHandoff(e.connector.status);
  const view = session.handoffView(packet.packetId, '2026-01-01T01:00:10.000Z')!;
  assert.equal(view.state, 'unknown');
  assert.equal(view.canSend, false);
  assert.equal(await session.send(e.connector.dispatch, packet.packetId, 'dest-1'), 'blocked');
});

for (const stage of WRITE_STAGES) {
  test(`crash at ${stage} of the send record: transport is never reached unless the record is durable, and never twice`, async () => {
    const { e, requestId, session, packet } = await frozenWithDestination();
    e.storage.crashAt({ op: 'create', stage, key: (key) => key.includes('/sends/') });
    assert.equal(await session.send(e.connector.dispatch, packet.packetId, 'dest-1'), 'unknown');
    assert.equal(e.connector.sends.length, 0, 'a send whose record is not confirmed never reaches transport');
    assert.equal(session.state.unknown, true);

    const reopened = (await e.restart(requestId)).session;
    const durable = e.storage.peek('workspace', sendKey(requestId, packet.packetId)) !== null;
    assert.equal(durable, stage === 'ack');
    const result = await reopened.send(e.connector.dispatch, packet.packetId, 'dest-1');
    if (durable) {
      assert.equal(result, 'blocked', 'a durable record fences even though its transport call never ran');
      assert.equal(e.connector.sends.length, 0);
      assert.equal(reopened.handoffView(packet.packetId, '2026-01-01T01:00:00.000Z')?.state, 'unknown');
    } else {
      assert.equal(result, 'sent', 'no record means nothing happened, so the owner may send once');
      assert.equal(e.connector.sends.length, 1);
    }
  });
}

// ---------------------------------------------------------------------------
// Readback and navigation never send

function spyOn<T extends object>(target: T, touched: Set<string>): T {
  return new Proxy(target, { get(object, key, receiver) { touched.add(String(key)); return Reflect.get(object, key, receiver); } });
}

test('status and returns readback touch only read-only members and produce zero sends', async () => {
  const { e, session, packet, link } = await frozenWithDestination();
  await session.send(e.connector.dispatch, packet.packetId, 'dest-1');
  const statusTouched = new Set<string>();
  const returnsTouched = new Set<string>();
  e.connector.set(link, 'running');
  await session.refreshHandoff(spyOn<HandoffStatusPort>(e.connector.status, statusTouched));
  await session.refreshReturns(spyOn<ReturnsPort>(e.connector.returns, returnsTouched));
  assert.deepEqual([...statusTouched], ['read']);
  assert.deepEqual([...returnsTouched], ['list']);
  assert.equal(e.connector.sends.length, 1, 'only the explicit send');
  assert.ok(e.connector.statusReads.length > 0 && e.connector.returnReads.length > 0);
  // @ts-expect-error a status port is not a dispatch slot: it has no requestSend
  const notDispatch: DispatchSlot = e.connector.status;
  assert.equal(typeof (notDispatch as unknown as Record<string, unknown>).requestSend, 'undefined');
});

test('reading the inbox and handoff views never writes', async () => {
  const { e, session } = await frozenWithDestination();
  const before = e.storage.calls.length;
  void session.inbox;
  void session.handoffView(session.state.packets[0]!.packetId, '2026-01-01T01:00:00.000Z');
  assert.equal(e.storage.calls.length, before);
});

test('status readback stores the last-known value and refuses stale, regressing and foreign readings', async () => {
  const { e, requestId, session, packet, link } = await frozenWithDestination();
  await session.send(e.connector.dispatch, packet.packetId, 'dest-1');
  e.connector.set(link, 'running', {}, '2026-01-01T02:00:10.000Z');
  await session.refreshHandoff(e.connector.status);
  assert.equal(session.state.statuses[0]!.state, 'running');

  e.connector.set(link, 'queued', {}, '2026-01-01T02:00:05.000Z');
  await session.refreshHandoff(e.connector.status);
  assert.equal(session.state.statuses[0]!.state, 'running', 'an older reading does not roll status back');
  assert.match(session.state.readbackNotes.join(' '), /older than the stored status/u);

  e.connector.set(link, 'returned', {}, '2026-01-01T02:00:20.000Z');
  await session.refreshHandoff(e.connector.status);
  e.connector.set(link, 'running', {}, '2026-01-01T02:00:30.000Z');
  await session.refreshHandoff(e.connector.status);
  assert.equal(session.state.statuses[0]!.state, 'returned', 'a terminal state is not reopened');
  assert.match(session.state.readbackNotes.join(' '), /terminal state returned/u);

  const foreign: PacketLink = { packetId: packet.packetId, authoringDigest: `sha256:${'0'.repeat(64)}` as never };
  e.connector.set(foreign, 'queued');
  const rejected = e.connector.rawStatus(foreign)!;
  const port: HandoffStatusPort = { read: async () => rejected };
  await session.refreshHandoff(port);
  assert.match(session.state.readbackNotes.join(' '), /does not match a frozen packet/u);

  const stored = JSON.parse(new TextDecoder().decode(e.storage.peek('workspace', handoffKey(requestId, packet.packetId))!));
  assert.equal(stored.state, 'returned');
});

test('status freshness compares instants, with and without fractional seconds', async () => {
  const newer = await frozenWithDestination();
  await newer.session.send(newer.e.connector.dispatch, newer.packet.packetId, 'dest-1');
  newer.e.connector.set(newer.link, 'running', {}, '2026-01-01T02:00:00Z');
  await newer.session.refreshHandoff(newer.e.connector.status);
  newer.e.connector.set(newer.link, 'returned', {}, '2026-01-01T02:00:00.500Z');
  await newer.session.refreshHandoff(newer.e.connector.status);
  assert.equal(newer.session.state.statuses[0]!.state, 'returned', 'a later reading with fractional seconds is accepted');

  const older = await frozenWithDestination();
  await older.session.send(older.e.connector.dispatch, older.packet.packetId, 'dest-1');
  older.e.connector.set(older.link, 'running', {}, '2026-01-01T02:00:00.500Z');
  await older.session.refreshHandoff(older.e.connector.status);
  older.e.connector.set(older.link, 'queued', {}, '2026-01-01T02:00:00Z');
  await older.session.refreshHandoff(older.e.connector.status);
  assert.equal(older.session.state.statuses[0]!.state, 'running', 'an earlier reading without fractional seconds is refused');
  assert.match(older.session.state.readbackNotes.join(' '), /older than the stored status/u);
});

test('a failing or malformed status read keeps the last-known status and reports why', async () => {
  const { e, session, packet, link } = await frozenWithDestination();
  await session.send(e.connector.dispatch, packet.packetId, 'dest-1');
  e.connector.set(link, 'queued');
  await session.refreshHandoff(e.connector.status);
  await session.refreshHandoff({ read: async () => { throw new Error('connector offline'); } });
  assert.match(session.state.readbackNotes.join(' '), /connector offline/u);
  assert.equal(session.state.statuses[0]!.state, 'queued');
  await session.refreshHandoff({ read: async () => ({ schema: 'hq.design.request-handoff-status/v1', state: 'queued' }) as never });
  assert.match(session.state.readbackNotes.join(' '), /rejected/u);
  assert.equal(session.state.statuses[0]!.state, 'queued');
});

test('host and model variance is computed only from reported values, with no fallback', async () => {
  const { e, session, packet, link } = await frozenWithDestination();
  await session.send(e.connector.dispatch, packet.packetId, 'dest-1');
  const at = '2026-01-01T01:00:05.000Z';
  e.connector.set(link, 'running', { actual: { host: 'fixture-host-b' } });
  await session.refreshHandoff(e.connector.status);
  const view = session.handoffView(packet.packetId, at)!;
  assert.deepEqual(view.variance, { host: 'differs', model: 'unreported', varies: true });
  assert.equal(view.status?.actual?.model, undefined, 'a missing model is never filled from the pin');
});

test('a stale non-terminal status is flagged and a terminal one is not', async () => {
  const { e, session, packet, link } = await frozenWithDestination();
  await session.send(e.connector.dispatch, packet.packetId, 'dest-1');
  e.connector.set(link, 'running', {}, '2026-01-01T01:00:00.000Z');
  await session.refreshHandoff(e.connector.status);
  assert.equal(session.handoffView(packet.packetId, '2026-01-01T01:00:30.000Z')?.freshness, 'fresh');
  assert.equal(session.handoffView(packet.packetId, '2026-01-01T01:05:00.000Z')?.freshness, 'stale');
  e.connector.set(link, 'returned', {}, '2026-01-01T01:00:40.000Z');
  await session.refreshHandoff(e.connector.status);
  assert.equal(session.handoffView(packet.packetId, '2026-01-01T03:00:00.000Z')?.freshness, 'fresh');
});

// ---------------------------------------------------------------------------
// Returned inbox

test('the inbox skips invalid or foreign returns, never overwrites, and refuses owner-reported items from the port', async () => {
  const { e, session, link } = await frozenWithDestination();
  const good = connectorReturn(link, 'cand-good');
  e.connector.publishReturn(good);
  e.connector.publishReturn({ ...good, candidateId: 'cand-bad', extra: true });
  e.connector.publishReturn(connectorReturn({ packetId: link.packetId, authoringDigest: `sha256:${'1'.repeat(64)}` as never }, 'cand-foreign'));
  e.connector.publishReturn({ ...versionless(link, 'cand-claims-owner'), provenance: { origin: 'owner-reported' }, observedStatus: 'owner-reported' });
  await session.refreshReturns(e.connector.returns);
  assert.deepEqual(session.state.candidates.map((item) => item.candidateId), ['cand-good']);
  assert.equal(session.state.readbackNotes.length, 3);
  assert.match(session.state.readbackNotes.join(' '), /owner-reported returns are recorded by the owner/u);

  await session.refreshReturns(e.connector.returns);
  assert.equal(session.state.candidates.length, 1, 'ingestion is idempotent');
  const changed = { ...good, observedStatus: 'changed' };
  const second = { list: async () => [changed] };
  await session.refreshReturns(second);
  assert.match(session.state.readbackNotes.join(' '), /different candidate with this id/u);
});

test('inbox order is newest first and tracks the latest decision per candidate', async () => {
  const { e, session, link } = await frozenWithDestination();
  const older = { ...connectorReturn(link, 'cand-old'), observedAt: '2026-01-01T00:00:00.000Z' };
  const newer = { ...connectorReturn(link, 'cand-new'), observedAt: '2026-01-02T00:00:00.000Z' };
  e.connector.publishReturn(older);
  e.connector.publishReturn(newer);
  await session.refreshReturns(e.connector.returns);
  await session.review(older, 'defer');
  await session.review(older, 'reject');
  const items = inboxOf(session.state.candidates, session.state.reviews);
  assert.deepEqual(items.map((item) => [item.candidate.candidateId, item.decision]), [['cand-new', null], ['cand-old', 'reject']]);
});

test('inbox order compares instants, with and without fractional seconds', async () => {
  const { e, session, link } = await frozenWithDestination();
  e.connector.publishReturn({ ...connectorReturn(link, 'cand-whole'), observedAt: '2026-01-02T00:00:00Z' });
  e.connector.publishReturn({ ...connectorReturn(link, 'cand-later'), observedAt: '2026-01-02T00:00:00.500Z' });
  e.connector.publishReturn({ ...connectorReturn(link, 'cand-tie'), observedAt: '2026-01-02T00:00:00.000Z' });
  await session.refreshReturns(e.connector.returns);
  const items = inboxOf(session.state.candidates, session.state.reviews);
  assert.deepEqual(items.map((item) => item.candidate.candidateId), ['cand-later', 'cand-tie', 'cand-whole'], 'equal instants fall back to candidate id');
});

test('a return without a comparable version is stored, listed and reviewable without inventing a version', async () => {
  const { e, requestId, session, link } = await frozenWithDestination();
  const bare = versionless(link);
  e.connector.publishReturn(bare);
  await session.refreshReturns(e.connector.returns);
  const item = session.inbox[0]!;
  assert.equal(item.versionless, true);
  assert.equal(item.candidate.candidateVersionId, null);
  assert.ok(await session.review(bare, 'revise', 'Use these artifacts.'));
  const added = session.state.draft!.evidence.find((entry) => entry.evidenceId === `candidate.${bare.candidateId}`)!;
  assert.equal(added.versionId, undefined, 'no version is invented for the carried evidence');
  const reopened = (await e.restart(requestId)).session;
  assert.equal(reopened.state.candidates[0]!.candidateVersionId, null);
});

test('revise rebuilds the same draft after an interrupted write for a versionless return', async () => {
  const { e, requestId, session, link } = await frozenWithDestination();
  const bare = versionless(link);
  e.storage.crashAt({ op: 'write', stage: 'rename', key: (key) => key === draftKeyOf(requestId) });
  const event = (await session.review(bare, 'revise', 'Again'))!;
  const reopened = (await e.restart(requestId)).session;
  assert.equal(reopened.state.draft!.draftId, event.revisionDraftId);
  assert.match(reopened.state.recovered.join(' '), /interrupted revise/u);
});
