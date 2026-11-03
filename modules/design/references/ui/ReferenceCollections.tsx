import { useId, useRef, useState } from 'react';
import { Button, IconButton } from '@hq/ui';
import type { CollectionId } from '../src/contract.ts';
import type { LibraryViewModel } from './view-model.ts';

export interface ReferenceCollectionsProps {
  readonly view: LibraryViewModel;
  readonly onSelectCollection: (id: CollectionId | null) => void;
  readonly onCreateCollection: (name: string) => void;
  readonly onDeleteCollection: (id: CollectionId) => void;
}

/** Collections as one wrapping chip row, with "New collection" as a compact inline add at its end. */
export function ReferenceCollections({ view, onSelectCollection, onCreateCollection, onDeleteCollection }: ReferenceCollectionsProps) {
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState('');
  const inputId = useId();
  const addButton = useRef<HTMLButtonElement>(null);
  const finish = (restoreFocus: boolean) => {
    setAdding(false); setDraft('');
    if (restoreFocus) queueMicrotask(() => addButton.current?.focus());
  };
  return <nav className="hq-refs-collections" aria-label="Reference collections">
    <ul className="hq-refs-chips">
      <li><Button variant="ghost" size="sm" className="hq-refs-chip" aria-pressed={view.allSelected} onClick={() => onSelectCollection(null)}>
        All references
      </Button></li>
      {view.collections.map((collection) => <li key={collection.id} className="hq-refs-collection">
        <Button variant="ghost" size="sm" className="hq-refs-chip" aria-pressed={collection.selected} onClick={() => onSelectCollection(collection.id)}>
          <span className="hq-refs-collection-name">{collection.name}</span> <span className="hq-refs-chip-count">{collection.count}</span>
        </Button>
        {view.canEdit && collection.selected ? <IconButton size="sm" icon="×" label={`Delete collection ${collection.name} (references are kept)`}
          title="Delete collection — references and files are kept" onClick={() => onDeleteCollection(collection.id)} /> : null}
      </li>)}
      {view.canEdit ? <li>
        {adding
          ? <form className="hq-refs-new" onBlur={(event) => {
            if (draft.trim() === '' && !event.currentTarget.contains(event.relatedTarget as Node | null)) finish(false);
          }} onSubmit={(event) => {
            event.preventDefault();
            const name = draft.trim();
            if (name === '') return;
            onCreateCollection(name);
            finish(true);
          }}>
            <label className="hq-sr-only" htmlFor={inputId}>New collection name</label>
            <input id={inputId} autoFocus value={draft} maxLength={200} placeholder="Collection name" onChange={(event) => setDraft(event.currentTarget.value)}
              onKeyDown={(event) => { if (event.key === 'Escape') { event.stopPropagation(); finish(true); } }} />
            <Button size="sm" variant="primary" type="submit" disabled={draft.trim() === ''}>Add</Button>
          </form>
          : <Button ref={addButton} variant="ghost" size="sm" className="hq-refs-chip hq-refs-chip--add" onClick={() => setAdding(true)}>
            <span aria-hidden="true">+</span> New collection
          </Button>}
      </li> : null}
    </ul>
  </nav>;
}
