import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Button, Skeleton, StatusChip, useListMotion } from '@hq/ui';
import type { BlobDigest, ReferenceId } from '../src/contract.ts';
import { gridFocusTarget, type LibraryViewModel, type ReferenceCard, type ReferenceTasteSubject } from './view-model.ts';

/** A reference the owner just saved: the grid scrolls to it and washes it once. `nonce` makes repeats distinct. */
export interface RevealedReference {
  readonly id: ReferenceId;
  readonly nonce: number;
}

export interface ReferenceGridProps {
  readonly view: LibraryViewModel;
  readonly previewUrl: (digest: BlobDigest) => string | null;
  /** True while a preview is still being read, so the card shows a skeleton instead of "unavailable". */
  readonly previewPending?: (digest: BlobDigest) => boolean;
  readonly onOpen: (id: ReferenceId) => void;
  readonly onUseInProject: (id: ReferenceId) => void;
  readonly onSendToTaste?: (subject: ReferenceTasteSubject) => void;
  readonly revealed?: RevealedReference | null;
  /** Registers each card's open button so the view can return focus to it when the lightbox closes. */
  readonly registerOpen: (id: ReferenceId, element: HTMLButtonElement | null) => void;
}

/** Columns in the rendered grid, read from layout: items that share the first item's row. */
function columnCount(list: HTMLElement): number {
  const first = list.firstElementChild;
  if (!(first instanceof HTMLElement)) return 1;
  let columns = 0;
  for (const child of Array.from(list.children)) {
    if (child instanceof HTMLElement && child.offsetTop === first.offsetTop) columns += 1;
    else break;
  }
  return Math.max(1, columns);
}

/**
 * The card grid. Cards are one roving tab stop (arrow keys, Home and End move between them; Enter opens), so a long
 * library costs one Tab. New cards glide in through `useListMotion`; the first render staggers once.
 */
export function ReferenceGrid({ view, previewUrl, previewPending, onOpen, onUseInProject, onSendToTaste, revealed, registerOpen }: ReferenceGridProps) {
  const ids = view.cards.map((card) => card.id);
  const listRef = useListMotion<HTMLUListElement>(ids);
  const [intro, setIntro] = useState(true);
  const [focusId, setFocusId] = useState<ReferenceId | null>(null);
  const [flashId, setFlashId] = useState<ReferenceId | null>(null);
  const articles = useRef(new Map<ReferenceId, HTMLElement>());
  const handled = useRef<number | null>(null);
  const signature = ids.join('\u0000');
  const stop = focusId !== null && ids.includes(focusId) ? focusId : ids[0] ?? null;

  useEffect(() => {
    const timer = window.setTimeout(() => setIntro(false), 800);
    return () => window.clearTimeout(timer);
  }, []);

  // Scroll to a card the owner just saved and wash it once. Waits for the card to render; runs once per save.
  useEffect(() => {
    if (!revealed || handled.current === revealed.nonce) return;
    const article = articles.current.get(revealed.id);
    if (!article) return;
    handled.current = revealed.nonce;
    article.scrollIntoView({ block: 'nearest' });
    setFlashId(revealed.id);
    const timer = window.setTimeout(() => setFlashId((current) => current === revealed.id ? null : current), 1400);
    return () => window.clearTimeout(timer);
  }, [revealed, signature]);

  const onKeyDown = (event: KeyboardEvent<HTMLUListElement>) => {
    const target = event.target;
    if (!(target instanceof HTMLElement) || !target.classList.contains('hq-refs-open')) return;
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    const list = event.currentTarget;
    const items = Array.from(list.querySelectorAll<HTMLElement>('.hq-refs-open'));
    const next = gridFocusTarget(event.key, items.indexOf(target), items.length, columnCount(list));
    if (next === null) return;
    event.preventDefault();
    items[next]?.focus();
  };

  return <ul ref={listRef} className={intro ? 'hq-refs-grid hq-stagger' : 'hq-refs-grid'} aria-label="Reference results" onKeyDown={onKeyDown}>
    {view.cards.map((card) => <li key={card.id} data-hq-motion-key={card.id}>
      <Card card={card} view={view} active={card.id === stop} flash={card.id === flashId}
        src={card.thumbnail === null ? null : previewUrl(card.thumbnail.digest)}
        pending={card.thumbnail !== null && previewPending?.(card.thumbnail.digest) === true}
        onOpen={onOpen} onUseInProject={onUseInProject} onSendToTaste={onSendToTaste}
        onFocusCard={setFocusId}
        article={(element) => { if (element) articles.current.set(card.id, element); else articles.current.delete(card.id); }}
        openRef={(element) => registerOpen(card.id, element)} />
    </li>)}
  </ul>;
}

