import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { Menu, StateView } from '@hq/ui';
import {
  DEFAULT_SETTINGS, EMPTY_FILTERS, activeFilterCount, isLive, plannerToday, STATUS_IDS, STATUS_LABEL, STATUSES,
  type Filters, type Item, type Status, type WorkState, type WorkStore,
} from '../core';
import { runMove } from './actions';
import { createDragController, type DragView, type DropTarget } from './drag';
import type { Feedback } from './feedback';
import { boardColumns, cardKey, describeMove, moveMenuEntries, resolveMove, type BoardColumns, type MoveIntent } from './moves';
import { ItemChips, KindIcon, stepProgress } from './parts';
import { SaveState } from './SyncStatus';
import './board.css';

/** RV-7: Planner items carry no project, so Work shows all of them and says so. */
export const PROJECT_SCOPE_NOTE = 'Planner items aren’t project-scoped · showing all planning';
export const DEFAULT_COLLAPSED: readonly Status[] = ['dropped'];

export interface StatusBoardProps {
  store: WorkStore;
  state: WorkState;
  feedback: Feedback;
  filters?: Filters;
  /** Clock for "today" in the Planner's display zone; tests pin it. */
  now?: () => Date;
  selectedId?: string | null;
  onOpenItem(id: string): void;
  /** Opens quick capture preset to a status. Creates always land at the top of their status. */
  onCapture(status: Status): void;
  /** Controlled collapsed columns; uncontrolled starts with Dropped collapsed. */
  collapsed?: readonly Status[];
  onCollapsedChange?(collapsed: Status[]): void;
}

function pendingKinds(state: WorkState): Map<string, 'saving' | 'unconfirmed'> {
  const out = new Map<string, 'saving' | 'unconfirmed'>();
  for (const { write } of state.pending) if ('id' in write) out.set(write.id, 'saving');
  for (const { write } of state.unconfirmed) if ('id' in write) out.set(write.id, 'unconfirmed');
  return out;
}

interface CardProps {
  item: Item;
  today: string;
  columns: BoardColumns;
  tabStop: boolean;
  selected: boolean;
  pending: 'saving' | 'unconfirmed' | undefined;
  source: boolean;
  onMove(intent: MoveIntent): void;
  onOpen(): void;
  onKeyDown(event: KeyboardEvent<HTMLElement>): void;
  onPointerDown(event: ReactPointerEvent<HTMLElement>): void;
  onFocus(): void;
}

