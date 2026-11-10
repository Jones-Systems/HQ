import type { PacketInput } from '../../../connector/src/outbox.ts';
import { isDigest } from '../../../connector/src/canonical.ts';
import { verifyPacket as verifyRequestPacket } from '../../../requests/src/packet.ts';

/** T6 hashes the authoring body, excluding its digest; T12's default hashes the whole body. */
export async function verifyPacket(packet: PacketInput): Promise<boolean> {
  try {
    const body = await verifyRequestPacket(packet.body);
    return body.packetId === packet.packetId && body.authoringDigest === packet.packetDigest;
  } catch {
    return false;
  }
}

export async function toConnectorPacket(value: unknown): Promise<PacketInput> {
  const body = await verifyRequestPacket(value);
  if (!isDigest(body.authoringDigest)) throw new Error('Invalid authoring digest.');
  return { packetId: body.packetId, packetDigest: body.authoringDigest, body };
}
