/**
 * Explicit send confirmation. The owner's Confirm action is the execution
 * boundary; a confirmation binds the exact packet digest and destination
 * identity the owner saw, is single-use and expires.
 */

import type { Digest } from './canonical.ts';
import type { Clock } from './contract.ts';
import type { ConfirmationId, DestinationId, HostId, PacketId, ReceiverId } from './ids.ts';
import type { Destination } from './host-catalog.ts';
import { brandId } from './ids.ts';

export interface SendConfirmation {
  readonly confirmationId: ConfirmationId;
  readonly packetId: PacketId;
  readonly packetDigest: Digest;
  readonly destinationId: DestinationId;
  readonly hostId: HostId;
  readonly receiverId: ReceiverId;
  readonly fingerprint: string;
  readonly confirmedAt: string;
}

export const DEFAULT_CONFIRMATION_TTL_MS = 120_000;

export function createConfirmation(input: {
  readonly packet: { readonly packetId: PacketId; readonly packetDigest: Digest };
  readonly destination: Destination;
  readonly clock: Clock;
  readonly newId?: () => string;
}): SendConfirmation {
  const newId = input.newId ?? (() => globalThis.crypto.randomUUID());
  return {
    confirmationId: brandId('ConfirmationId', `cfm_${newId()}`),
    packetId: input.packet.packetId,
    packetDigest: input.packet.packetDigest,
    destinationId: input.destination.destinationId,
    hostId: input.destination.identity.hostId,
    receiverId: input.destination.identity.receiverId,
    fingerprint: input.destination.identity.fingerprint,
    confirmedAt: new Date(input.clock.now()).toISOString(),
  };
}