function Card({ item, today, columns, tabStop, selected, pending, source, onMove, onOpen, onKeyDown, onPointerDown, onFocus }: CardProps) {
  const titleId = useId();
  const progress = stepProgress(item);
  const links = item.references.length;
  const items = moveMenuEntries(columns, item.id).map((entry) => ({
    id: entry.id, label: entry.label, disabled: entry.disabled, onSelect: () => onMove(entry.intent),
  }));
  return (
    <article
      className={`work-card${item.motivation ? ` work-card--why-${item.motivation}` : ''}${source ? ' work-card--source' : ''}`}
      data-card-id={item.id}
      data-selected={selected || undefined}
      tabIndex={tabStop ? 0 : -1}
      aria-labelledby={titleId}
      aria-describedby="work-board-keys"
      onKeyDown={onKeyDown}
      onPointerDown={onPointerDown}
      onFocus={onFocus}
      onClick={onOpen}
    >
      <div className="work-card-head">
        <KindIcon kind={item.kind} />
        <h4 className="work-card-title" id={titleId}>{item.title}</h4>
        {/* The menu handles its own keys and clicks; they must not reach the card's open, drag or move handlers. */}
        <div className="work-card-menu" onClick={(e) => e.stopPropagation()} onPointerDown={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
          <Menu
            trigger={<svg className="work-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 12h.01M12 12h.01M18 12h.01" /></svg>}
            triggerLabel={`Move “${item.title}”`}
            items={items}
            variant="ghost"
            size="sm"
            align="end"
          />
        </div>
      </div>
      <ItemChips item={item} today={today} />
      {(item.notes || progress.total > 0 || links > 0 || item.area || pending) && (
        <div className="work-card-foot">
          {item.notes && <span className="work-badge" title="Has notes"><svg className="work-icon work-icon--sm" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 7h14M5 12h14M5 17h9" /></svg><span className="hq-sr-only">Has notes</span></span>}
          {progress.total > 0 && <span className="work-badge" title="Checklist"><span className="hq-sr-only">Checklist </span>☑ {progress.done}/{progress.total}</span>}
          {links > 0 && <span className="work-badge" title="Links"><span aria-hidden="true">🔗 </span>{links}<span className="hq-sr-only"> {links === 1 ? 'link' : 'links'}</span></span>}
          {item.area && <span className="work-badge work-badge--area"><span className="hq-sr-only">Area: </span>{item.area}</span>}
          {pending === 'saving' && <span className="work-badge work-badge--saving" role="status">Saving…</span>}
          {pending === 'unconfirmed' && <span className="work-badge work-badge--unconfirmed">Unconfirmed</span>}
        </div>
      )}
    </article>
  );
}

/**
 * The status Board (RV-1): seven status columns in fixed order, collapsible, cards in position order. Pointer and
 * touch drag, Alt+arrow keys and the move menu all resolve through resolveMove to one store.move call, and each
 * move offers Undo. Moving a card is a planning change only; it never starts work.
 */
export function StatusBoard({
  store, state, feedback, filters = EMPTY_FILTERS, now, selectedId = null, onOpenItem, onCapture, collapsed: controlled, onCollapsedChange,
}: StatusBoardProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const ghostRef = useRef<HTMLDivElement>(null);
  /** The card a keyboard or menu move should keep focused while it re-renders; cleared once the move settles. */
  const refocus = useRef<{ id: string; settled: boolean } | null>(null);
  const [ownCollapsed, setOwnCollapsed] = useState<readonly Status[]>(DEFAULT_COLLAPSED);
  const collapsed = controlled ?? ownCollapsed;
  const [focusedId, setFocusedId] = useState<string | null>(selectedId);
  const [drag, setDrag] = useState<DragView | null>(null);
  const [announcement, setAnnouncement] = useState('');

  const settings = state.confirmed?.settings ?? DEFAULT_SETTINGS;
  const today = plannerToday(settings, now?.());
  const columns = useMemo(() => boardColumns(state.items, filters), [state.items, filters]);
  const totals = useMemo(() => boardColumns(state.items), [state.items]);
  const pending = pendingKinds(state);
  const filtered = activeFilterCount(filters) > 0;
  const allIds = STATUS_IDS.flatMap((status) => columns[status].map((item) => item.id));
  const tabStopId = focusedId && allIds.includes(focusedId) ? focusedId : allIds[0] ?? null;

  const columnsRef = useRef(columns);
  columnsRef.current = columns;

  const setCollapsed = (next: Status[]) => {
    if (controlled === undefined) setOwnCollapsed(next);
    onCollapsedChange?.(next);
  };

  const move = useCallback(async (id: string, intent: MoveIntent, refocusCard: boolean) => {
    const current = columnsRef.current;
    const item = STATUS_IDS.flatMap((status) => current[status]).find((candidate) => candidate.id === id);
    const request = item ? resolveMove(current, id, intent) : null;
    if (!item || !request) {
      setAnnouncement(item ? `“${item.title}” is already there.` : '');
      return;
    }
    if (refocusCard) refocus.current = { id, settled: false };
    setAnnouncement(`${describeMove(request, item.status)}: “${item.title}”. Saving…`);
    const outcome = await runMove(store, feedback, request, item);
    if (refocus.current?.id === id) refocus.current.settled = true;
    const after = boardColumns(store.getState().items, filters)[request.status].map((candidate) => candidate.id);
    setAnnouncement(outcome.status === 'saved'
      ? `“${item.title}” is in ${STATUS_LABEL[request.status]}, position ${after.indexOf(id) + 1} of ${after.length}.`
      : outcome.status === 'unconfirmed' ? `“${item.title}”: move not confirmed yet.` : `“${item.title}” did not move.`);
  }, [store, feedback, filters]);

  // Keyboard moves keep focus on the moved card, wherever it lands.
  useLayoutEffect(() => {
    const pending = refocus.current;
    if (!pending) return;
    const root = rootRef.current;
    const active = document.activeElement;
    const element = root?.querySelector<HTMLElement>(`[data-card-id="${CSS.escape(pending.id)}"]`);
    // Only reclaim focus the re-render dropped; never pull it from elsewhere on the page.
    if (element && active !== element && (!active || active === document.body || root?.contains(active))) element.focus();
    if (pending.settled) refocus.current = null;
  });

  const hitTest = useCallback((x: number, y: number, id: string): DropTarget | null => {
    const root = rootRef.current;
    if (!root) return null;
    for (const column of root.querySelectorAll<HTMLElement>('[data-drop-status]')) {
      const rect = column.getBoundingClientRect();
      if (x < rect.left || x > rect.right) continue;
      const status = column.dataset.dropStatus as Status;
      if (column.dataset.collapsed === 'true') return { status, index: 0 };
      let index = 0;
      for (const card of column.querySelectorAll<HTMLElement>('[data-card-id]')) {
        if (card.dataset.cardId === id) continue;
        const box = card.getBoundingClientRect();
        if (y > box.top + box.height / 2) index += 1;
      }
      return { status, index };
    }
    return null;
  }, []);

  const controller = useMemo(() => createDragController({
    hitTest: (x, y, id) => hitTest(x, y, id),
    onChange: setDrag,
    onDrop: (id, target) => void move(id, { type: 'drop', status: target.status, index: target.index }, false),
  }), [hitTest, move]);

  useEffect(() => {
    const onMove = (event: PointerEvent) => controller.pointerMove(event.pointerId, event.clientX, event.clientY);
    const onUp = (event: PointerEvent) => controller.pointerUp(event.pointerId);
    const onCancel = () => controller.cancel();
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape' && controller.dragging) {
        event.preventDefault();
        controller.cancel();
        setAnnouncement('Drag cancelled. Nothing moved.');
      }
    };
    // After a touch hold the page must not scroll under the card.
    const onTouchMove = (event: TouchEvent) => { if (controller.dragging) event.preventDefault(); };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
    window.addEventListener('keydown', onKey);
    window.addEventListener('touchmove', onTouchMove, { passive: false });
    return () => {
      controller.cancel();
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('touchmove', onTouchMove);
    };
  }, [controller]);

  // The ghost follows the pointer through CSSOM; the app CSP forbids inline style attributes.
  useLayoutEffect(() => {
    if (drag && ghostRef.current) ghostRef.current.style.setProperty('transform', `translate(${drag.x + 12}px, ${drag.y + 12}px)`);
  }, [drag]);

  const focusCard = (id: string | undefined) => {
    if (!id) return;
    setFocusedId(id);
    rootRef.current?.querySelector<HTMLElement>(`[data-card-id="${CSS.escape(id)}"]`)?.focus();
  };

  const onCardKey = (item: Item) => (event: KeyboardEvent<HTMLElement>) => {
    if (event.target !== event.currentTarget) return;
    const key = cardKey(event, item.status);
    if (!key) return;
    event.preventDefault();
    if (key.type === 'move') void move(item.id, key.intent, true);
    else if (key.type === 'open') onOpenItem(item.id);
    else if (key.type === 'menu') event.currentTarget.querySelector<HTMLButtonElement>('[aria-haspopup="menu"]')?.click();
    else if (key.axis === 'card') {
      const ids = columns[item.status].map((card) => card.id);
      focusCard(ids[ids.indexOf(item.id) + key.delta]);
    } else {
      const index = columns[item.status].findIndex((card) => card.id === item.id);
      let at = STATUS_IDS.indexOf(item.status) + key.delta;
      while (at >= 0 && at < STATUS_IDS.length) {
        const status = STATUS_IDS[at]!;
        if (!collapsed.includes(status) && columns[status].length) {
          focusCard(columns[status][Math.min(index, columns[status].length - 1)]!.id);
          return;
        }
        at += key.delta;
      }
    }
  };

  const onCardPointer = (item: Item) => (event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0) return;
    controller.pointerDown({ id: item.id, pointerId: event.pointerId, pointerType: event.pointerType, x: event.clientX, y: event.clientY });
  };

  if (!state.confirmed) {
    return (
      <div className="work-board work-ui">
        {state.load === 'unavailable'
          ? <StateView state="unavailable" title="Planner service unreachable" description="No planning snapshot has loaded yet, so nothing is shown. Nothing was changed." action={{ label: 'Try again', onAction: () => void store.load() }} />
          : <StateView state="loading" title="Loading the Planner…" />}
      </div>
    );
  }

  const live = state.items.filter(isLive).length;
  const dragItem = drag ? state.items.find((item) => item.id === drag.id) : undefined;
  const dragRequest = drag && drag.target && dragItem ? resolveMove(columns, drag.id, { type: 'drop', ...drag.target }) : null;

  return (
    <div className="work-board work-ui" ref={rootRef} data-dragging={drag ? 'true' : undefined}>
      <header className="work-board-head">
        <div className="work-board-title">
          <h2>Status board</h2>
          <p className="work-board-note">{PROJECT_SCOPE_NOTE}</p>
        </div>
        <p className="work-board-hint" id="work-board-keys">Drag a card, or use its ⋯ menu. On a focused card: Alt+←/→ changes status, Alt+↑/↓ reorders, M opens the move menu, Enter opens it.</p>
        <SaveState store={store} state={state} />
      </header>
      {live === 0 && (
        <StateView state="empty" title="No planning items yet" description="Capture something to Inbox to start. Nothing is dated unless you add a date." action={{ label: 'Capture to Inbox', onAction: () => onCapture('inbox') }} />
      )}
      <div className="work-columns">
        {STATUSES.map(({ id: status, label, hint }) => {
          const cards = columns[status];
          const isCollapsed = collapsed.includes(status);
          const hidden = totals[status].length - cards.length;
          const target = drag?.target?.status === status ? drag.target.index : null;
          // Placeholder slots count the column's visible cards without the dragged one, as hitTest does.
          let others = 0;
          return (
            <section
              key={status}
              className={`work-col work-col--${status}`}
              data-drop-status={status}
              data-collapsed={isCollapsed ? 'true' : 'false'}
              data-drop-target={target !== null || undefined}
              aria-label={`${label}, ${cards.length} ${cards.length === 1 ? 'card' : 'cards'}`}
            >
              <h3 className="work-col-head">
                <button
                  type="button"
                  className="work-col-toggle"
                  aria-expanded={!isCollapsed}
                  onClick={() => setCollapsed(isCollapsed ? collapsed.filter((s) => s !== status) : [...collapsed, status])}
                  title={isCollapsed ? `Expand ${label}` : `Collapse ${label}`}
                >
                  <span className={`work-st-dot work-st-dot--${status}`} aria-hidden="true" />
                  <span className="work-col-name">{label}</span>
                  <span className="work-col-count">{cards.length}{hidden > 0 && <span className="hq-meta"> of {totals[status].length}</span>}</span>
                </button>
              </h3>
              {!isCollapsed && (
                <>
                  <p className="work-col-hint">{status === 'inbox' ? 'Status · captured, not yet sorted' : hint}</p>
                  <button type="button" className="work-add" onClick={() => onCapture(status)}>
                    <span aria-hidden="true">+ </span>{status === 'inbox' ? 'Capture to Inbox' : 'Add a card'}
                    <span className="hq-sr-only"> in {label} (adds to the top)</span>
                  </button>
                  <ol className="work-col-list">
                    {cards.map((item) => {
                      const isSource = drag?.id === item.id;
                      const slot = isSource ? -1 : (others += 1) - 1;
                      return (
                        <li key={item.id} className="work-card-slot">
                          {target === slot && <div className="work-drop-placeholder" aria-hidden="true" />}
                          <Card
                            item={item}
                            today={today}
                            columns={columns}
                            tabStop={item.id === tabStopId}
                            selected={item.id === selectedId}
                            pending={pending.get(item.id)}
                            source={isSource}
                            onMove={(intent) => void move(item.id, intent, true)}
                            onOpen={() => { if (!controller.consumeClick()) onOpenItem(item.id); }}
                            onKeyDown={onCardKey(item)}
                            onPointerDown={onCardPointer(item)}
                            onFocus={() => setFocusedId(item.id)}
                          />
                        </li>
                      );
                    })}
                    {target !== null && target >= others && <li className="work-drop-placeholder" aria-hidden="true" />}
                  </ol>
                  {cards.length === 0 && (
                    <p className="work-col-empty">{filtered && hidden > 0 ? 'No matches here' : 'No cards'}</p>
                  )}
                </>
              )}
            </section>
          );
        })}
      </div>
      {drag && dragItem && (
        <div className="work-drag-ghost" ref={ghostRef} aria-hidden="true">
          <span className="work-drag-title">{dragItem.title}</span>
          <span className="work-drag-badge">{dragRequest ? describeMove(dragRequest, dragItem.status) : drag.target ? 'Stays here' : 'Drop on a column'}</span>
        </div>
      )}
      <p className="hq-sr-only" role="status" aria-live="polite">{announcement}</p>
    </div>
  );
}
