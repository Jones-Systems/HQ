import type { ReactNode } from 'react';
import type { Item, Status } from '../core';
import type { DropTarget } from './drag';
import { ChevronIcon, PlusIcon } from './icons';

/** One row of a column's card list: a card slot, or the gap that opens where a dragged card would land. */
export type ColumnEntry = { type: 'card'; item: Item } | { type: 'gap' };

export interface ColumnPlan { entries: ColumnEntry[]; gap: boolean; slotActive: boolean }

/**
 * Lays out a column during a drag. The dragged card keeps its slot (drawn as a dashed placeholder) so nothing jumps at
 * pick-up; a gap opens before the card the pointer is over (or at the end) and the neighbours glide apart. Over the
 * source's own slot no gap opens, because letting go there changes nothing.
 */
export function planColumn(cards: readonly Item[], status: Status, drag: { id: string; target: DropTarget | null } | null): ColumnPlan {
  const target = drag?.target;
  const here = target && target.status === status && target.zone !== 'tab' ? target : null;
  const sourceIndex = drag ? cards.findIndex((card) => card.id === drag.id) : -1;
  const others = drag ? cards.filter((card) => card.id !== drag.id).length : cards.length;
  const stays = here !== null && sourceIndex >= 0 && Math.min(Math.max(here.index, 0), others) === sourceIndex;
  const gapAt = here && !stays ? Math.min(Math.max(here.index, 0), others) : null;
  const entries: ColumnEntry[] = [];
  let seen = 0;
  for (const item of cards) {
    if (drag && item.id === drag.id) { entries.push({ type: 'card', item }); continue; }
    if (gapAt === seen) entries.push({ type: 'gap' });
    entries.push({ type: 'card', item });
    seen += 1;
  }
  if (gapAt !== null && gapAt >= seen) entries.push({ type: 'gap' });
  return { entries, gap: gapAt !== null, slotActive: stays };
}

export interface BoardColumnProps {
  status: Status;
  label: string;
  hint: string;
  /** Visible cards (after filters) and the unfiltered total, for "2 of 5". */
  shown: number;
  total: number;
  collapsed: boolean;
  filtered: boolean;
  /** Narrow layout: this column is the selected status tab's panel. */
  panelOf?: string;
  dropTarget: boolean;
  plan: ColumnPlan;
  /** Card ids that appeared after first render: they rise in. */
  fresh: ReadonlySet<string>;
  /** The card a drop or Escape is settling onto; it stays invisible until its ghost lands. */
  landing: string | null;
  renderCard(item: Item): ReactNode;
  onToggle(): void;
  onCapture(): void;
}

const Count = ({ shown, total }: { shown: number; total: number }) => (
  <span className="wk-count work-col-count">{shown}{total > shown && <span className="hq-meta"> of {total}</span>}</span>
);

/** A status column: compact head with a count pill, the capture or add row, and the card list. */
export function BoardColumn({ status, label, hint, shown, total, collapsed, filtered, panelOf, dropTarget, plan, fresh, landing, renderCard, onToggle, onCapture }: BoardColumnProps) {
  const face = (
    <>
      <span className={`wk-dot wk-dot--${status}`} aria-hidden="true" />
      <span className="work-col-name">{label}</span>
      <Count shown={shown} total={total} />
    </>
  );
  // In the narrow layout the status tabs choose the column, so its head is only a title: collapse does not apply.
  const toggle = (
    <h3 className="work-col-head">
      {panelOf ? <span className="work-col-toggle work-col-toggle--static" title={hint}>{face}</span> : (
        <button
          type="button" className="work-col-toggle" aria-expanded={!collapsed} onClick={onToggle}
          title={`${collapsed ? 'Expand' : 'Collapse'} ${label} · ${hint}`}
        >
          {face}
          <span className="work-col-chevron" data-open={!collapsed || undefined}><ChevronIcon /></span>
        </button>
      )}
    </h3>
  );
  const common = {
    className: `work-col work-col--${status}${collapsed ? ' work-col--rail' : ''}`,
    'data-drop-status': status,
    'data-collapsed': collapsed ? 'true' : 'false',
    'data-drop-target': dropTarget || undefined,
  } as const;
  if (collapsed) {
    return <section {...common} aria-label={`${label}, ${shown} ${shown === 1 ? 'card' : 'cards'}`}>{toggle}</section>;
  }
  const empty = shown === 0 && !plan.gap;
  return (
    <section
      {...common}
      id={panelOf ? `work-col-${status}` : undefined}
      role={panelOf ? 'tabpanel' : undefined}
      aria-labelledby={panelOf}
      aria-label={panelOf ? undefined : `${label}, ${shown} ${shown === 1 ? 'card' : 'cards'}`}
    >
      {toggle}
      {status === 'inbox' && <p className="work-col-sub">Captured, not yet sorted</p>}
      <button type="button" className={`work-add${status === 'inbox' ? ' work-add--landing' : ''}`} onClick={onCapture}>
        <PlusIcon />{status === 'inbox' ? 'Capture to Inbox' : 'Add a card'}
        <span className="hq-sr-only">{status === 'inbox' ? '' : ` in ${label}`} (adds to the top)</span>
        {status === 'inbox' && <kbd className="wk-kbd work-add-key" aria-hidden="true">N</kbd>}
      </button>
      <ol className="work-col-list" data-wk-capture-target={status === 'inbox' ? 'inbox' : undefined}>
        {plan.entries.map((entry) => entry.type === 'gap'
          ? <li key="gap" className="work-drop-placeholder hq-enter-fade" data-hq-motion-key="slot" data-drop-placeholder="true" aria-hidden="true" />
          : (
            <li
              key={entry.item.id}
              className={`work-card-slot${fresh.has(entry.item.id) ? ' hq-enter-rise' : ''}`}
              data-hq-motion-key={entry.item.id}
              data-landing={landing === entry.item.id || undefined}
            >
              {renderCard(entry.item)}
            </li>
          ))}
      </ol>
      {empty && <p className="work-col-empty">{filtered && total > shown ? 'No matches here' : 'No cards'}</p>}
    </section>
  );
}
