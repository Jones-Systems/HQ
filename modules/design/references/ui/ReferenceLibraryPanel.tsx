import { useCallback, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react';
import type { AssetRef, BlobDigest, CollectionId, ReferenceId } from '../src/contract.ts';
import type { ReferenceLibrary } from '../src/service.ts';
import { ReferenceLibraryView } from './ReferenceLibraryView.tsx';
import type { ProjectRef, ViewSelection } from './view-model.ts';
import { buildLibraryView } from './view-model.ts';

export interface ReferenceLibraryPanelProps {
  /** Opened by root with qualified (or explicitly labelled fake) ports. */
  readonly library: ReferenceLibrary;
  readonly currentProject: ProjectRef | null;
  readonly previewUrl: (digest: BlobDigest) => string | null;
  readonly previewImage?: ((asset: AssetRef) => Promise<string | null>) | null;
  readonly importControls?: (disabled: boolean) => ReactNode;
  readonly onShowProjects?: () => void;
  /** Optional sink for failed mutations; defaults to ignoring them. */
  readonly onError?: (code: string) => void;
}

/** Connects the library service to the view. Selection and query are view-local state. */
export function ReferenceLibraryPanel({ library, currentProject, previewUrl, previewImage, importControls, onShowProjects, onError }: ReferenceLibraryPanelProps) {
  const subscribe = useCallback((listener: () => void) => library.subscribe(listener), [library]);
  const readState = () => library.state;
  const readAccess = () => library.access;
  const state = useSyncExternalStore(subscribe, readState, readState);
  const access = useSyncExternalStore(subscribe, readAccess, readAccess);
  const [selection, setSelection] = useState<ViewSelection>({ query: '', collectionId: null, selectedId: null });
  const view = useMemo(() => buildLibraryView(state, access, selection, currentProject), [state, access, selection, currentProject]);
  const [previews, setPreviews] = useState<ReadonlyMap<BlobDigest, string>>(new Map());
  const shownIds = view.cards.map((card) => card.id).join('|');
  const assets = useMemo(() => [selection.selectedId ?? '', ...shownIds.split('|')]
    .flatMap((id) => state.references[id]?.asset ?? []), [shownIds, state, selection.selectedId]);
  useEffect(() => {
    let active = true;
    setPreviews(new Map());
    if (!previewImage) return;
    // Each mounted library owns a bounded, transient cache. No data URLs enter stored metadata.
    void (async () => {
      let used = 0;
      const loaded = new Map<BlobDigest, string>();
      for (const asset of assets) {
        if (!active) return;
        if (loaded.has(asset.digest) || loaded.size >= 24 || asset.bytes > 32 * 1024 * 1024 - used) continue;
        const src = await previewImage(asset);
        if (!active) return;
        if (src !== null) { used += asset.bytes; loaded.set(asset.digest, src); setPreviews(new Map(loaded)); }
      }
    })();
    return () => { active = false; };
  }, [assets, previewImage]);
  const report = (result: Promise<{ ok: boolean; code?: string }>) => {
    void result.then((outcome) => { if (!outcome.ok && outcome.code !== undefined) onError?.(outcome.code); });
  };
  return <ReferenceLibraryView view={view} previewUrl={previewImage ? (digest) => previews.get(digest) ?? null : previewUrl}
    importControls={importControls?.(!view.canEdit)} onShowProjects={onShowProjects}
    onQueryChange={(query) => setSelection((current) => ({ ...current, query }))}
    onSelectCollection={(collectionId: CollectionId | null) => setSelection((current) => ({ ...current, collectionId }))}
    onSelectReference={(selectedId: ReferenceId | null) => setSelection((current) => ({ ...current, selectedId }))}
    onCreateCollection={(name) => report(library.createCollection(name))}
    onDeleteCollection={(id) => report(library.deleteCollection(id))}
    onUseInProject={(id) => { if (currentProject !== null) report(library.useInProject(id, currentProject.id)); }}
    onReload={() => { void library.reload(); }} />;
}
