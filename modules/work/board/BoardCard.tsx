import { useId, type KeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { Menu } from '@hq/ui';
import type { Item } from '../core';
import { DoneButton, KindIcon } from '../theme';
import { ChecklistIcon, LinkIcon, MoreIcon, NotesIcon } from './icons';
import { moveMenuEntries, type BoardColumns, type MoveIntent } from './moves';
import { ItemChips, stepProgress } from './parts';

/** Statuses a card has left for good: no Done control, and a quieter title. */
const CLOSED: ReadonlySet<Item['status']> = new Set(['done', 'dropped']);
export const isClosed = (item: Pick<Item, 'status'>) => CLOSED.has(item.status);

/**
 * What a card shows: kind icon, title, chips, then steps, links, area and the save badge. The board card and the drag
 * ghost both draw it, so the card you lift looks like the card you picked up. `tools` is the Done and Move controls.
 */
export function CardFace({ item, today, pending, titleId, tools }: {
  item: Item;
  today: string;
  pending?: 'saving' | 'unconfirmed' | undefined;
  titleId?: string;
  tools?: ReactNode;
}) {
  const progress = stepProgress(item);
  const links = item.references.length;
  const showFoot = Boolean(item.notes) || progress.total > 0 || links > 0 || Boolean(item.area) || Boolean(pending);
  const Title = titleId ? 'h4' : 'div';
  return (
    <>
      <div className="work-card-head">
        <span className="work-card-kind"><KindIcon kind={item.kind} /></span>
        <Title className="work-card-title" {...(titleId ? { id: titleId } : {})}>{item.title}</Title>
        {tools}
      </div>
      <ItemChips item={item} today={today} />
      {showFoot && (
        <div className="work-card-foot">
          {item.notes && <span className="work-badge" title="Has notes"><NotesIcon /><span className="hq-sr-only">Has notes</span></span>}
          {progress.total > 0 && <span className="work-badge" title="Checklist"><ChecklistIcon /><span className="hq-sr-only">Checklist </span>{progress.done}/{progress.total}</span>}
          {links > 0 && <span className="work-badge" title="Links"><LinkIcon />{links}<span className="hq-sr-only"> {links === 1 ? 'link' : 'links'}</span></span>}
          {item.area && <span className="work-badge work-badge--area"><span className="hq-sr-only">Area: </span>{item.area}</span>}
          {pending === 'saving' && <span className="work-badge work-badge--saving" role="status">Saving…</span>}
          {pending === 'unconfirmed' && <span className="work-badge work-badge--unconfirmed">Unconfirmed</span>}
        </div>
      )}
    </>
  );
}

export interface BoardCardProps {
  item: Item;
  today: string;
  columns: BoardColumns;
  tabStop: boolean;
  selected: boolean;
  pending: 'saving' | 'unconfirmed' | undefined;
  /** The card being dragged: its slot stays put, drawn as a dashed placeholder. */
  source: boolean;
  /** The pointer is over the source's own slot, so letting go changes nothing. */
  slotActive: boolean;
  onMove(intent: MoveIntent): void;
  onOpen(): void;
  onKeyDown(event: KeyboardEvent<HTMLElement>): void;
  onPointerDown(event: ReactPointerEvent<HTMLElement>): void;
  onFocus(): void;
}

export function BoardCard({ item, today, columns, tabStop, selected, pending, source, slotActive, onMove, onOpen, onKeyDown, onPointerDown, onFocus }: BoardCardProps) {
  const titleId = useId();
  const items = moveMenuEntries(columns, item.id).map((entry) => ({
    id: entry.id, label: entry.label, disabled: entry.disabled, onSelect: () => onMove(entry.intent),
  }));
  const closed = isClosed(item);
  const tools = (
    // Neither control may start a drag or open the card. They show on hover and focus-within and stay reachable by
    // keyboard. The menu owns its keys (arrows, Enter, Escape, type-ahead), so they stop here; the Done button needs no
    // such guard, because the card's key handler ignores keys from its children and global shortcuts (Ctrl+Z) still work.
    <div className="work-card-tools" onClick={(e) => e.stopPropagation()} onPointerDown={(e) => e.stopPropagation()}>
      {!closed && <DoneButton label={`Mark “${item.title}” done`} onDone={() => onMove({ type: 'status', status: 'done' })} />}
      <div className="work-card-menu" onKeyDown={(e) => e.stopPropagation()}>
        <Menu trigger={<MoreIcon />} triggerLabel={`Move “${item.title}”`} items={items} variant="ghost" size="sm" align="end" />
      </div>
    </div>
  );
  return (
    <article
      className={`work-card${item.motivation ? ` work-card--why-${item.motivation}` : ''}${source ? ' work-card--source' : ''}`}
      data-card-id={item.id}
      data-selected={selected || undefined}
      data-closed={closed || undefined}
      data-pending={pending || undefined}
      data-slot-active={slotActive || undefined}
      tabIndex={tabStop ? 0 : -1}
      aria-labelledby={titleId}
      aria-describedby="work-board-keys"
      onKeyDown={onKeyDown}
      onPointerDown={onPointerDown}
      onFocus={onFocus}
      onClick={onOpen}
    >
      <CardFace item={item} today={today} pending={pending} titleId={titleId} tools={tools} />
    </article>
  );
}
