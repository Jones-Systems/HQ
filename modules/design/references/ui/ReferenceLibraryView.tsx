import { SecondaryPanel } from '../../ui/src/secondary-panels.tsx';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Button, IconButton, StatusChip } from '@hq/ui';
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
  /** Injected verified preview lookup. Returning null shows a placeholder. */
  readonly previewUrl: (digest: BlobDigest) => string | null;
  readonly importControls?: ReactNode;
  readonly onShowProjects?: () => void;
}

/** Presentational reference library. Every action is explicit and local; none dispatches work. */
export function ReferenceLibraryView(props: ReferenceLibraryViewProps) {
  const { view } = props;
  const searchId = useId();
  const detailHeading = useRef<HTMLHeadingElement>(null);
  const cardButtons = useRef(new Map<ReferenceId, HTMLButtonElement>());
  const previousSelection = useRef<ReferenceId | undefined>(undefined);
  const selectedId = view.detail?.id;
  const detailCard = view.cards.find((card) => card.id === selectedId);
  useEffect(() => {
    if (selectedId) {
      detailHeading.current?.focus({ preventScroll: true });
      const detail = detailHeading.current?.closest('.hq-refs-detail');
      if (detail) detail.scrollTop = 0;
      if (!previousSelection.current) detailHeading.current?.scrollIntoView({ block: 'nearest' });
    }
    previousSelection.current = selectedId;
  }, [selectedId]);
  const closeDetail = () => {
    props.onSelectReference(null);
    if (selectedId) cardButtons.current.get(selectedId)?.focus();
  };
  return <section className="hq-refs" aria-labelledby={`${searchId}-title`}>
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
    {view.banner === null ? null : <div className="hq-refs-banner" role="status">
      <span>{view.banner}</span>
      <button type="button" onClick={props.onReload}>Reload</button>
    </div>}
    <div className="hq-refs-body">
      {view.totalLive > 0 && <SecondaryPanel name="reference-collections" label="Reference collections" initial={200} side="start"><CollectionsNav {...props} /></SecondaryPanel>}
      <div className="hq-refs-results">
        {view.totalLive > 0 && <div className="hq-refs-summary">
          <span>{view.collections.find((collection) => collection.selected)?.name ?? 'All references'}</span>
          <span>{view.cards.length} shown</span>
        </div>}
        {view.totalLive === 0 ? <div className="hq-refs-welcome">
          <div className="hq-refs-welcome-mark" aria-hidden="true">▧</div>
          <h3>Bring in designs to compare</h3>
          <p>Import screenshots from a website or app to build your reference library. Selected images and their source details stay on this device.</p>
          <p>Project folders are separate: add them in Projects to browse source files and available previews.</p>
          {props.onShowProjects && <button type="button" onClick={props.onShowProjects}>Show my project folders</button>}
        </div> : view.emptyMessage === null
          ? <ul className="hq-refs-grid" aria-label="Reference results">
            {view.cards.map((card) => <li key={card.id}><Card card={card} {...props} openRef={(element) => {
              if (element) cardButtons.current.set(card.id, element);
              else cardButtons.current.delete(card.id);
            }} /></li>)}
          </ul>
          : <p className="hq-refs-empty">{view.emptyMessage}</p>}
      </div>
      {view.detail === null ? null : <SecondaryPanel name="reference-detail" label="Reference details" initial={280}><aside className="hq-refs-detail" aria-label="Reference details">
        <div className="hq-refs-detail-head">
          <h3 ref={detailHeading} tabIndex={-1}>{view.detail.title}</h3>
          <IconButton size="sm" label="Close reference details" icon="×" onClick={closeDetail} />
        </div>
        {(() => { const thumbnail = view.cards.find((card) => card.id === view.detail?.id)?.thumbnail;
          const src = thumbnail ? props.previewUrl(thumbnail.digest) : null;
          return src ? <img className="hq-refs-detail-image" src={src} alt={view.detail.title} /> : null; })()}
        {detailCard && <><EvidenceChips card={detailCard} />{detailCard.caveat && <p className="hq-refs-caveat">{detailCard.caveat}</p>}</>}
        {view.detail.notes === '' ? null : <p>{view.detail.notes}</p>}
        <h4>Provenance</h4>
        <dl>{view.detail.provenance.map((row) => [<dt key={`${row.term}-t`}>{row.term}</dt>, <dd key={`${row.term}-d`}>{row.value}</dd>])}</dl>
        <h4>Used in</h4>
        {view.detail.usedIn.length === 0 ? <p className="hq-refs-muted">Not linked to a project.</p>
          : <ul className="hq-refs-uses">{view.detail.usedIn.map((item) => <li key={item}>{item}</li>)}</ul>}
      </aside></SecondaryPanel>}
    </div>
  </section>;
}

