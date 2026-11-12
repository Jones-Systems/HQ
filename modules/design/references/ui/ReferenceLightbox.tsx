import { useRef, type KeyboardEvent } from 'react';
import { Button, Dialog, IconButton, PreservedContent, StatusChip } from '@hq/ui';
import type { BlobDigest, ReferenceId } from '../src/contract.ts';
import { EvidenceChips } from './ReferenceGrid.tsx';
import { lightboxPosition, type LibraryViewModel, type ReferenceTasteSubject } from './view-model.ts';

export interface ReferenceLightboxProps {
  readonly view: LibraryViewModel;
  readonly previewUrl: (digest: BlobDigest) => string | null;
  readonly onClose: () => void;
  /** Moves to another reference: previous and next in the shown order. */
  readonly onSelect: (id: ReferenceId) => void;
  readonly onUseInProject: (id: ReferenceId) => void;
  readonly onSendToTaste?: (subject: ReferenceTasteSubject) => void;
}

/**
 * The large view of one reference: the image, where it came from and what can be done with it. Left and Right move
 * through the references being shown; Escape closes (the view then returns focus to the card).
 */
export function ReferenceLightbox(props: ReferenceLightboxProps) {
  if (props.view.detail === null) return null;
  return <Lightbox {...props} />;
}

function Lightbox({ view, previewUrl, onClose, onSelect, onUseInProject, onSendToTaste }: ReferenceLightboxProps) {
  const detail = view.detail!;
  const heading = useRef<HTMLHeadingElement>(null);
  const card = view.cards.find((item) => item.id === detail.id);
  const thumbnail = card?.thumbnail ?? null;
  const src = thumbnail ? previewUrl(thumbnail.digest) : null;
  const location = lightboxPosition(view.cards, detail.id);
  const project = view.currentProject;

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    const target = event.key === 'ArrowLeft' ? location?.previous : location?.next;
    if (target) onSelect(target);
  };

  const body = <div className="hq-refs-lightbox-body" onKeyDown={onKeyDown}>
    <div className="hq-refs-lightbox-stage">
      <PreservedContent kind="captured" recordedScheme="light" className="hq-refs-stage">
        {src === null
          ? <p className="hq-refs-muted">{thumbnail === null ? 'No image' : 'Preview unavailable'}</p>
          : <img className="hq-refs-detail-image" data-presentation={thumbnail?.presentation} src={src} alt={detail.title} />}
      </PreservedContent>
      {location === null ? null : <div className="hq-refs-lightbox-nav">
        <Button size="sm" variant="secondary" aria-label="Previous reference" aria-keyshortcuts="ArrowLeft"
          disabled={location.previous === null} onClick={() => location.previous && onSelect(location.previous)}><span aria-hidden="true">‹</span> Previous</Button>
        <p className="hq-refs-lightbox-count" role="status">
          <span className="hq-sr-only">{detail.title}, </span>{location.position} of {location.total}
        </p>
        <Button size="sm" variant="secondary" aria-label="Next reference" aria-keyshortcuts="ArrowRight"
          disabled={location.next === null} onClick={() => location.next && onSelect(location.next)}>Next <span aria-hidden="true">›</span></Button>
      </div>}
    </div>
    <aside className="hq-refs-detail" aria-label="Reference details">
      <div className="hq-refs-detail-head">
        <h3 ref={heading} tabIndex={-1}>{detail.title}</h3>
        <IconButton size="sm" label="Close reference details" icon="×" onClick={onClose} />
      </div>
      {card && <><EvidenceChips card={card} />{card.caveat && <p className="hq-refs-caveat">{card.caveat}</p>}</>}
      {detail.notes === '' ? null : <p>{detail.notes}</p>}
      <h4>Provenance</h4>
      <dl>{detail.provenance.map((row) => [<dt key={`${row.term}-t`}>{row.term}</dt>, <dd key={`${row.term}-d`}>{row.value}</dd>])}</dl>
      <h4>Used in</h4>
      {detail.usedIn.length === 0 ? <p className="hq-refs-muted">Not linked to a project.</p>
        : <ul className="hq-refs-uses">{detail.usedIn.map((item) => <li key={item}>{item}</li>)}</ul>}
      <div className="hq-refs-lightbox-actions">
        {onSendToTaste === undefined ? null : <Button size="sm" variant="primary"
          onClick={() => onSendToTaste({ id: detail.id, title: detail.title, detail: card?.sourceLabel ?? '', imageUrl: src })}>Rate taste</Button>}
        {project !== null && card?.usedInCurrentProject
          ? <StatusChip tone="success" label={`Used in ${project.name}`} />
          : <Button size="sm" variant="secondary" disabled={project === null || !view.canEdit} onClick={() => onUseInProject(detail.id)}>
            {project === null ? 'Open a project to use' : `Use in ${project.name}`}
          </Button>}
      </div>
    </aside>
  </div>;

  // `Dialog` reads `document` while rendering, so a render with no DOM (static markup) shows the same detail inline.
  if (typeof document === 'undefined') return <div className="hq-refs-lightbox hq-refs-lightbox--inline">{body}</div>;
  return <div className="hq-refs-lightbox-root">
    <Dialog open onClose={onClose} title={detail.title} className="hq-refs-lightbox" initialFocusRef={heading}>{body}</Dialog>
  </div>;
}
