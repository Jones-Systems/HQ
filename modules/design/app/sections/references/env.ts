import type { AssetRef, BlobDigest, ImportSource, ReferenceId, ReferenceStoragePort } from '../../../references/src/contract.ts';
import { ReferenceGraph } from '../../../references/src/graph-service.ts';
import { ReferenceLibrary } from '../../../references/src/service.ts';
import { isOpaqueId } from '../../../references/src/provenance.ts';
import { isIsoTime } from '../../../references/src/provenance.ts';
import type { CompareSlot, SectionClock, SectionIds } from '../requests/env.ts';
import { readImagePreview, readSelectedImage, type ImageDecoder, type SelectedImageFile } from './images.ts';

export interface ScreenshotDetails {
  readonly title: string;
  readonly source: ImportSource;
  readonly capturedAt?: string;
}
export type ScreenshotImportResult =
  | { readonly status: 'saved' | 'duplicate' | 'tombstoned'; readonly id: ReferenceId; readonly graphReady: boolean }
  | { readonly status: 'rejected' | 'unknown'; readonly message: string };

export interface ReferencesEnvironmentOptions {
  readonly storage: ReferenceStoragePort;
  readonly clock: SectionClock;
  readonly ids: SectionIds;
  readonly compareSlot: CompareSlot;
  /** Optional synchronous previews for isolated harnesses; production reads verified workspace bytes. */
  readonly previewUrl: (digest: BlobDigest) => string | null;
  readonly readBlob?: (digest: BlobDigest) => Promise<Uint8Array | null>;
  readonly imageDecoder?: ImageDecoder;
}

export interface ReferencesEnvironment {
  readonly library: ReferenceLibrary;
  readonly graph: ReferenceGraph;
  readonly compareSlot: CompareSlot;
  readonly previewUrl: (digest: BlobDigest) => string | null;
  readonly previewImage: ((asset: AssetRef) => Promise<string | null>) | null;
  readonly importScreenshot: (file: SelectedImageFile, details: ScreenshotDetails) => Promise<ScreenshotImportResult>;
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
  const library = await ReferenceLibrary.open({ ...options, ids });
  const graph = await ReferenceGraph.open(options);
  return {
    library, graph,
    compareSlot: options.compareSlot,
    previewUrl: options.previewUrl,
    previewImage: options.readBlob === undefined ? null : (asset) => readImagePreview(asset, options.readBlob!, options.imageDecoder),
    async importScreenshot(file, details) {
      if (details.capturedAt !== undefined && !isIsoTime(details.capturedAt)) return { status: 'rejected', message: 'Choose a valid capture date and time.' };
      let image;
      try { image = await readSelectedImage(file, options.imageDecoder); }
      catch (error) { return { status: 'rejected', message: error instanceof Error ? error.message : 'The selected image could not be read.' }; }
      let imported;
      try {
        imported = await library.importReference({ kind: 'screenshot', title: details.title.trim(), source: details.source,
          capturedAt: details.capturedAt ?? image.capturedAt, capturedBy: 'owner-judged',
          notes: details.capturedAt === undefined ? 'Imported from an owner-selected image. Capture date defaults to the file modification date.'
            : 'Imported from an owner-selected image with an owner-provided capture date.',
          asset: { bytes: image.bytes, mediaType: image.mediaType, w: image.w, h: image.h } });
      } catch { return { status: 'unknown', message: 'The save could not be confirmed. Reload the library and check for this image before importing again.' }; }
      if (imported.status === 'rejected') {
        const code = imported.issues.map((issue) => issue.code);
        if (code.includes('unknown-write-effect') || code.includes('fenced')) return { status: 'unknown', message: 'The save could not be confirmed. Reload the library before importing again.' };
        return { status: 'rejected', message: code.includes('conflict') ? 'The library changed in another window. Reload and try again.'
          : `Image not saved. Check the title and source details (${imported.issues.map((issue) => `${issue.field || 'library'}: ${issue.code}`).join(', ')}).` };
      }
      let graphReady = false;
      try {
        const adopted = await graph.adoptFlatLibrary(library.state);
        graphReady = adopted.outcomes.every((outcome) => outcome.ok) && !adopted.skipped.some((item) => item.id === imported.id);
      } catch { /* The library is already durable; a graph failure must not trigger another import. */ }
      return { status: imported.status === 'created' ? 'saved' : imported.status === 'tombstoned' ? 'tombstoned' : 'duplicate', id: imported.id, graphReady };
    },
  };
}
