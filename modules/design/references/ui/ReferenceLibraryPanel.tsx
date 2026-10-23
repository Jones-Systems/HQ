import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
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
  const requested = [...new Set([...view.cards.map((card) => card.id), ...(selection.selectedId ? [selection.selectedId] : [])])]
    .sort().flatMap((id) => state.references[id]?.asset ? [{ id, asset: state.references[id]!.asset! }] : []);
  const mediaIdentity = JSON.stringify(requested);
  // Selection and metadata edits do not invalidate media. Include every validated asset field.
  const assets = useMemo(() => requested, [mediaIdentity]);
  const cache = useRef(new Map<string, { result: string | null | undefined; promise: Promise<string | null> }>());
  const provider = useRef(previewImage);
  const previous = useRef(new Map<ReferenceId, string>());
  const [previews, setPreviews] = useState<ReadonlyMap<BlobDigest, string | null>>(new Map());
  useEffect(() => {
    let active = true;
    if (provider.current !== previewImage) {
      cache.current.clear(); previous.current.clear(); provider.current = previewImage;
    }
    if (!previewImage) { setPreviews(new Map()); return; }
    const wanted = new Map<string, AssetRef>();
    let used = 0;
    for (const { asset } of assets) {
      const key = JSON.stringify(asset);
      if (wanted.has(key) || wanted.size >= 24 || asset.bytes > 32 * 1024 * 1024 - used) continue;
      wanted.set(key, asset); used += asset.bytes;
    }
    for (const key of cache.current.keys()) if (!wanted.has(key)) cache.current.delete(key);
    for (const id of previous.current.keys()) if (!assets.some((item) => item.id === id)) previous.current.delete(id);
    const publish = () => {
      if (!active) return;
      const next = new Map<BlobDigest, string | null>();
      for (const { id, asset } of assets) {
        const entry = cache.current.get(JSON.stringify(asset));
        const src = entry?.result === undefined && entry ? previous.current.get(id) ?? null : entry?.result ?? null;
        next.set(asset.digest, src);
        if (src !== null) previous.current.set(id, src);
        else if (entry?.result !== undefined || !entry) previous.current.delete(id);
      }
      setPreviews(next);
    };
    for (const [key, asset] of wanted) {
      if (!cache.current.has(key)) {
        const entry = { result: undefined as string | null | undefined, promise: Promise.resolve().then(() => previewImage(asset)).catch(() => null) };
        entry.promise = entry.promise.then((src) => { entry.result = src; return src; });
        cache.current.set(key, entry);
      }
      void cache.current.get(key)!.promise.then(publish);
    }
    publish();
    return () => { active = false; };
  }, [assets, previewImage]);
  const lookup = (digest: BlobDigest) => {
    if (provider.current !== previewImage) return null;
    if (previews.has(digest)) return previews.get(digest) ?? null;
    const item = assets.find((item) => item.asset.digest === digest);
    return item ? previous.current.get(item.id) ?? null : null;
  };
  const report = (result: Promise<{ ok: boolean; code?: string }>) => {
    void result.then((outcome) => { if (!outcome.ok && outcome.code !== undefined) onError?.(outcome.code); });
  };
  return <ReferenceLibraryView view={view} previewUrl={previewImage ? lookup : previewUrl}
    importControls={importControls?.(!view.canEdit)} onShowProjects={onShowProjects}
    onQueryChange={(query) => setSelection((current) => ({ ...current, query }))}
    onSelectCollection={(collectionId: CollectionId | null) => setSelection((current) => ({ ...current, collectionId }))}
    onSelectReference={(selectedId: ReferenceId | null) => setSelection((current) => ({ ...current, selectedId }))}
    onCreateCollection={(name) => report(library.createCollection(name))}
    onDeleteCollection={(id) => report(library.deleteCollection(id))}
    onUseInProject={(id) => { if (currentProject !== null) report(library.useInProject(id, currentProject.id)); }}
    onReload={() => { void library.reload(); }} />;
}
