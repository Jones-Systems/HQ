import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { animateElement, prefersReducedMotion, StateView, useListMotion } from '@hq/ui';
import {
  DEFAULT_SETTINGS, EMPTY_FILTERS, activeFilterCount, isLive, plannerToday, STATUS_IDS, STATUS_LABEL, STATUSES,
  type Filters, type Item, type Status, type WorkState, type WorkStore,
} from '../core';
import { flash } from '../motion';
import { PageHeader } from '../theme';
import { runMove } from './actions';
import { BoardCard, CardFace } from './BoardCard';
import { BoardColumn, planColumn } from './BoardColumn';
import { BoardSkeleton } from './BoardSkeleton';
import type { DropTarget } from './drag';
import type { Feedback } from './feedback';
import { ChevronIcon } from './icons';
import { BOARD_KEYS_TEXT, KeyboardHint } from './KeyboardHint';
import { boardColumns, cardKey, describeDrop, describeMove, resolveMove, type MoveIntent } from './moves';
import { StatusTabs } from './StatusTabs';
import { SaveState } from './SyncStatus';
import { useBoardDrag } from './useBoardDrag';
import '../theme';
import './board.css';

/** RV-7: Planner items carry no project, so Work shows all of them and says so. */
export const PROJECT_SCOPE_NOTE = 'Planner items aren’t project-scoped · showing all planning';
export const DEFAULT_COLLAPSED: readonly Status[] = ['dropped'];
/** Under this content width the board shows one column at a time behind status tabs. */
export const NARROW_BOARD_PX = 640;
/** How long a newly appeared card keeps its enter class; the animation itself is shorter. */
const FRESH_MS = 700;

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

const cardSelector = (id: string) => `[data-card-id="${CSS.escape(id)}"]`;
const EMPTY_IDS: ReadonlySet<string> = new Set();

/** A refused move shakes its card once: a quick horizontal wobble (transform only; nothing under reduced motion). */
function shake(card: Element | null | undefined): void {
  if (!card) return;
  animateElement(card, [
    { transform: 'translateX(0)' }, { transform: 'translateX(-5px)' }, { transform: 'translateX(4px)' },
    { transform: 'translateX(-3px)' }, { transform: 'translateX(2px)' }, { transform: 'translateX(0)' },
  ], { duration: 'slow', easing: 'standard' });
}

type Layout = 'unknown' | 'wide' | 'narrow';

/** Measures the board's own width (not the window's), so the narrow layout follows the space the board really has. */
function useBoardLayout(ref: RefObject<HTMLElement | null>): Layout {
  const [layout, setLayout] = useState<Layout>('unknown');
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return undefined;
    const read = (width: number) => setLayout(width > 0 && width < NARROW_BOARD_PX ? 'narrow' : 'wide');
    read(element.getBoundingClientRect().width);
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[entries.length - 1];
      if (entry) read(entry.contentRect.width);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);
  return layout;
}

/** Whether the column scroller has more to reveal at each edge, for the edge fade and the scroll controls. */
function useScrollEdges(ref: RefObject<HTMLElement | null>, watch: unknown): { start: boolean; end: boolean } {
  const [edges, setEdges] = useState({ start: false, end: false });
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return undefined;
    const read = () => {
      const start = element.scrollLeft > 1;
      const end = element.scrollLeft + element.clientWidth < element.scrollWidth - 1;
      setEdges((previous) => (previous.start === start && previous.end === end ? previous : { start, end }));
    };
    read();
    element.addEventListener('scroll', read, { passive: true });
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(read);
    observer?.observe(element);
    return () => { element.removeEventListener('scroll', read); observer?.disconnect(); };
  }, [ref, watch]);
  return edges;
}

/**
 * The status Board (RV-1): seven status columns in fixed order, collapsible, cards in position order. Pointer and
 * touch drag, Alt+arrow keys and the move menu all resolve through resolveMove to one store.move call, and each
 * move offers Undo. Moving a card is a planning change only; it never starts work.
 *
 * Under about 640 px of board width it becomes status tabs with one column at a time; tabs and collapsed rails still
 * accept drops. The loading state is a board-shaped skeleton; a failed first load keeps its StateView.
 */
export function StatusBoard(props: StatusBoardProps) {
  const host = useRef<HTMLDivElement>(null);
  const layout = useBoardLayout(host);
  const { state, store } = props;
  let body;
  if (!state.confirmed) {
    body = (
      <>
        <PageHeader title="Status board" />
        {state.load === 'unavailable'
          ? <StateView state="unavailable" title="Planner service unreachable" description="No planning snapshot has loaded yet, so nothing is shown. Nothing was changed." action={{ label: 'Try again', onAction: () => void store.load() }} />
          : <BoardSkeleton />}
      </>
    );
  } else if (layout === 'unknown') {
    // The first paint waits for the width, so a narrow window never flashes the wide board and animates into tabs.
    body = null;
  } else {
    body = <BoardSurface {...props} narrow={layout === 'narrow'} />;
  }
  return <div className="work-board work-ui" ref={host}>{body}</div>;
}

