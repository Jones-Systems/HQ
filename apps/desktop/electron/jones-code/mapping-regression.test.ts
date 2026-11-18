import { expect, it, vi } from 'vitest';
import { createReceiver, type Binding, type Ledger } from './receiver';
import type { JonesHandoff } from '@hq/contracts/jones-code';
it('refuses malformed authoritative no-effect from lookup and fence', async () => {
  const identity = { hostId: 'host', receiverId: 'receiver', fingerprint: 'fp' } as Binding['identity'];
  const handoff = { schema: 'hq.design.handoff/v1', dispatchId: 'dispatch', attemptId: 'attempt', idempotencyKey: 'attempt', packet: { packetId: 'packet', packetDigest: `sha256:${'a'.repeat(64)}` }, packetBody: {}, destination: { destinationId: 'destination', ...identity, threadRef: null, model: null }, fallback: 'forbidden', confirmedAt: '2026-01-01T00:00:00.000Z' } as JonesHandoff;
  let ledger: Ledger = {};
  const call = vi.fn(async (): Promise<unknown> => ({ threadId: 'created', projectId: 'project', modelSelection: { instanceId: 'provider', model: 'model' }, runId: 'run', status: 'running', initialMessage: 'accepted', preparation: 'left_preparation' }));
  const receiver = createReceiver({ binding: async () => ({ locator: 'destination', label: 'Fixture', mode: 'new-thread', projectId: 'project', identity, model: null }), client: async () => ({ call }), sessionLabel: async () => 'session', ledger: { read: async () => ledger, write: async value => { ledger = value; } } });
  await receiver.send('destination', handoff);
  call.mockResolvedValue({ clientRequestId: 'attempt', state: 'no_effect', basis: 'fence' });
  expect(await receiver.lookup('destination', 'attempt')).toMatchObject({ kind: 'unavailable' });
  expect(await receiver.fence('destination', 'attempt')).toMatchObject({ kind: 'unavailable' });
});
