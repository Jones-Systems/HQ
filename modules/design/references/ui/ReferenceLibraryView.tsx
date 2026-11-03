import { useEffect, useId, useRef, useState, type DragEvent, type ReactNode } from 'react';
import { InlineNotice, useToast } from '@hq/ui';
import type { BlobDigest, CollectionId, ReferenceId } from '../src/contract.ts';
import { ReferenceCollections } from './ReferenceCollections.tsx';
import { ReferenceGrid, type RevealedReference } from './ReferenceGrid.tsx';
import { ReferenceLightbox } from './ReferenceLightbox.tsx';
import type { LibraryViewModel, ReferenceTasteSubject } from './view-model.ts';
import './references.css';

export interface ReferenceLibraryActions {
  readonly onQueryChange: (query: string) => void;
  readonly onSelectCollection: (id: CollectionId | null) => void;
  readonly onSelectReference: (id: ReferenceId | null) => void;
  readonly onCreateCollection: (name: string) => void;
  readonly onDeleteCollection: (id: CollectionId) => void;
  readonly onUseInProject: (id: ReferenceId) => void;
  readonly onReload: () => void;
}

export interface ReferenceLibraryViewProps extends ReferenceLibraryActions {
  readonly view: LibraryViewModel;
  /** Injected verified preview lookup. Returning null shows a placeholder. */
  readonly previewUrl: (digest: BlobDigest) => string | null;
  /** True while a preview is still being read, so its card shows a skeleton rather than "unavailable". */
  readonly previewPending?: (digest: BlobDigest) => boolean;
  readonly importControls?: ReactNode;
  readonly onShowProjects?: () => void;
  /** "Rate taste" on a card and in the lightbox. Omit and the action is not offered. */
  readonly onSendToTaste?: (subject: ReferenceTasteSubject) => void;
  /** Where bulk import (bundles, recordings, HTML) lives. Omit and the pointer to it is not shown. */
  readonly onOpenImports?: () => void;
  /** Files dropped on the library. The owner of the import queue decides what to do with them. */
  readonly onDropFiles?: (files: readonly File[]) => void;
  /** A reference the owner just saved: the grid scrolls to it and washes it once. */
  readonly revealed?: RevealedReference | null;
}

const hasFiles = (event: DragEvent) => Array.from(event.dataTransfer?.types ?? []).includes('Files');

/** Presentational reference library. Every action is explicit and local; none dispatches work. */
export function ReferenceLibraryView(props: ReferenceLibraryViewProps) {
  const { view } = props;
  const toast = useToast();
  const searchId = useId();
  const cardButtons = useRef(new Map<ReferenceId, HTMLButtonElement>());
  const openId = useRef<ReferenceId | null>(null);
  const dragDepth = useRef(0);
  const [dragging, setDragging] = useState(false);
  const selectedId = view.detail?.id ?? null;

  // Closing the lightbox returns focus to the card that was open, not to whichever card opened it first.
  useEffect(() => {
    if (selectedId === null && openId.current !== null) cardButtons.current.get(openId.current)?.focus();
    openId.current = selectedId;
  }, [selectedId]);

  const canDrop = props.onDropFiles !== undefined;
  const dropHandlers = canDrop ? {
    onDragEnter: (event: DragEvent) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      dragDepth.current += 1;
      setDragging(true);
    },
    onDragOver: (event: DragEvent) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = view.canEdit ? 'copy' : 'none';
    },
    onDragLeave: (event: DragEvent) => {
      if (!hasFiles(event)) return;
      dragDepth.current = Math.max(0, dragDepth.current - 1);
      if (dragDepth.current === 0) setDragging(false);
    },
    onDrop: (event: DragEvent) => {
      if (!hasFiles(event)) return;
      // Always cancel: an unhandled file drop would navigate the window to the file.
      event.preventDefault();
      dragDepth.current = 0;
      setDragging(false);
      const files = Array.from(event.dataTransfer.files);
      if (files.length === 0) return;
      if (!view.canEdit) {
        toast.warning('Importing is paused', { description: view.banner ?? 'The library cannot be changed right now.' });
        return;
      }
      props.onDropFiles?.(files);
    },
  } : {};

  return <>
    <section className="hq-refs" aria-labelledby={`${searchId}-title`} {...dropHandlers}>
      <header className="hq-refs-header">
        <div className="hq-refs-heading">
          <span className="eyebrow">Design</span>
          <h2 id={`${searchId}-title`}>References</h2>
          <p className="hq-refs-count">{view.totalLive} {view.totalLive === 1 ? 'reference' : 'references'}</p>
        </div>
        {view.totalLive > 0 && <div className="hq-refs-search">
          <label className="hq-sr-only" htmlFor={searchId}>Search references</label>
          <input id={searchId} type="search" value={view.query} placeholder="Search references"
            onChange={(event) => props.onQueryChange(event.currentTarget.value)} />
        </div>}
        {props.importControls}
      </header>
      {view.banner === null ? null : <InlineNotice tone="warning" variant="bar" title={view.banner}
        actions={[{ label: 'Reload', onAction: props.onReload }]} />}
      {view.totalLive > 0 && <ReferenceCollections view={view} onSelectCollection={props.onSelectCollection}
        onCreateCollection={props.onCreateCollection} onDeleteCollection={props.onDeleteCollection} />}
      <div className="hq-refs-results">
        {view.totalLive > 0 && <div className="hq-refs-summary">
          <span>{view.collections.find((collection) => collection.selected)?.name ?? 'All references'}</span>
          <span>{view.cards.length} shown</span>
        </div>}
        {view.totalLive === 0 ? <div className="hq-refs-welcome">
          <div className="hq-refs-welcome-mark" aria-hidden="true">▧</div>
          <h3>Bring in designs to compare</h3>
          <p>Import screenshots from a website or app to build your reference library. Selected images and their source details stay on this device.</p>
          {canDrop && <p>Drag screenshots here, or use Import screenshots.</p>}
          <p>Project folders are separate: add them in Projects to browse source files and available previews.</p>
          <div className="hq-refs-welcome-links">
            {props.onShowProjects && <button type="button" onClick={props.onShowProjects}>Show my project folders</button>}
            {props.onOpenImports && <p className="hq-refs-cross">Importing a bundle, recordings or HTML? <button type="button" className="hq-refs-link" onClick={props.onOpenImports}>Use Imports</button></p>}
          </div>
        </div> : view.emptyMessage === null
          ? <ReferenceGrid view={view} previewUrl={props.previewUrl} previewPending={props.previewPending} revealed={props.revealed}
            onOpen={props.onSelectReference} onUseInProject={props.onUseInProject} onSendToTaste={props.onSendToTaste}
            registerOpen={(id, element) => {
              if (element) cardButtons.current.set(id, element);
              else cardButtons.current.delete(id);
            }} />
          : <p className="hq-refs-empty">{view.emptyMessage}</p>}
      </div>
      {dragging && <div className="hq-refs-drop hq-enter-fade" aria-hidden="true">
        <div className="hq-refs-drop-label">
          <strong>{view.canEdit ? 'Drop screenshots to import' : 'Importing is paused'}</strong>
          <span>{view.canEdit ? 'PNG, JPEG or WebP' : 'The library cannot be changed right now'}</span>
        </div>
      </div>}
    </section>
    <ReferenceLightbox view={view} previewUrl={props.previewUrl} onClose={() => props.onSelectReference(null)}
      onSelect={props.onSelectReference} onUseInProject={props.onUseInProject} onSendToTaste={props.onSendToTaste} />
  </>;
}
