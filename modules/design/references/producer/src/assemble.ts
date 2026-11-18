import type { BlobDigest } from '../../src/contract.ts';
import { availabilityLabel } from '../../src/graph-ops.ts';
import { ReferenceGraph } from '../../src/graph-service.ts';
import { canonicalize } from '../../src/jcs.ts';
import type { ReferencePacket } from '../../src/packet.ts';
import { parsePacket } from '../../src/packet.ts';
import { fail } from './errors.ts';
import type { SourceRead } from './gallery.ts';
import { ProducerMemoryStorage, producerClock } from './memory-storage.ts';

export interface AssembledSource {
  readonly internal: ReferencePacket;
  readonly publishable: ReferencePacket;
  /** Bytes for every blob the internal packet names that was actually read. */
  readonly blobs: ReadonlyMap<BlobDigest, Uint8Array>;
  readonly counts: Readonly<Record<string, number>>;
}

/**
 * Imports the read trees into an in-memory graph and exports deterministic `internal` and
 * `publishable` packets. Both are re-validated through the accepted packet reader after a JSON
 * round trip, and exporting twice must give the same digest. A source with no captures yields null.
 */
export async function assemble(read: SourceRead): Promise<AssembledSource | null> {
  const storage = new ProducerMemoryStorage();
  const graph = await ReferenceGraph.open({ storage, clock: producerClock });
  for (const tree of read.trees) {
    const outcome = await graph.importTree(tree);
    if (!outcome.ok) {
      read.tally.add('entries-rejected');
      for (const issue of outcome.issues) read.tally.add(`rejected:${issue.code}`);
    }
  }
  const captures = Object.values(graph.state.captures);
  if (captures.length === 0) return null;

  const exported = async (mode: 'internal' | 'publishable'): Promise<ReferencePacket> => {
    const result = await graph.exportPacket({ mode });
    if (!result.ok) return fail('packet-export-failed');
    const again = await graph.exportPacket({ mode });
    if (!again.ok || again.value.packet.packetDigest !== result.value.packet.packetDigest) return fail('packet-not-deterministic');
    const reread = await parsePacket(JSON.parse(canonicalize(result.value.packet)) as unknown);
    if (reread.status !== 'ok' || reread.packet.packetDigest !== result.value.packet.packetDigest) return fail('packet-invalid');
    return reread.packet;
  };
  const internal = await exported('internal');
  const publishable = await exported('publishable');

  const blobs = new Map<BlobDigest, Uint8Array>();
  for (const blob of internal.blobs) {
    const held = storage.blobs.get(blob.digest);
    if (held !== undefined) blobs.set(blob.digest, held.bytes);
  }
  const counts: Record<string, number> = {
    trees: read.trees.length, subjects: internal.subjects.length, captures: internal.captures.length, anchors: internal.anchors.length,
    blobsNamed: internal.blobs.length, blobsHeld: blobs.size,
    publishableCaptures: publishable.captures.length, publishableExcluded: publishable.excluded.length,
  };
  for (const capture of internal.captures) {
    const status = capture.rights.private ? 'private' : capture.rights.effective;
    counts[`rights:${status}`] = (counts[`rights:${status}`] ?? 0) + 1;
  }
  for (const capture of captures) {
    const label = availabilityLabel(capture.availability);
    counts[`availability:${label}`] = (counts[`availability:${label}`] ?? 0) + 1;
  }
  for (const entry of publishable.excluded) counts[`excluded:${entry.reason}`] = (counts[`excluded:${entry.reason}`] ?? 0) + 1;
  return { internal, publishable, blobs, counts };
}
