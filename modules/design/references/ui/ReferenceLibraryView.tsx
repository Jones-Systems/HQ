import { useId, useState } from 'react';
import type { BlobDigest, CollectionId, ReferenceId } from '../src/contract.ts';
import type { LibraryViewModel, ReferenceCard } from './view-model.ts';
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
  /**
   * Injected preview lookup (e.g. a sandboxed blob URL). Returning null shows
   * a placeholder; the view never fetches by itself.
   */
  readonly previewUrl: (digest: BlobDigest) => string | null;
}

/** Presentational reference library. Every action is explicit and local; none dispatches work. */
export function ReferenceLibraryView(props: ReferenceLibraryViewProps) {
  const { view } = props;
  const searchId = useId();
  return <section className="hq-refs" aria-labelledby={`${searchId}-title`}>
    <header className="hq-refs-header">
      <div>
        <span className="eyebrow">Design</span>
        <h2 id={`${searchId}-title`}>References</h2>
        <p className="hq-refs-count">{view.totalLive} {view.totalLive === 1 ? 'reference' : 'references'}</p>
      </div>
      <div className="hq-refs-search">
        <label htmlFor={searchId}>Search references</label>
        <input id={searchId} type="search" value={view.query} placeholder="Title, tag, site or app — tag:x kind:screenshot is:publishable"
          onChange={(event) => props.onQueryChange(event.currentTarget.value)} />
      </div>
    </header>
    {view.banner === null ? null : <div className="hq-refs-banner" role="status">
      <span>{view.banner}</span>
      <button type="button" onClick={props.onReload}>Reload</button>
    </div>}
    <div className="hq-refs-body">
      <CollectionsNav {...props} />
      <div className="hq-refs-results">
        {view.emptyMessage === null
          ? <ul className="hq-refs-grid" aria-label="Reference results">
            {view.cards.map((card) => <li key={card.id}><Card card={card} {...props} /></li>)}
          </ul>
          : <p className="hq-refs-empty">{view.emptyMessage}</p>}
      </div>
      {view.detail === null ? null : <aside className="hq-refs-detail" aria-label="Reference details">
        <div className="hq-refs-detail-head">
          <h3>{view.detail.title}</h3>
          <button type="button" className="hq-refs-quiet" onClick={() => props.onSelectReference(null)}>Close</button>
        </div>
        {view.detail.notes === '' ? null : <p>{view.detail.notes}</p>}
        <dl>{view.detail.provenance.map((row) => [<dt key={`${row.term}-t`}>{row.term}</dt>, <dd key={`${row.term}-d`}>{row.value}</dd>])}</dl>
        <h4>Used in</h4>
        {view.detail.usedIn.length === 0 ? <p className="hq-refs-muted">Not linked to a project.</p>
          : <ul className="hq-refs-uses">{view.detail.usedIn.map((item) => <li key={item}>{item}</li>)}</ul>}
      </aside>}
    </div>
  </section>;
}

function CollectionsNav(props: ReferenceLibraryViewProps) {
  const { view } = props;
  const [draft, setDraft] = useState('');
  const inputId = useId();
  return <nav className="hq-refs-collections" aria-label="Reference collections">
    <ul>
      <li><button type="button" aria-pressed={view.allSelected} onClick={() => props.onSelectCollection(null)}>All references</button></li>
      {view.collections.map((collection) => <li key={collection.id} className="hq-refs-collection">
        <button type="button" aria-pressed={collection.selected} onClick={() => props.onSelectCollection(collection.id)}>
          {collection.name} <span className="hq-refs-muted">{collection.count}</span>
        </button>
        {view.canEdit ? <button type="button" className="hq-refs-quiet" aria-label={`Delete collection ${collection.name} (references are kept)`}
          title="Delete collection — references and files are kept" onClick={() => props.onDeleteCollection(collection.id)}>Delete</button> : null}
      </li>)}
    </ul>
    {view.canEdit ? <form className="hq-refs-new" onSubmit={(event) => {
      event.preventDefault();
      const name = draft.trim();
      if (name !== '') { props.onCreateCollection(name); setDraft(''); }
    }}>
      <label htmlFor={inputId}>New collection</label>
      <input id={inputId} value={draft} maxLength={200} onChange={(event) => setDraft(event.currentTarget.value)} />
      <button type="submit" disabled={draft.trim() === ''}>Add</button>
    </form> : null}
  </nav>;
}

function Card({ card, view, previewUrl, onSelectReference, onUseInProject }: { card: ReferenceCard } & ReferenceLibraryViewProps) {
  const src = card.thumbnail === null ? null : previewUrl(card.thumbnail.digest);
  const project = view.currentProject;
  return <article className="hq-refs-card" aria-current={card.selected ? 'true' : undefined}>
    <button type="button" className="hq-refs-open" onClick={() => onSelectReference(card.id)} aria-label={`Show details for ${card.title}`}>
      <div className="hq-refs-thumb">
        {src === null ? <span className="hq-refs-muted">{card.thumbnail === null ? 'No image' : 'Preview unavailable'}</span>
          : <img src={src} alt="" loading="lazy" decoding="async" width={card.thumbnail?.w ?? undefined} height={card.thumbnail?.h ?? undefined} />}
      </div>
      <h3>{card.title}</h3>
      <p className="hq-refs-source">{card.sourceLabel}</p>
    </button>
    <p className="hq-refs-badges">
      <span className={card.isNativeExecution ? 'hq-refs-badge hq-refs-native' : 'hq-refs-badge'}>{card.evidenceLabel}</span>
      <span className={card.rights.publishable ? 'hq-refs-badge hq-refs-ok' : 'hq-refs-badge hq-refs-warn'}>{card.rights.label}</span>
    </p>
    {card.caveat === null ? null : <p className="hq-refs-caveat">{card.caveat}</p>}
    {card.tags.length === 0 ? null : <ul className="hq-refs-tags" aria-label="Tags">{card.tags.map((tag) => <li key={tag}>{tag}</li>)}</ul>}
    <button type="button" className="hq-refs-use" disabled={project === null || card.usedInCurrentProject || !view.canEdit}
      onClick={() => onUseInProject(card.id)}>
      {project === null ? 'Open a project to use' : card.usedInCurrentProject ? `Used in ${project.name}` : `Use in ${project.name}`}
    </button>
  </article>;
}
