import { useCallback, useMemo, useState, useSyncExternalStore } from 'react';
import type { BlobDigest, CollectionId, ReferenceId } from '../src/contract.ts';
import type { ReferenceLibrary } from '../src/service.ts';
import { ReferenceLibraryView } from './ReferenceLibraryView.tsx';
import type { ProjectRef, ViewSelection } from './view-model.ts';
import { buildLibraryView } from './view-model.ts';

export interface ReferenceLibraryPanelProps {
  /** Opened by root with qualified (or explicitly labelled fake) ports. */
  readonly library: ReferenceLibrary;
  readonly currentProject: ProjectRef | null;
  readonly previewUrl: (digest: BlobDigest) => string | null;
  /** Optional sink for failed mutations; defaults to ignoring them. */
  readonly onError?: (code: string) => void;
}

/** Connects the library service to the view. Selection and query are view-local state. */
export function ReferenceLibraryPanel({ library, currentProject, previewUrl, onError }: ReferenceLibraryPanelProps) {
  const subscribe = useCallback((listener: () => void) => library.subscribe(listener), [library]);
  const state = useSyncExternalStore(subscribe, () => library.state);
  const access = useSyncExternalStore(subscribe, () => library.access);
  const [selection, setSelection] = useState<ViewSelection>({ query: '', collectionId: null, selectedId: null });
  const view = useMemo(() => buildLibraryView(state, access, selection, currentProject), [state, access, selection, currentProject]);
  const report = (result: Promise<{ ok: boolean; code?: string }>) => {
    void result.then((outcome) => { if (!outcome.ok && outcome.code !== undefined) onError?.(outcome.code); });
  };
  return <ReferenceLibraryView view={view} previewUrl={previewUrl}
    onQueryChange={(query) => setSelection((current) => ({ ...current, query }))}
    onSelectCollection={(collectionId: CollectionId | null) => setSelection((current) => ({ ...current, collectionId }))}
    onSelectReference={(selectedId: ReferenceId | null) => setSelection((current) => ({ ...current, selectedId }))}
    onCreateCollection={(name) => report(library.createCollection(name))}
    onDeleteCollection={(id) => report(library.deleteCollection(id))}
    onUseInProject={(id) => { if (currentProject !== null) report(library.useInProject(id, currentProject.id)); }}
    onReload={() => { void library.reload(); }} />;
}
