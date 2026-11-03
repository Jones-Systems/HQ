import {
  PACKET_SCHEMA,
  type DecisionPacket, type DecisionPacketBody, type PacketId, type RequestDraft,
} from './contract.ts';
import { linkOf } from './draft.ts';
import { digestOf } from './jcs.ts';
import { ValidationError, parsePacket } from './validate.ts';

export function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const item of Object.values(value)) deepFreeze(item);
  }
  return value;
}

/** Digest scope: every packet field except the digest itself (RFC 8785, SHA-256). */
export function authoringBody(packet: DecisionPacket | DecisionPacketBody): DecisionPacketBody {
  const { authoringDigest: _digest, ...body } = packet as DecisionPacket;
  return body;
}

/**
 * Builds the immutable `hq.design.decision-packet/v1` for a draft. `parent` is
 * the request's current head packet; the caller checks freeze blockers first.
 */
export async function buildPacket(draft: RequestDraft, packetId: PacketId, frozenAt: string, parent: DecisionPacket | null): Promise<DecisionPacket> {
  const firstSource = draft.sources[0];
  if (!firstSource) throw new ValidationError('draft.sources', 'a packet needs at least one source');
  const parentLink = parent ? linkOf(parent) : null;
  const body: DecisionPacketBody = {
    schema: PACKET_SCHEMA, packetId, projectId: firstSource.projectId, frozenAt,
    lineage: {
      requestId: draft.requestId, sequence: parent ? parent.lineage.sequence + 1 : 1,
      rootPacketId: parent ? parent.lineage.rootPacketId : packetId, parent: parentLink, origin: draft.origin,
      draft: { draftId: draft.draftId, revision: draft.revision }, review: draft.review,
    },
    // The packet replaces its parent as the request's current decision.
    supersedes: parentLink,
    title: draft.title, intent: draft.intent, sources: draft.sources, annotations: draft.annotations, evidence: draft.evidence,
    clarifications: draft.clarifications, destination: draft.destination,
    attachments: draft.attachments.filter((item) => item.selected)
      .map(({ attachmentId, blobDigest, mediaType, bytes, label }) => ({ attachmentId, blobDigest, mediaType, bytes, label })),
  };
  const packet = parsePacket({ ...body, authoringDigest: await digestOf(body) });
  return deepFreeze(packet);
}

/** Strict parse plus digest verification. A mismatched digest is rejected, never repaired. */
export async function verifyPacket(value: unknown): Promise<DecisionPacket> {
  const packet = parsePacket(value);
  if (await digestOf(authoringBody(packet)) !== packet.authoringDigest) throw new ValidationError('packet.authoringDigest', 'digest mismatch');
  return deepFreeze(packet);
}
