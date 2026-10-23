import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { NavigationIntent, NavigationPort } from '../src/contract.ts';
import { navigate } from '../src/intents.ts';
import { ValidationError } from '../src/validate.ts';
import { frozenWithDestination } from './fixtures.ts';

function portSpy() {
  const received: NavigationIntent[] = [];
  const port: NavigationPort = { navigate: (intent) => { received.push(intent); } };
  return { port, received };
}

test('every navigation intent reaches the shell and produces zero sends and zero writes', async () => {
  const { e, requestId, packet, link } = await frozenWithDestination();
  const { port, received } = portSpy();
  const before = e.storage.calls.length;
  const intents = [
    { type: 'open-request', requestId },
    { type: 'open-packet', requestId, packetId: packet.packetId },
    { type: 'open-returned', requestId, candidateId: 'cand-1' },
    { type: 'open-runs', requestId },
  ];
  for (const intent of intents) navigate(port, intent);
  assert.deepEqual(received, intents);
  assert.equal(e.connector.sends.length, 0);
  assert.equal(e.dispatch.calls.length, 0);
  assert.equal(e.storage.calls.length, before, 'navigation touches no storage at all');
  assert.equal(e.connector.statusReads.length + e.connector.returnReads.length, 0, 'and reads no status either');
  assert.ok(link);
});

test('an intent that carries a send, extra payload or an unknown type is refused before the shell sees it', () => {
  const { port, received } = portSpy();
  const bad: unknown[] = [
    { type: 'send-packet', requestId: 'r', packetId: 'p' },
    { type: 'open-packet', requestId: 'r', packetId: 'p', send: true },
    { type: 'open-request', requestId: 'r', destinationId: 'd' },
    { type: 'open-runs' },
    { type: 'open-returned', requestId: 'r' },
    { requestId: 'r' },
    null,
    'open-request',
  ];
  for (const intent of bad) assert.throws(() => navigate(port, intent), ValidationError);
  assert.deepEqual(received, []);
});

test('the navigation port is structurally unable to dispatch', () => {
  const { port } = portSpy();
  assert.deepEqual(Object.keys(port), ['navigate']);
});