interface CardProps {
  readonly card: ReferenceCard;
  readonly view: LibraryViewModel;
  readonly src: string | null;
  readonly pending: boolean;
  readonly active: boolean;
  readonly flash: boolean;
  readonly onOpen: (id: ReferenceId) => void;
  readonly onUseInProject: (id: ReferenceId) => void;
  readonly onSendToTaste?: (subject: ReferenceTasteSubject) => void;
  readonly onFocusCard: (id: ReferenceId) => void;
  readonly article: (element: HTMLElement | null) => void;
  readonly openRef: (element: HTMLButtonElement | null) => void;
}

function Card({ card, view, src, pending, active, flash, onOpen, onUseInProject, onSendToTaste, onFocusCard, article, openRef }: CardProps) {
  const project = view.currentProject;
  // Only the card that holds the roving stop is reachable with Tab; the others are reached with the arrow keys.
  const tabIndex = active ? 0 : -1;
  return <article ref={article} className={flash ? 'hq-refs-card hq-lift hq-press hq-flash' : 'hq-refs-card hq-lift hq-press'}
    aria-current={card.selected ? 'true' : undefined} data-queued={card.queuedForTaste ? 'true' : undefined}>
    <button ref={openRef} type="button" className="hq-refs-open" tabIndex={tabIndex} onFocus={() => onFocusCard(card.id)}
      onClick={() => onOpen(card.id)} aria-label={`Show details for ${card.title}`}>
      <Thumb key={src ?? 'none'} card={card} src={src} pending={pending} />
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
        : <Button size="sm" variant="secondary" tabIndex={tabIndex} disabled={project === null || !view.canEdit}
          onClick={() => onUseInProject(card.id)}>
          {project === null ? 'Open a project to use' : `Use in ${project.name}`}
        </Button>}
      {onSendToTaste === undefined ? null : <Button size="sm" variant="ghost" tabIndex={tabIndex}
        onClick={() => onSendToTaste({ id: card.id, title: card.title, detail: card.sourceLabel, imageUrl: src })}>Rate taste</Button>}
    </div>
  </article>;
}

/**
 * The image keeps its own pixels: no fade, filter or opacity. A skeleton sits over its frame until the browser has
 * loaded it, then goes away. A failed load reads "Preview unavailable".
 */
function Thumb({ card, src, pending }: { card: ReferenceCard; src: string | null; pending: boolean }) {
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  // A cached or data: image can already be complete before React attaches onLoad.
  const check = useCallback((image: HTMLImageElement | null) => {
    if (image && image.complete && image.naturalWidth > 0) setLoaded(true);
  }, []);
  if (src === null || failed) {
    return <div className="hq-refs-thumb" aria-busy={pending || undefined}>
      {pending ? <span className="hq-refs-thumb-skeleton"><Skeleton shape="block" height="100%" /></span>
        : <span className="hq-refs-muted">{card.thumbnail === null ? 'No image' : 'Preview unavailable'}</span>}
    </div>;
  }
  const image = <img ref={check} src={src} alt="" loading="lazy" decoding="async" width={card.thumbnail?.w ?? undefined} height={card.thumbnail?.h ?? undefined}
    onLoad={() => setLoaded(true)} onError={() => setFailed(true)} />;
  return <div className="hq-refs-thumb" data-presentation={card.thumbnail?.presentation}>
    {card.thumbnail?.presentation === 'phone' ? <span className="hq-refs-device">{image}</span> : image}
    {loaded ? null : <span className="hq-refs-thumb-skeleton"><Skeleton shape="block" height="100%" /></span>}
  </div>;
}

export function EvidenceChips({ card }: { card: ReferenceCard }) {
  return <p className="hq-refs-badges">
    <StatusChip tone={card.isNativeExecution ? 'success' : 'neutral'} label={card.evidenceLabel} />
    <StatusChip tone={card.rights.publishable ? 'success' : card.rights.status === 'restricted' ? 'warning' : 'unknown'} label={card.rights.label} />
    {card.queuedForTaste ? <StatusChip tone="info" label="Queued for Taste" /> : null}
  </p>;
}
