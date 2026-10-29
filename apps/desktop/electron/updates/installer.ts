import type { PreparedCandidate, UpdateArchitecture, UpdateChannel } from '@hq/contracts/updates';
import { verifyNativeBundle, type BundleVerifier } from './archive.js';
import { UpdateFailure } from './contract.js';
import { discover } from './discovery.js';
import { verifyProvenance, type ProvenanceVerifier } from './provenance.js';
import { createReleaseStorage } from './storage.js';
import { nodeTransport, type Transport } from './transport.js';

export interface ReleaseRequest {
  readonly stateRoot: string;
  readonly channel: UpdateChannel;
  readonly architecture: UpdateArchitecture;
}

// This entry belongs to an independently authenticated installer, never the renderer or the no-record host.
export async function prepareRelease(request: ReleaseRequest, adapters: {
  platform?: string;
  transport?: Transport;
  verifyProvenance?: ProvenanceVerifier;
  verifyBundle?: BundleVerifier;
  signal?: AbortSignal;
} = {}): Promise<PreparedCandidate> {
  if ((adapters.platform ?? process.platform) !== 'darwin') throw new UpdateFailure('unavailable');
  if (!['preview', 'stable'].includes(request.channel) || !['arm64', 'x64'].includes(request.architecture)) throw new UpdateFailure('invalid');
  const transport = adapters.transport ?? nodeTransport, verify = adapters.verifyProvenance ?? verifyProvenance;
  const signal = adapters.signal ? AbortSignal.any([adapters.signal, AbortSignal.timeout(10 * 60 * 1000)]) : AbortSignal.timeout(10 * 60 * 1000);
  const storage = createReleaseStorage(request.stateRoot, transport, verify, adapters.verifyBundle ?? verifyNativeBundle);
  await storage.initialize();
  const candidate = await discover({ installed: null, record: null, fresh: true, channel: request.channel, architecture: request.architecture, transport, verify, cachePath: storage.trustCache, signal });
  if (!candidate) throw new UpdateFailure('unavailable');
  return storage.prepare(candidate, signal, () => {}, () => {});
}
