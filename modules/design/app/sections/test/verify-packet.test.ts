import assert from 'node:assert/strict';
import test from 'node:test';
import { toConnectorPacket, verifyPacket } from '../runs/verify-packet.ts';
import { frozen } from './doubles.ts';

test('strict T6→T12 verification accepts the frozen packet and rejects body, digest, id and schema tampering', async () => {
  const { packet } = await frozen();
  const wire = await toConnectorPacket(packet);
  assert.equal(await verifyPacket(wire), true);
  assert.equal(await verifyPacket({ ...wire, body: { ...packet, intent: 'tampered' } }), false);
  assert.equal(await verifyPacket({ ...wire, packetDigest: `sha256:${'0'.repeat(64)}` }), false);
  assert.equal(await verifyPacket({ ...wire, packetId: 'wrong-id' as never }), false);
  assert.equal(await verifyPacket({ ...wire, body: { ...packet, schema: 'future' } }), false);
  assert.equal(await verifyPacket({ ...wire, body: null }), false);
  await assert.rejects(() => toConnectorPacket({ ...packet, intent: 'tampered' }));
});

test('controller cannot bypass the strict verifier with an outer packet mismatch', async () => {
  const { d, runs, packet } = await frozen();
  const wire = await toConnectorPacket(packet);
  await runs.controller.setPacket({ ...wire, body: { ...packet, title: 'tampered' } });
  runs.controller.requestSend();
  const result = await runs.controller.confirm();
  assert.equal(result?.outcome, 'refused');
  assert.deepEqual(d.writes, []);
});