function BoardSurface({
  store, state, feedback, filters = EMPTY_FILTERS, now, selectedId = null, onOpenItem, onCapture, collapsed: controlled, onCollapsedChange, narrow,
}: StatusBoardProps & { narrow: boolean }) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  /** The card a keyboard or menu move should keep focused while it re-renders; cleared once the move settles. */
  const refocus = useRef<{ id: string; settled: boolean } | null>(null);
  const [ownCollapsed, setOwnCollapsed] = useState<readonly Status[]>(DEFAULT_COLLAPSED);
  const collapsed = controlled ?? ownCollapsed;
  const [focusedId, setFocusedId] = useState<string | null>(selectedId);
  const [announcement, setAnnouncement] = useState('');
  const settings = state.confirmed?.settings ?? DEFAULT_SETTINGS;
  const today = plannerToday(settings, now?.());
  const columns = useMemo(() => boardColumns(state.items, filters), [state.items, filters]);
  const totals = useMemo(() => boardColumns(state.items), [state.items]);
  const [tab, setTab] = useState<Status>(() => STATUS_IDS.find((status) => columns[status].length > 0) ?? 'inbox');
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

  const rootRef = useRef<HTMLDivElement | null>(null);

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
    // A refused move rolls back in place; the card shakes once so the user sees it did not take.
    if (outcome.status === 'failed') requestAnimationFrame(() => shake(rootRef.current?.querySelector(cardSelector(id))));
  }, [store, feedback, filters]);

  // Keyboard moves keep focus on the moved card, wherever it lands.
  useLayoutEffect(() => {
    const pendingFocus = refocus.current;
    if (!pendingFocus) return;
    const root = rootRef.current;
    const active = document.activeElement;
    const element = root?.querySelector<HTMLElement>(cardSelector(pendingFocus.id));
    // Only reclaim focus the re-render dropped; never pull it from elsewhere on the page.
    if (element && active !== element && (!active || active === document.body || root?.contains(active))) element.focus();
    if (pendingFocus.settled) refocus.current = null;
  });

  const intentFor = (target: DropTarget): MoveIntent => (target.zone === 'tab'
    ? { type: 'status', status: target.status }
    : { type: 'drop', status: target.status, index: target.index });

  const hitTest = useCallback((x: number, y: number, id: string): DropTarget | null => {
    const root = rootRef.current;
    if (!root) return null;
    // A narrow-layout status tab is a drop zone for its whole status.
    for (const element of root.querySelectorAll<HTMLElement>('[data-drop-tab]')) {
      const box = element.getBoundingClientRect();
      if (x >= box.left && x <= box.right && y >= box.top && y <= box.bottom) return { status: element.dataset.dropTab as Status, index: 0, zone: 'tab' };
    }
    // Columns scrolled out of the scroller's box are not under the pointer, whatever their rectangles say.
    const bounds = scrollerRef.current?.getBoundingClientRect();
    if (bounds && bounds.width > 0 && (x < bounds.left || x > bounds.right || y < bounds.top || y > bounds.bottom)) return null;
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

  const dragging = useBoardDrag({
    rootRef, scrollerRef, hitTest,
    onDrop: (id, target) => void move(id, intentFor(target), false),
    onCancel: () => setAnnouncement('Drag cancelled. Nothing moved.'),
  });

  // The root is the one list-motion container, so a card glides whether it moves in its column or across columns.
  // Its order is the rendered structure: column markers, card slots and the open drop gap, in DOM order.
  const visible = narrow ? [tab] : STATUS_IDS;
  const plans = visible.map((status) => {
    const isRail = !narrow && collapsed.includes(status);
    return { status, isRail, plan: planColumn(columns[status], status, dragging.drag) };
  });
  const order = plans.flatMap(({ status, isRail, plan }) => [
    `col:${status}${isRail ? ':rail' : ''}`,
    ...(isRail ? [] : plan.entries.map((entry) => (entry.type === 'gap' ? 'slot' : entry.item.id))),
  ]);
  const motionRef = useListMotion<HTMLDivElement>(order, { animateEntering: false });
  const setRoot = useCallback((element: HTMLDivElement | null) => { rootRef.current = element; motionRef.current = element; }, [motionRef]);

  // Cards that appear after the first render rise into place and their column flashes: the capture landing. Whatever was
  // here on first load, or when the board remounts, never animates. A narrow filter change is not a new card, so this
  // compares against every live item rather than what the filters show.
  const known = useRef<Set<string> | null>(null);
  const [fresh, setFresh] = useState<ReadonlySet<string>>(EMPTY_IDS);
  const freshTimers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const liveKey = useMemo(() => state.items.filter(isLive).map((item) => item.id).join('\u0000'), [state.items]);
  useLayoutEffect(() => {
    if (known.current === null) { known.current = new Set(state.items.filter(isLive).map((item) => item.id)); return; }
    const before = known.current;
    const added = state.items.filter((item) => isLive(item) && !before.has(item.id));
    known.current = new Set(state.items.filter(isLive).map((item) => item.id));
    if (added.length === 0) return;
    const ids = added.map((item) => item.id);
    setFresh((previous) => new Set([...previous, ...ids]));
    freshTimers.current.push(setTimeout(() => setFresh((previous) => {
      const next = new Set(previous);
      for (const id of ids) next.delete(id);
      return next;
    }), FRESH_MS));
    const root = rootRef.current;
    for (const status of new Set(added.map((item) => item.status))) flash(root?.querySelector(`[data-drop-status="${status}"]`));
    // A capture into an Inbox that has scrolled out of view brings the Inbox back.
    const inbox = root?.querySelector<HTMLElement>('[data-drop-status="inbox"]');
    const scroller = scrollerRef.current;
    if (inbox && scroller && added.some((item) => item.status === 'inbox')) {
      const column = inbox.getBoundingClientRect();
      const box = scroller.getBoundingClientRect();
      if (box.width > 0 && (column.left < box.left || column.right > box.right)) {
        scroller.scrollBy?.({ left: column.left - box.left - 8, behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
      }
    }
  }, [liveKey]);
  useEffect(() => () => { for (const timer of freshTimers.current) clearTimeout(timer); }, []);

  const focusCard = (id: string | undefined) => {
    if (!id) return;
    setFocusedId(id);
    rootRef.current?.querySelector<HTMLElement>(cardSelector(id))?.focus();
  };

  const onCardKey = (item: Item) => (event: KeyboardEvent<HTMLElement>) => {
    if (event.target !== event.currentTarget) return;
    const key = cardKey(event, item.status);
    if (!key) return;
    event.preventDefault();
    if (key.type === 'move') {
      // Narrow layout shows one status at a time: follow a keyboard status move to its new tab so focus stays on the card.
      if (narrow && key.intent.type === 'status') setTab(key.intent.status);
      void move(item.id, key.intent, true);
    } else if (key.type === 'open') onOpenItem(item.id);
    else if (key.type === 'menu') event.currentTarget.querySelector<HTMLButtonElement>('[aria-haspopup="menu"]')?.click();
    else if (key.axis === 'card') {
      const ids = columns[item.status].map((card) => card.id);
      focusCard(ids[ids.indexOf(item.id) + key.delta]);
    } else {
      const index = columns[item.status].findIndex((card) => card.id === item.id);
      let at = STATUS_IDS.indexOf(item.status) + key.delta;
      while (at >= 0 && at < STATUS_IDS.length) {
        const status = STATUS_IDS[at]!;
        if ((narrow || !collapsed.includes(status)) && columns[status].length) {
          const target = columns[status][Math.min(index, columns[status].length - 1)]!.id;
          if (narrow) { setTab(status); setFocusedId(target); refocus.current = { id: target, settled: true }; } else focusCard(target);
          return;
        }
        at += key.delta;
      }
    }
  };

  const onCardPointer = (item: Item) => (event: ReactPointerEvent<HTMLElement>) => dragging.pointerDown(item.id, event);

  const edges = useScrollEdges(scrollerRef, order.join('|'));
  const scrollColumns = (direction: -1 | 1) => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const left = direction * Math.max(288, Math.round(scroller.clientWidth * 0.8));
    if (typeof scroller.scrollBy === 'function') scroller.scrollBy({ left, behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
    else scroller.scrollLeft += left;
  };
  // A scroll control that disappears at the end of the track must not strand the keyboard on a removed button.
  useLayoutEffect(() => {
    const active = document.activeElement;
    if (active instanceof HTMLElement && active.dataset.scrollMore && !edges[active.dataset.scrollMore as 'start' | 'end']) scrollerRef.current?.focus();
  }, [edges]);

  const live = state.items.filter(isLive).length;
  const shown = allIds.length;
  const dragItem = dragging.drag ? state.items.find((item) => item.id === dragging.drag!.id) : undefined;
  const dragRequest = dragging.drag?.target && dragItem ? resolveMove(columns, dragItem.id, intentFor(dragging.drag.target)) : null;
  const badge = useRef('');
  if (dragging.drag && dragItem) badge.current = describeDrop(dragRequest, dragItem.status, dragging.drag.target?.status ?? null);
  const ghostItem = dragging.ghost ? state.items.find((item) => item.id === dragging.ghost) : undefined;
  const over = dragging.drag?.target ?? null;
  const overColumn = over && over.zone !== 'tab' ? over.status : null;

  const counts = Object.fromEntries(STATUS_IDS.map((status) => [status, columns[status].length])) as Record<Status, number>;

  return (
    <div className="work-board-surface" ref={setRoot} data-dragging={dragging.drag ? 'true' : undefined} data-narrow={narrow || undefined}>
      <PageHeader
        title="Status board"
        meta={(
          <>
            <span className="work-board-count">{filtered ? `${shown} of ${live} cards` : `${live} ${live === 1 ? 'card' : 'cards'}`}</span>
            <span aria-hidden="true"> · </span>
            <span>{PROJECT_SCOPE_NOTE}</span>
          </>
        )}
        actions={<><KeyboardHint /><SaveState store={store} state={state} /></>}
      />
      <p className="hq-sr-only" id="work-board-keys">{BOARD_KEYS_TEXT}</p>
      {live === 0 && (
        <StateView state="empty" title="No planning items yet" description="Capture something to Inbox to start. Nothing is dated unless you add a date." action={{ label: 'Capture to Inbox', onAction: () => onCapture('inbox') }} />
      )}
      {narrow && <StatusTabs current={tab} counts={counts} dropStatus={over?.zone === 'tab' ? over.status : null} onSelect={setTab} />}
      <div className="work-columns-wrap">
        <div
          className="work-columns" ref={scrollerRef} role="region" aria-label="Status columns" tabIndex={0}
          data-more={[edges.start && 'start', edges.end && 'end'].filter(Boolean).join(' ') || undefined}
          onKeyDown={(event) => {
            if (event.target !== event.currentTarget || event.altKey || event.ctrlKey || event.metaKey) return;
            const element = event.currentTarget;
            if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
              event.preventDefault(); element.scrollLeft += event.key === 'ArrowRight' ? 120 : -120;
            } else if (event.key === 'Home' || event.key === 'End') {
              event.preventDefault(); element.scrollLeft = event.key === 'Home' ? 0 : element.scrollWidth;
            }
          }}
        >
          {plans.map(({ status, isRail, plan }) => {
            const meta = STATUSES.find((candidate) => candidate.id === status)!;
            const cards = columns[status];
            return (
              <BoardColumn
                key={status}
                status={status}
                label={meta.label}
                hint={meta.hint}
                shown={cards.length}
                total={totals[status].length}
                collapsed={isRail}
                filtered={filtered}
                panelOf={narrow ? `work-tab-${status}` : undefined}
                dropTarget={overColumn === status}
                plan={plan}
                fresh={fresh}
                landing={dragging.landing}
                renderCard={(item) => (
                  <BoardCard
                    item={item}
                    today={today}
                    columns={columns}
                    tabStop={item.id === tabStopId}
                    selected={item.id === selectedId}
                    pending={pending.get(item.id)}
                    source={dragging.drag?.id === item.id}
                    slotActive={dragging.drag?.id === item.id && plan.slotActive}
                    onMove={(intent) => void move(item.id, intent, true)}
                    onOpen={() => { if (!dragging.consumeClick()) onOpenItem(item.id); }}
                    onKeyDown={onCardKey(item)}
                    onPointerDown={onCardPointer(item)}
                    onFocus={() => setFocusedId(item.id)}
                  />
                )}
                onToggle={() => setCollapsed(isRail ? collapsed.filter((s) => s !== status) : [...collapsed, status])}
                onCapture={() => onCapture(status)}
              />
            );
          })}
        </div>
        {!narrow && (
          <>
            <button type="button" className="work-scroll-more work-scroll-more--start" data-scroll-more="start" aria-label="Show earlier columns" title="Show earlier columns"
              disabled={!edges.start} tabIndex={edges.start ? 0 : -1} onClick={() => scrollColumns(-1)}><span aria-hidden="true"><ChevronIcon /></span></button>
            <button type="button" className="work-scroll-more work-scroll-more--end" data-scroll-more="end" aria-label="Show more columns" title="Show more columns"
              disabled={!edges.end} tabIndex={edges.end ? 0 : -1} onClick={() => scrollColumns(1)}><span aria-hidden="true"><ChevronIcon /></span></button>
          </>
        )}
      </div>
      {ghostItem && createPortal(
        <div className="work-ui work-drag-ghost" ref={dragging.ghostRef} aria-hidden="true" data-settling={dragging.drag ? undefined : 'true'}>
          <div className={`work-card work-card--ghost${ghostItem.motivation ? ` work-card--why-${ghostItem.motivation}` : ''}`}>
            <CardFace item={ghostItem} today={today} />
          </div>
          <span className="work-drag-badge">{badge.current}</span>
        </div>,
        document.body,
      )}
      <p className="hq-sr-only" role="status" aria-live="polite">{announcement}</p>
    </div>
  );
}
