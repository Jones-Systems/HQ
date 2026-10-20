import {
  EXPORT_SCHEMA,
  type DecisionPacket, type Digest, type ReturnedCandidate, type ReviewEvent, type StoragePort,
} from './contract.ts';
import { canonicalBytes } from './jcs.ts';
import type { RequestSnapshot } from './store.ts';

export interface ExportedBlob {
  readonly digest: Digest;
  readonly mediaType: string;
  readonly base64: string;
}

export interface OmittedStore {
  readonly store: 'drafts' | 'draft-history' | 'unselected-attachments' | 'cache' | 'sends' | 'handoff' | 'missing-blobs';
  readonly count: number;
  readonly reason: string;
}

export interface RequestsExport {
  readonly schema: typeof EXPORT_SCHEMA;
  readonly exportedAt: string;
  readonly requests: readonly {
    readonly requestId: string;
    readonly packets: readonly DecisionPacket[];
    readonly reviews: readonly ReviewEvent[];
    readonly candidates: readonly ReturnedCandidate[];
  }[];
  /** Only images explicitly selected into a frozen packet. */
  readonly blobs: readonly ExportedBlob[];
  /** Every store left out, so the omission is visible rather than silent. */
  readonly omitted: readonly OmittedStore[];
}

function base64(bytes: Uint8Array): string {
  let binary = '';
  for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  return btoa(binary);
}

/**
 * Builds the explicit export of frozen request decisions. Unsent drafts, the
 * consumed-draft history and unselected attachments never enter the output.
 */
export async function exportRequests(snapshots: readonly RequestSnapshot[], storage: StoragePort, exportedAt: string): Promise<{ bundle: RequestsExport; bytes: Uint8Array }> {
  const selected = new Map<Digest, string>();
  for (const snapshot of snapshots) for (const packet of snapshot.packets) {
    for (const attachment of packet.attachments) selected.set(attachment.blobDigest, attachment.mediaType);
  }
  const unselected = new Set<Digest>();
  for (const snapshot of snapshots) {
    for (const draft of [snapshot.draft, ...snapshot.history]) {
      for (const attachment of draft?.attachments ?? []) if (!selected.has(attachment.blobDigest)) unselected.add(attachment.blobDigest);
    }
  }
  const blobs: ExportedBlob[] = [];
  let missing = 0;
  for (const [digest, mediaType] of [...selected].sort(([a], [b]) => (a < b ? -1 : 1))) {
    const bytes = await storage.getBlob(digest);
    if (bytes) blobs.push({ digest, mediaType, base64: base64(bytes) });
    else missing += 1;
  }
  const drafts = snapshots.filter((snapshot) => snapshot.draft).length;
  const history = snapshots.reduce((count, snapshot) => count + snapshot.history.length, 0);
  const sends = snapshots.reduce((count, snapshot) => count + snapshot.sends.length, 0);
  const handoff = snapshots.reduce((count, snapshot) => count + snapshot.handoff.length, 0);
  const omitted: OmittedStore[] = [
    { store: 'drafts', count: drafts, reason: 'Unsent drafts are private and stay on this device.' },
    { store: 'draft-history', count: history, reason: 'Consumed drafts are local recovery history; their frozen content is in the packets.' },
    { store: 'unselected-attachments', count: unselected.size, reason: 'Only attachments explicitly selected into a packet are exported.' },
    { store: 'cache', count: 0, reason: 'The cache namespace is never exported.' },
    { store: 'sends', count: sends, reason: 'Send records are local fences against resending; the connector owns receipts.' },
    { store: 'handoff', count: handoff, reason: 'Handoff statuses are a local copy of connector state; the connector owns the truth.' },
  ];
  if (missing > 0) omitted.push({ store: 'missing-blobs', count: missing, reason: 'Selected images whose bytes are not stored locally.' });
  const bundle: RequestsExport = {
    schema: EXPORT_SCHEMA, exportedAt,
    requests: snapshots.filter((snapshot) => snapshot.packets.length > 0).map((snapshot) => ({
      requestId: snapshot.requestId, packets: snapshot.packets, reviews: snapshot.reviews, candidates: snapshot.candidates,
    })),
    blobs, omitted,
  };
  return { bundle, bytes: canonicalBytes(bundle) };
}