function CollectionsNav(props: ReferenceLibraryViewProps) {
  const { view } = props;
  const [draft, setDraft] = useState('');
  const inputId = useId();
  return <nav className="hq-refs-collections" aria-label="Reference collections">
    <div className="hq-refs-collections-heading">Collections</div>
    <ul>
      <li><Button variant="ghost" size="sm" aria-pressed={view.allSelected} onClick={() => props.onSelectCollection(null)}>All references</Button></li>
      {view.collections.map((collection) => <li key={collection.id} className="hq-refs-collection">
        <Button variant="ghost" size="sm" aria-pressed={collection.selected} onClick={() => props.onSelectCollection(collection.id)}>
          <span className="hq-refs-collection-name">{collection.name}</span> <span className="hq-refs-muted">{collection.count}</span>
        </Button>
        {view.canEdit ? <IconButton size="sm" icon="×" label={`Delete collection ${collection.name} (references are kept)`}
          title="Delete collection — references and files are kept" onClick={() => props.onDeleteCollection(collection.id)} /> : null}
      </li>)}
    </ul>
    {view.canEdit ? <form className="hq-refs-new" onSubmit={(event) => {
      event.preventDefault();
      const name = draft.trim();
      if (name !== '') { props.onCreateCollection(name); setDraft(''); }
    }}>
      <label htmlFor={inputId}>New collection</label>
      <input id={inputId} value={draft} maxLength={200} onChange={(event) => setDraft(event.currentTarget.value)} />
      <Button size="sm" type="submit" disabled={draft.trim() === ''}>Add</Button>
    </form> : null}
  </nav>;
}

function Card({ card, view, previewUrl, onSelectReference, onUseInProject, openRef }: { card: ReferenceCard; openRef: (element: HTMLButtonElement | null) => void } & ReferenceLibraryViewProps) {
  const src = card.thumbnail === null ? null : previewUrl(card.thumbnail.digest);
  const project = view.currentProject;
  return <article className="hq-refs-card" aria-current={card.selected ? 'true' : undefined}>
    <button ref={openRef} type="button" className="hq-refs-open" onClick={() => onSelectReference(card.id)} aria-label={`Show details for ${card.title}`}>
      <div className="hq-refs-thumb">
        {src === null ? <span className="hq-refs-muted">{card.thumbnail === null ? 'No image' : 'Preview unavailable'}</span>
          : <img src={src} alt="" loading="lazy" decoding="async" width={card.thumbnail?.w ?? undefined} height={card.thumbnail?.h ?? undefined} />}
      </div>
      <div className="hq-refs-card-heading"><h3>{card.title}</h3>
      <p className="hq-refs-source" title={card.sourceLabel}>{card.sourceLabel}</p></div>
    </button>
    <div className="hq-refs-card-body">
    <EvidenceChips card={card} />
    {card.caveat === null ? null : <p className="hq-refs-caveat">{card.caveat}</p>}
    {card.tags.length === 0 ? null : <ul className="hq-refs-tags" aria-label="Tags">{card.tags.map((tag) => <li key={tag}>{tag}</li>)}</ul>}
    </div>
    <div className="hq-refs-card-footer">
      {project !== null && card.usedInCurrentProject
        ? <StatusChip tone="success" label={`Used in ${project.name}`} />
        : <Button size="sm" variant="secondary" disabled={project === null || !view.canEdit}
          onClick={() => onUseInProject(card.id)}>
          {project === null ? 'Open a project to use' : `Use in ${project.name}`}
        </Button>}
    </div>
  </article>;
}

function EvidenceChips({ card }: { card: ReferenceCard }) {
  return <p className="hq-refs-badges">
    <StatusChip tone={card.isNativeExecution ? 'success' : 'neutral'} label={card.evidenceLabel} />
    <StatusChip tone={card.rights.publishable ? 'success' : card.rights.status === 'restricted' ? 'warning' : 'unknown'} label={card.rights.label} />
  </p>;
}
