import type { BlobDigest, ReferenceStoragePort } from '../../../references/src/contract.ts';
import { ReferenceGraph } from '../../../references/src/graph-service.ts';
import { ReferenceLibrary } from '../../../references/src/service.ts';
import { isOpaqueId } from '../../../references/src/provenance.ts';
import type { CompareSlot, SectionClock, SectionIds } from '../requests/env.ts';

export interface ReferencesEnvironmentOptions {
  readonly storage: ReferenceStoragePort;
  readonly clock: SectionClock;
  readonly ids: SectionIds;
  readonly compareSlot: CompareSlot;
  /** The production host supplies () => null until a qualified blob route exists. */
  readonly previewUrl: (digest: BlobDigest) => string | null;
}

export interface ReferencesEnvironment {
  readonly library: ReferenceLibrary;
  readonly graph: ReferenceGraph;
  readonly compareSlot: CompareSlot;
  readonly previewUrl: (digest: BlobDigest) => string | null;
}

export async function createReferencesEnvironment(options: ReferencesEnvironmentOptions): Promise<ReferencesEnvironment> {
  const ids = {
    label: options.ids.label,
    next(prefix: 'col' | 'use') {
      const raw = options.ids.next(prefix);
      const id = raw.startsWith(`${prefix}_`) ? raw : `${prefix}_${raw}`;
      if (!isOpaqueId(id, prefix)) throw new Error(`Invalid ${prefix} ID from injected source.`);
      return id;
    },
  };
  return {
    library: await ReferenceLibrary.open({ ...options, ids }),
    graph: await ReferenceGraph.open(options),
    compareSlot: options.compareSlot,
    previewUrl: options.previewUrl,
  };
}
