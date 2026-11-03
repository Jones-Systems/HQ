import { expect, it, vi } from 'vitest';
import { createReceiver, type Binding, type Ledger } from './receiver';
import type { JonesHandoff } from '@hq/contracts/jones-code';
const identity = { hostId: 'host', receiverId: 'receiver', fingerprint: 'fp' } as Binding['identity'];
const handoff = { schema: 'hq.design.handoff/v1', dispatchId: 'dispatch', attemptId: 'attempt', idempotencyKey: 'attempt', packet: { packetId: 'packet', packetDigest: `sha256:${'a'.repeat(64)}` }, packetBody: { proposal: 'Change the heading' }, destination: { destinationId: 'destination', ...identity, threadRef: null, model: null }, fallback: 'forbidden', confirmedAt: '2026-01-01T00:00:00.000Z' } as JonesHandoff;
const launchReply = (extra: Record<string, unknown> = {}) => ({ threadId: 'created', projectId: 'project-private', modelSelection: { instanceId: 'provider', model: 'model' }, runId: 'run', status: 'running', initialMessage: 'accepted', preparation: 'left_preparation', ...extra });
const lookupReply = (extra: Record<string, unknown> = {}) => {
  const launched = extra.state === 'launched', claimed = extra.claimed === true;
  return { clientRequestId: 'attempt', state: 'absent', basis: launched ? 'receipt' : 'none', threadId: launched ? 'created' : null, requestDigest: claimed ? 'a'.repeat(64) : null, claimed, threadDeleted: false, initialMessage: 'unknown', runId: null, runStatus: null, preparation: 'not_applicable', workspace: null, reason: null, ...extra };
};
function fixture(mode: Binding['mode'] = 'new-thread') {
  let ledger: Ledger = {}, session = 'session-a', failWrite = false;
  const binding: Binding = { locator: 'destination', label: 'Fixture', mode, projectId: 'project-private', ...(mode === 'existing-thread' ? { threadId: 'thread-private' } : {}), identity, model: null };
  const call = vi.fn(async (tool: string, _params: Record<string, unknown>): Promise<unknown> => {
    if (tool === 't3_thread_read') return { thread: { threadId: 'thread-private' }, items: [], recentRuns: [], hasMore: false };
    if (tool === 't3_queue_list') return { items: [], nextCursor: null };
    return launchReply();
  });
  const receiver = createReceiver({ binding: async () => binding, client: async () => ({ call }), sessionLabel: async () => session, ledger: { read: async () => ledger, write: async value => { if (failWrite) throw Error(); ledger = value; } }, now: () => '2026-01-01T00:00:01.000Z' });
  return { receiver, call, ledger: () => ledger, session: (value: string) => { session = value; }, failWrites: () => { failWrite = true; } };
}
it('durably reserves before exactly one keyed launch and never resends the key', async () => {
  const f = fixture();
  f.call.mockImplementation(async (_tool, args) => { expect(f.ledger().attempt).toBeDefined(); expect(args).toMatchObject({ clientRequestId: 'attempt', projectId: 'project-private', title: 'HQ handoff packet' }); expect(args).not.toHaveProperty('runtimeMode'); return launchReply(); });
  expect(await f.receiver.send('destination', handoff)).toMatchObject({ kind: 'accepted', receipt: { receiptId: 'jcl1:created', observedModel: { provider: 'provider', model: 'model' } } });
  await expect(f.receiver.send('destination', handoff)).rejects.toThrow('already reserved'); expect(f.call).toHaveBeenCalledTimes(1);
});
it.each(['not_requested', 'rejected', 'pending', 'unknown'])('holds initial message state %s', async initialMessage => {
  const f = fixture(); f.call.mockResolvedValue(launchReply({ initialMessage, preparation: 'in_progress' }));
  expect(await f.receiver.send('destination', handoff)).toMatchObject({ kind: 'held', receipt: { reason: `initialMessage=${initialMessage}; preparation=in_progress` } });
});
it.each(['invalid_request', 'capability_denied', 'runtime_mode_escalation_denied', 'interaction_mode_escalation_denied', 'request_conflict', 'launch_fenced'])('maps definite rejection %s', async code => {
  const f = fixture(); f.call.mockResolvedValue({ code }); expect(await f.receiver.send('destination', handoff)).toEqual({ kind: 'rejected', reason: code });
});
it.each([{ code: 'orchestration_error' }, { code: 'future_unknown' }, {}, { threadId: 'created', initialMessage: 'accepted' }])('throws unknown response and preserves reservation', async value => {
  const f = fixture(); f.call.mockResolvedValue(value); await expect(f.receiver.send('destination', handoff)).rejects.toThrow(); expect(f.ledger().attempt).toBeDefined();
});
it('retains an unknown after timeout without another call', async () => {
  const f = fixture(); f.call.mockRejectedValue(Error('timeout after write'));
  await expect(f.receiver.send('destination', handoff)).rejects.toThrow(); await expect(f.receiver.send('destination', handoff)).rejects.toThrow(); expect(f.call).toHaveBeenCalledTimes(1);
});
it('does not send after ledger failure or oversize', async () => {
  const f = fixture(); f.failWrites(); expect(await f.receiver.send('destination', handoff)).toMatchObject({ kind: 'rejected' }); expect(f.call).not.toHaveBeenCalled();
  expect(await fixture().receiver.send('destination', { ...handoff, packetBody: 'a'.repeat(130000) })).toMatchObject({ kind: 'rejected', reason: 'Handoff oversized' });
});
it.each([
  [{ state: 'no_effect', basis: 'rejection' }, { kind: 'no-effect', basis: 'jones:rejection' }],
  [{ state: 'absent', claimed: true }, { kind: 'not-found' }],
  [{ state: 'absent', claimed: false }, { kind: 'not-found' }],
  [{ state: 'launched', threadId: 'created', initialMessage: 'accepted', preparation: 'left_preparation', threadDeleted: true }, { kind: 'found', receipt: { status: 'held' } }],
])('maps lookup without resending', async (value, expected) => {
  const f = fixture(); await f.receiver.send('destination', handoff); f.call.mockResolvedValue(lookupReply(value));
  expect(await f.receiver.lookup('destination', 'attempt')).toMatchObject(expected); expect(f.call.mock.calls.at(-1)?.[0]).toBe('t3_thread_launch_lookup');
});
it('fences only new-thread in the original OAuth session', async () => {
  const f = fixture(); await f.receiver.send('destination', handoff); f.call.mockResolvedValue(lookupReply({ state: 'no_effect', basis: 'fence' }));
  expect(await f.receiver.fence('destination', 'attempt')).toEqual({ kind: 'no-effect', basis: 'jones:fence' });
  f.session('different'); const count = f.call.mock.calls.length;
  expect(await f.receiver.fence('destination', 'attempt')).toMatchObject({ kind: 'unavailable', detail: expect.stringContaining('session changed') });
  expect(await f.receiver.lookup('destination', 'attempt')).toMatchObject({ kind: 'unavailable' }); expect(f.call).toHaveBeenCalledTimes(count);
});
it('uses queue mode for existing threads and keeps absence nonauthoritative', async () => {
  const f = fixture('existing-thread'); f.call.mockImplementation(async tool => tool === 't3_thread_send' ? { threadId: 'thread-private', runId: 'run', messageId: 'message', status: 'queued', delivery: 'queued' } : tool === 't3_queue_list' ? { items: [], nextCursor: null } : { thread: { threadId: 'thread-private' }, items: [], recentRuns: [], hasMore: false });
  expect(await f.receiver.send('destination', handoff)).toMatchObject({ kind: 'held' });
  expect(f.call.mock.calls.find(([tool]) => tool === 't3_thread_send')?.[1]).toMatchObject({ mode: 'queue', clientRequestId: 'attempt' });
  expect(await f.receiver.lookup('destination', 'attempt')).toEqual({ kind: 'not-found' });
  const count = f.call.mock.calls.length; expect(await f.receiver.fence('destination', 'attempt')).toMatchObject({ kind: 'unavailable' }); expect(f.call).toHaveBeenCalledTimes(count);
});
it.each(['not_applicable', 'left_preparation', 'in_progress', 'unscheduled', 'unknown_effect'])('preserves preparation state %s in a held launch', async preparation => {
  const f = fixture(); f.call.mockResolvedValue(launchReply({ initialMessage: 'pending', preparation }));
  expect(await f.receiver.send('destination', handoff)).toMatchObject({ kind: 'held', receipt: { reason: `initialMessage=pending; preparation=${preparation}` } });
});
it.each(['clientRequestId', 'state', 'basis', 'threadId', 'requestDigest', 'claimed', 'threadDeleted', 'initialMessage', 'runId', 'runStatus', 'preparation', 'workspace', 'reason'])('rejects incomplete keyed state missing %s', async field => {
  const f = fixture(); await f.receiver.send('destination', handoff);
  const value: Record<string, unknown> = lookupReply({ state: 'no_effect', basis: 'fence' }); delete value[field]; f.call.mockResolvedValue(value);
  expect(await f.receiver.lookup('destination', 'attempt')).toMatchObject({ kind: 'unavailable' });
  expect(await f.receiver.fence('destination', 'attempt')).toMatchObject({ kind: 'unavailable' });
});
it('rejects contradictory no-effect and never upgrades a failed fence', async () => {
  const f = fixture(); await f.receiver.send('destination', handoff);
  f.call.mockResolvedValue(lookupReply({ state: 'no_effect', basis: 'fence', threadId: 'already-created' }));
  expect(await f.receiver.lookup('destination', 'attempt')).toMatchObject({ kind: 'unavailable' });
  f.call.mockRejectedValue(Error('timeout')); expect(await f.receiver.fence('destination', 'attempt')).toMatchObject({ kind: 'unavailable' });
  f.call.mockResolvedValue(lookupReply({ state: 'launched', initialMessage: 'accepted' }));
  expect(await f.receiver.fence('destination', 'attempt')).toMatchObject({ kind: 'found', receipt: { receiptId: 'jcl1:created' } });
});
it('maps queue markers and refuses ambiguous duplicate or overflowing observations', async () => {
  const f = fixture('existing-thread');
  const thread = { threadId: 'thread-private' };
  f.call.mockImplementation(async tool => tool === 't3_thread_send' ? { threadId: 'thread-private', runId: 'run', messageId: 'message', status: 'queued', delivery: 'queued' } : { thread, items: [], recentRuns: [], hasMore: false });
  await f.receiver.send('destination', handoff);
  const text = `HQ-HANDOFF/1 attempt ${f.ledger().attempt!.wireDigest}\n${JSON.stringify(handoff)}`;
  const item = { position: 1, sourceThreadId: 'thread-private', visibility: 'local', type: 'user_message', text, runId: 'run' };
  f.call.mockImplementation(async tool => tool === 't3_queue_list' ? { items: [{ queuedRunId: 'run', text, truncated: false }], nextCursor: null } : { thread, items: [], recentRuns: [], hasMore: false });
  expect(await f.receiver.lookup('destination', 'attempt')).toMatchObject({ kind: 'found', receipt: { status: 'held' } });
  f.call.mockImplementation(async tool => tool === 't3_queue_list' ? { items: [], nextCursor: null } : { thread, items: [item, { ...item, runId: 'different' }], recentRuns: [], hasMore: false });
  expect(await f.receiver.lookup('destination', 'attempt')).toMatchObject({ kind: 'unavailable', detail: 'Duplicate handoff markers' });
  f.call.mockResolvedValue({ thread, items: [], recentRuns: [], hasMore: true });
  expect(await f.receiver.lookup('destination', 'attempt')).toMatchObject({ kind: 'unavailable', detail: 'Timeline suffix exceeds bound' });
});
