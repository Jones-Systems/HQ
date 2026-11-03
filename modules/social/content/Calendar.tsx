import { useEffect, useId, useLayoutEffect, useRef, useState, type DragEvent as ReactDragEvent, type PointerEvent as ReactPointerEvent } from 'react';
import {
  Button, Dialog, FieldError, InlineNotice, Splitter, StatusIndicator, TimeGrid, animateElement, calendarGridSnap, calendarZonedParts,
  fieldErrorProps, useToast, CALENDAR_HOUR_HEIGHT, type CalendarGridEvent,
} from '@hq/ui';
import { checkSlot, FEATURE_HQ_EDITORIAL_TIMEBOX, SLOT_MESSAGES, zonedSlotParts, type Draft, type PlanningSlot, type SocialSession, type SocialWorkspacePort, type WorkspaceSnapshot } from '../core';
import { EmptyState, SocialIcon } from '../ui';
import { changeDraft, errorText } from './actions';
import { CalendarChip, type CalendarChipHandlers } from './CalendarChip';
import { calendarRange, clockLabel, draftGridEvent, durationLabel, gridPlanning, shiftCalendarDay } from './calendar-time';
import { calendarPlan, contentDestination, dateLabel, monthGrid, monthLabel, nearestPlanned, shiftMonth, shortDateLabel } from './model';
import './calendar.css';

export interface CalendarProps {
  readonly session: SocialSession;
  readonly port: SocialWorkspacePort;
  readonly snapshot: WorkspaceSnapshot;
  readonly month: string;
  readonly brand: string;
  readonly onBrandChange: (brand: string) => void;
  readonly navigate: (destination: string) => void;
  readonly paused?: string;
  readonly now?: () => Date;
}
interface CalendarUndo { readonly draft: Draft; readonly plannedDate: string; readonly slot: PlanningSlot | null }
interface Landed { readonly id: string; readonly drag: boolean }
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const DRAG_THRESHOLD = 4;
const DRAG_TYPE = 'application/x-hq-social-draft';
/** The top-left padding of `.cal-ghost` in calendar.css: room for the lifted chip's shadow inside the drag image. */
const GHOST_PAD_X = 28;
const GHOST_PAD_Y = 16;
/** A success dismisses after eight seconds; its inverse stays available from the toolbar. */
const SUCCESS_MS = 8000;
const MOVE_TOAST = 'social-calendar-move';
const PROBLEM_TOAST = 'social-calendar-problem';
const NOTICE_TOAST = 'social-calendar-notice';
export const CALENDAR_NOTE = "Planned dates are editorial intent. Nothing on this calendar is posted. Work's planning dates stay in Work and aren't copied here.";
const systemNow = () => new Date();

/** Where a drop would land: a month day, an all-day lane, a time column or the No date yet tray. */
function dropKeyOf(target: Element | null): string | null {
  const time = target?.closest<HTMLElement>('[data-time-day]');
  if (time) return `time:${time.dataset.timeDay}`;
  const allDay = target?.closest<HTMLElement>('[data-grid-all-day]');
  if (allDay) return `allday:${allDay.dataset.gridAllDay}`;
  const cell = target?.closest<HTMLElement>('[data-drop-date]');
  if (!cell) return null;
  return cell.dataset.dropDate === '' ? 'tray' : `date:${cell.dataset.dropDate}`;
}

function slotMessage(slot: PlanningSlot): string {
  const [hours, minutes] = slot.start.split(':').map(Number) as [number, number];
  return `${clockLabel(hours * 60 + minutes)} (${slot.timezone}), ${durationLabel(slot.duration_minutes)}`;
}

export function Calendar({ session, port, snapshot, month, brand, onBrandChange, navigate, paused, now = systemNow }: CalendarProps) {
  const id = useId();
  const toast = useToast();
  const [zone] = useState(() => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC');
  const [clock, setClock] = useState(now);
  const today = zonedSlotParts(clock.getTime(), zone).date;
  const [view, setView] = useState<'month' | 'week' | 'day'>('month');
  const [agenda, setAgenda] = useState(false);
  const nextView = view === 'month' ? 'week' : view === 'week' ? 'day' : 'month';
  const labelView = (value: string) => value[0]!.toUpperCase() + value.slice(1);
  const [anchor, setAnchor] = useState(today.startsWith(month) ? today : `${month}-01`);
  const [selected, setSelected] = useState<Draft | null>(null);
  const [pickedDate, setPickedDate] = useState('');
  const [withTime, setWithTime] = useState(false);
  const [pickedTime, setPickedTime] = useState('09:00');
  const [duration, setDuration] = useState(30);
  const [dialogError, setDialogError] = useState('');
  const [undoOffer, setUndoOffer] = useState<CalendarUndo | null>(null);
  const undoRef = useRef<CalendarUndo | null>(null);
  const title = useRef<HTMLHeadingElement>(null);
  const focusTitle = useRef(false);
  const pendingMonth = useRef<string | null>(null);
  const [moving, setMoving] = useState(false);
  const busy = useRef(false);
  const [uncertain, setUncertain] = useState<string[]>(() => {
    const value = session.getState().view.calendarUncertain;
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
  });
  const drag = useRef<{ draft: Draft; x: number; y: number; active: boolean; pointerId: number } | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [overKey, setOverKey] = useState<string | null>(null);
  const dragEndedAt = useRef(-Infinity);
  const dragLanding = useRef(false);
  const [landed, setLanded] = useState<Landed | null>(null);
  const body = useRef<HTMLDivElement>(null);
  const rememberedTray = useRef(240);
  const [trayWidth, setTrayWidth] = useState(() => {
    const value = session.getState().view.calendarTrayWidth;
    return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 420 ? value : 240;
  });
  const supported = snapshot.features.includes(FEATURE_HQ_EDITORIAL_TIMEBOX);
  const plan = calendarPlan(snapshot.content, brand);
  const active = snapshot.content.filter((draft) => !draft.archived && (brand === 'all' || draft.brand_id === brand));
  const monthDates = new Map<string, Draft[]>();
  for (const draft of active) {
    const day = draft.planning_slot ? draftGridEvent(draft, zone)?.day : draft.planned_date;
    if (day) monthDates.set(day, [...(monthDates.get(day) ?? []), draft]);
  }
  const brandName = (brandId: string) => snapshot.brands.find((item) => item.id === brandId)?.name ?? 'Unknown brand';
  const disabled = (draft: Draft) => Boolean(paused) || moving || uncertain.includes(draft.id);
  /** A neutral one-line notice (a cancelled drag, a stale grid). Outcomes use the move and problem toasts below. */
  const announce = (message: string) => { toast.show({ id: NOTICE_TOAST, tone: 'info', title: message }); };
  useEffect(() => { const timer = window.setInterval(() => setClock(now()), 60_000); return () => window.clearInterval(timer); }, [now]);
  useEffect(() => {
    if (pendingMonth.current === month) { pendingMonth.current = null; return; }
    setAnchor((current) => current.startsWith(month) ? current : today.startsWith(month) ? today : `${month}-01`);
  }, [month]);
  useEffect(() => {
    if (focusTitle.current) { title.current?.focus(); focusTitle.current = false; }
  }, [view, anchor]);
  useLayoutEffect(() => { body.current?.style.setProperty('--cal-tray-width', `${trayWidth}px`); }, [trayWidth]);
  const resizeTray = (width: number) => {
    const next = width < 72 ? 0 : width;
    if (next > 0) rememberedTray.current = next;
    setTrayWidth(next); session.setView('calendarTrayWidth', next);
  };

  // The grid highlights a time column or all-day lane under a drag through an attribute: those elements belong to the shared grid.
  useEffect(() => {
    const root = body.current;
    if (!root || !overKey) return undefined;
    const target = overKey.startsWith('time:') ? root.querySelector(`[data-time-day="${overKey.slice(5)}"]`)
      : overKey.startsWith('allday:') ? root.querySelector(`[data-grid-all-day="${overKey.slice(7)}"]`) : null;
    target?.setAttribute('data-drop-active', '');
    return () => target?.removeAttribute('data-drop-active');
  }, [overKey]);

  // Opening a week or day that holds today puts the now line in view rather than at the grid's 7 a.m. default,
  // starting early enough that the day's first timed entry is not cut off at the top.
  useLayoutEffect(() => {
    if (agenda || view === 'month') return;
    const rows = body.current?.querySelector<HTMLElement>('.hq-calendar-time-rows');
    const days = calendarRange(anchor, view);
    if (rows && days.includes(today)) {
      const first = Math.min(...active.flatMap((draft) => { const event = draftGridEvent(draft, zone); return event && days.includes(event.day) ? [event.start] : []; }), Infinity);
      rows.scrollTop = Math.max(0, Math.min(calendarZonedParts(clock, zone).minute - 150, first - 30)) * CALENDAR_HOUR_HEIGHT / 60;
    }
  }, [view, agenda, anchor]);

  // The shared grid knows nothing of channels: each timed entry takes its channel's colour bar from the draft it shows.
  useLayoutEffect(() => {
    for (const holder of body.current?.querySelectorAll<HTMLElement>('[data-event-id]') ?? []) {
      const channel = active.find((draft) => draft.id === holder.dataset.eventId)?.channel;
      if (channel) holder.dataset.channel = channel;
    }
  });

  // A moved draft settles into its new place with a spring and a colour wash that says where it landed.
  useLayoutEffect(() => {
    const root = body.current;
    if (!landed || !root) return undefined;
    const targets = [...root.querySelectorAll<HTMLElement>(`[data-chip-id="${landed.id}"], [data-event-id="${landed.id}"] .hq-calendar-time-event-body`)];
    for (const element of targets) {
      if (landed.drag) animateElement(element, [{ transform: 'translateY(-6px) scale(1.04)', boxShadow: 'var(--hq-shadow-drag)' }, { transform: 'none', boxShadow: 'none' }], { duration: 'slow', easing: 'spring' });
      element.classList.add('hq-flash');
    }
    const timer = window.setTimeout(() => { for (const element of targets) element.classList.remove('hq-flash'); }, 1300);
    return () => { window.clearTimeout(timer); for (const element of targets) element.classList.remove('hq-flash'); };
  }, [landed]);

  /** One versioned date/slot save. Unknown outcomes get one read, never an automatic second save. */
  async function move(draft: Draft, plannedDate: string, slot: PlanningSlot | null = draft.planning_slot ?? null, isUndo = false) {
    const fromDrag = dragLanding.current;
    dragLanding.current = false;
    if (busy.current || disabled(draft)) return;
    if (!plannedDate) slot = null;
    if (draft.planned_date === plannedDate && JSON.stringify(draft.planning_slot ?? null) === JSON.stringify(slot)) return;
    const checked = checkSlot(slot, plannedDate, snapshot.features);
    if (!checked.ok) { toast.error(errorText(checked.error), { id: PROBLEM_TOAST }); return; }
    busy.current = true; setMoving(true);
    const result = await changeDraft(session, port, draft, { planned_date: plannedDate,
      ...(supported ? { planning_slot: checked.value ?? null } : {}) }, true);
    busy.current = false; setMoving(false);
    if (!result.ok) {
      const lead = `${isUndo ? 'Could not undo' : 'Not moved'}: ${errorText(result.error)}`;
      const note = result.reconciliation === 'not-applied' ? 'The workspace read confirmed no change; you can try again explicitly.' : undefined;
      if (result.error.kind === 'unknown') {
        if (result.reconciliation !== 'not-applied') {
          const next = [...new Set([...uncertain, draft.id])];
          setUncertain(next); session.setView('calendarUncertain', next);
        }
        toast.unknown(lead, { id: PROBLEM_TOAST, ...(note ? { description: note } : {}), meta: 'Nothing was resent' });
      } else toast.error(lead, { id: PROBLEM_TOAST, ...(note ? { description: note } : {}) });
      return;
    }
    const message = isUndo ? `Undone. “${draft.title}” is ${plannedDate ? `planned for ${dateLabel(plannedDate)}` : 'back in No date yet'}.`
      : plannedDate ? `Moved “${draft.title}” to ${dateLabel(plannedDate)}${slot ? ` at ${slotMessage(slot)}` : ''}.`
        : `Cleared the planned date of “${draft.title}”.`;
    const undo = isUndo ? null : { draft: result.draft, plannedDate: draft.planned_date, slot: draft.planning_slot ?? null };
    undoRef.current = undo; setUndoOffer(undo);
    setLanded({ id: draft.id, drag: fromDrag });
    toast.show({
      id: MOVE_TOAST, tone: 'success', title: message, duration: SUCCESS_MS, meta: 'Planning change only · nothing posted',
      ...(undo ? { action: { label: 'Undo', onAction: undoLastChange } } : {}),
    });
  }

  function undoLastChange() {
    const undo = undoRef.current;
    if (!undo || busy.current || disabled(undo.draft)) return;
    undoRef.current = null; setUndoOffer(null); toast.dismiss(MOVE_TOAST);
    void move(undo.draft, undo.plannedDate, undo.slot, true);
  }

  function openDialog(draft: Draft) {
    setSelected(draft); setPickedDate(draft.planned_date || anchor); setWithTime(Boolean(draft.planning_slot));
    setPickedTime(draft.planning_slot?.start ?? '09:00'); setDuration(draft.planning_slot?.duration_minutes ?? 30); setDialogError('');
  }
  function saveDialog() {
    if (!selected) return;
    const slot = withTime ? { start: pickedTime, duration_minutes: duration, timezone: selected.planning_slot?.timezone ?? zone } : null;
    const checked = checkSlot(slot, pickedDate, snapshot.features);
    if (!checked.ok) { setDialogError(checked.error.message); return; }
    const target = selected; setSelected(null); void move(target, pickedDate, checked.value ?? null);
  }
  function gridChange(draft: Draft, day: string, minute: number, resize = false) {
    if (!supported || disabled(draft)) return;
    const change = gridPlanning(draft, day, minute, resize, zone);
    if (!change.ok) toast.error(errorText(change.error), { id: PROBLEM_TOAST });
    else void move(draft, change.value.planned_date, change.value.planning_slot);
  }
  function moveMonth(draft: Draft, day: string) {
    const event = day && draft.planning_slot ? draftGridEvent(draft, zone) : null;
    if (event) gridChange(draft, day, event.start);
    else void move(draft, day);
  }
  const eventDraft = (event: CalendarGridEvent): Draft | undefined => snapshot.content.find((draft) => draft.id === event.id && draft.version === event.revision);

  function onPointerDown(event: ReactPointerEvent<HTMLButtonElement>, draft: Draft) {
    if (event.button !== 0 || disabled(draft)) return;
    drag.current = { draft, x: event.clientX, y: event.clientY, active: false, pointerId: event.pointerId };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }
  function onPointerMove(event: ReactPointerEvent<HTMLButtonElement>) {
    const state = drag.current;
    if (!state || state.pointerId !== event.pointerId) return;
    if (!state.active) {
      if (Math.hypot(event.clientX - state.x, event.clientY - state.y) < DRAG_THRESHOLD) return;
      state.active = true; setDragging(state.draft.id);
    }
    setOverKey(dropKeyOf(document.elementFromPoint?.(event.clientX, event.clientY) ?? null));
  }
  function onPointerUp(event: ReactPointerEvent<HTMLButtonElement>) {
    const state = drag.current; drag.current = null; setDragging(null); setOverKey(null);
    if (!state?.active || state.pointerId !== event.pointerId) return;
    event.preventDefault(); dragEndedAt.current = performance.now();
    const hit = document.elementFromPoint?.(event.clientX, event.clientY);
    // `move` reads the landing flag before its first await, so it is cleared again as soon as the call returns.
    dragLanding.current = true;
    try {
      const timed = hit?.closest<HTMLElement>('[data-time-day]');
      if (timed) {
        const rect = timed.getBoundingClientRect();
        gridChange(state.draft, timed.dataset.timeDay!, calendarGridSnap((event.clientY - rect.top) * 60 / CALENDAR_HOUR_HEIGHT)); return;
      }
      const allDay = hit?.closest<HTMLElement>('[data-grid-all-day]');
      if (allDay) { void move(state.draft, allDay.dataset.gridAllDay!, null); return; }
      const target = hit?.closest<HTMLElement>('[data-drop-date]');
      if (target) moveMonth(state.draft, target.dataset.dropDate ?? '');
    } finally { dragLanding.current = false; }
  }
  /** Native drags show the chip lifted: a copy with its shadow becomes the drag image while the original dims in place. */
  function liftImage(event: ReactDragEvent<HTMLButtonElement>) {
    const source = event.currentTarget;
    const rect = source.getBoundingClientRect();
    const wrapper = document.createElement('div');
    wrapper.className = 'cal-ghost';
    wrapper.setAttribute('aria-hidden', 'true');
    const copy = source.cloneNode(true) as HTMLElement;
    copy.classList.add('cal-chip--lifted');
    copy.removeAttribute('data-dragging');
    // The copy sits in its own chip container at the original width, so it keeps the layout it had in its cell.
    const frame = document.createElement('div');
    frame.className = 'cal-chip-item';
    frame.style.setProperty('width', `${rect.width}px`);
    frame.append(copy);
    wrapper.append(frame);
    document.body.append(wrapper);
    try {
      event.dataTransfer.setDragImage(wrapper, event.clientX - rect.left + GHOST_PAD_X, event.clientY - rect.top + GHOST_PAD_Y);
    } catch {
      // A host without drag images keeps the browser's own drag preview.
    }
    window.setTimeout(() => wrapper.remove(), 0);
  }
  const chipHandlers = (draft: Draft): CalendarChipHandlers => ({
    // A completed pointer drag is followed by a click; suppress only that synthetic activation.
    onClick: () => { if (performance.now() - dragEndedAt.current >= 400) openDialog(draft); },
    onPointerDown: (event) => onPointerDown(event, draft),
    onPointerMove,
    onPointerUp,
    onPointerCancel: () => { drag.current = null; setDragging(null); setOverKey(null); },
    onDragStart: (event) => {
      drag.current = null;
      event.dataTransfer.setData(DRAG_TYPE, draft.id);
      event.dataTransfer.effectAllowed = 'move';
      liftImage(event);
      setDragging(draft.id);
    },
    onDragEnd: () => { setDragging(null); setOverKey(null); },
  });
  const chip = (draft: Draft) => <CalendarChip key={draft.id} draft={draft} brandName={brandName(draft.brand_id)} zone={zone}
    disabled={disabled(draft)} dragging={dragging === draft.id} unknown={uncertain.includes(draft.id)} handlers={chipHandlers(draft)} />;
  const acceptDrop = (event: ReactDragEvent) => { if (event.dataTransfer?.types.includes(DRAG_TYPE)) event.preventDefault(); };
  const drop = (event: ReactDragEvent, day: string, minute?: number) => {
    event.preventDefault();
    setOverKey(null);
    const draft = active.find((item) => item.id === event.dataTransfer.getData(DRAG_TYPE));
    if (!draft) return;
    dragLanding.current = true;
    try {
      if (minute !== undefined) gridChange(draft, day, minute);
      else if (view === 'month') moveMonth(draft, day);
      else void move(draft, day, null);
    } finally { dragLanding.current = false; }
  };
  function goTo(day: string) {
    setAnchor(day);
    if (day.slice(0, 7) !== month) {
      pendingMonth.current = day.slice(0, 7);
      navigate(contentDestination({ page: 'calendar', month: day.slice(0, 7) }));
    }
  }
  function selectView(next: 'month' | 'week' | 'day') {
    if (view === 'month' && next !== 'month') goTo(anchor.startsWith(month) ? anchor : today.startsWith(month) ? today : `${month}-01`);
    else if (next === 'month') goTo(anchor);
    setView(next);
  }
  function openDay(day: string, next: 'week' | 'day') {
    focusTitle.current = true; goTo(day); setView(next);
  }
  function rangeNavigate(delta: number) {
    if (view === 'month') navigate(contentDestination({ page: 'calendar', month: shiftMonth(month, delta) }));
    else goTo(shiftCalendarDay(anchor, delta * (view === 'week' ? 7 : 1)));
  }
  const days = calendarRange(anchor, view === 'day' ? 'day' : 'week');
  const first = view === 'month' ? `${month}-01` : days[0]!;
  const last = view === 'month' ? `${month}-31` : days[days.length - 1]!;
  const inRange = (day: string) => first <= day && day <= last;
  const rangeDrafts = [...monthDates].filter(([day]) => inRange(day)).sort(([a], [b]) => a.localeCompare(b));
  const nearest = nearestPlanned(monthDates.keys(), first, last);
  const rangeWord = view === 'month' ? 'this month' : view === 'week' ? 'this week' : 'on this day';
  const nudge = nearest && (
    <p className="cal-next hq-enter-fade">
      <span>Nothing planned {rangeWord}.</span>
      <Button size="sm" variant="secondary" onClick={() => goTo(nearest.date)}>
        {nearest.direction === 'after'
          ? <>Next planned: {shortDateLabel(nearest.date, first)}<SocialIcon name="arrow-right" /></>
          : <><SocialIcon name="chevron-left" />Last planned: {shortDateLabel(nearest.date, first)}</>}
      </Button>
    </p>
  );
  return <section className="cal" aria-labelledby={`${id}-heading`}>
    <header className="cal-bar">
      <div className="cal-nav">
        <Button size="sm" variant="secondary" onClick={() => rangeNavigate(-1)} aria-label={`Previous ${view}`}><SocialIcon name="chevron-left" /></Button>
        <Button size="sm" variant="secondary" onClick={() => goTo(today)} title="Go to today">Today</Button>
        <Button size="sm" variant="secondary" onClick={() => rangeNavigate(1)} aria-label={`Next ${view}`}><SocialIcon name="chevron-right" /></Button>
      </div>
      <h2 ref={title} tabIndex={-1} id={`${id}-heading`}>{view === 'month' ? monthLabel(month) : view === 'day' ? dateLabel(anchor) : `${dateLabel(days[0]!)} – ${dateLabel(days[6]!)}`}</h2>
      <div className="cal-bar-end">
        {moving && <StatusIndicator tone="info" busy label="Saving" live={false} />}
        {undoOffer && <Button size="sm" variant="ghost" disabled={disabled(undoOffer.draft)} onClick={undoLastChange} aria-label="Undo last calendar change"
          title="Undo the last calendar change"><SocialIcon name="undo" />Undo</Button>}
        <label className="cal-brand"><span>Brand</span><select value={brand} onChange={(event) => onBrandChange(event.target.value)}>
          <option value="all">All brands</option>{snapshot.brands.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select></label>
        <div className="cal-views" role="group" aria-label="Calendar view">
          <Button size="sm" aria-pressed={agenda} onClick={() => setAgenda(!agenda)}>Agenda</Button>
          <Button size="sm" aria-pressed={!agenda}
            aria-label={`Calendar view: ${labelView(view)}. ${agenda ? 'Return to' : 'Switch to'} ${labelView(agenda ? view : nextView)}`}
            onClick={() => { if (agenda) setAgenda(false); else selectView(nextView); }}>{labelView(view)}</Button>
        </div>
      </div>
    </header>
    <p className="cal-note" role="note">{CALENDAR_NOTE}</p>
    {nudge}
    {!supported && <InlineNotice tone="info" variant="bar" live="off" title="Time grid is read-only">{SLOT_MESSAGES.unsupported}. Date-only planning remains available.</InlineNotice>}
    {paused && <InlineNotice tone="warning" variant="bar" live="off" title="Moves are paused">{paused}</InlineNotice>}
    {uncertain.length > 0 && <InlineNotice tone="unknown" variant="bar" title="Some moves are paused">
      Moves for drafts with an unresolved save are paused. Reload and inspect the stored draft before making another change.
    </InlineNotice>}
    <div className="cal-body" ref={body} data-tray-collapsed={trayWidth === 0 || undefined}
      onDragOver={(event) => { if (event.dataTransfer?.types.includes(DRAG_TYPE)) setOverKey(dropKeyOf(event.target as Element)); }}
      onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOverKey(null); }}>
      <div className="cal-main">
        {agenda ? <section className="cal-agenda" aria-label="Planned drafts agenda">
          {rangeDrafts.map(([day, drafts]) => <section key={day} className="cal-agenda-day">
            <h3>{dateLabel(day)}{day === today && <span className="cal-today-tag">Today</span>}</h3><ul className="cal-chips">{drafts.map(chip)}</ul>
          </section>)}
          {rangeDrafts.length === 0 && <EmptyState icon="calendar" title="No planned drafts in this range.">Plan a draft by dragging it from No date yet onto a day.</EmptyState>}
        </section> : view === 'month' ? <table className="cal-month" aria-label={`Planned drafts, ${monthLabel(month)}`}>
          <thead><tr>{WEEKDAYS.map((day) => <th key={day} scope="col">{day}</th>)}</tr></thead>
          <tbody>{monthGrid(month, today).map((week) => <tr key={week[0]!.date}>{week.map((day) => {
            const items = monthDates.get(day.date) ?? [];
            return <td key={day.date} className="cal-cell" data-drop-date={day.date} data-outside={!day.inMonth || undefined} aria-current={day.isToday ? 'date' : undefined}
              data-drop-active={overKey === `date:${day.date}` || undefined} onDragOver={acceptDrop} onDrop={(event) => drop(event, day.date)}>
              <div className="cal-day-head" title="Double-click to open this week" onDoubleClick={() => openDay(day.date, 'week')}>
                <button type="button" className="cal-day-number" aria-label={`Open week of ${dateLabel(day.date)}`}
                  onClick={(event) => { if (event.detail === 0) openDay(day.date, 'week'); }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openDay(day.date, 'week'); }
                  }}>{Number(day.date.slice(8))}{day.isToday && <span className="hq-sr-only"> (today)</span>}</button>
              </div>
              {items.length > 0 && <ul className="cal-chips" aria-label={dateLabel(day.date)}>{items.map(chip)}</ul>}
            </td>;
          })}</tr>)}</tbody>
        </table> : <TimeGrid days={days} onOpenDay={view === 'week' ? (day) => openDay(day, 'day') : undefined} events={active.flatMap((draft) => { const event = draftGridEvent(draft, zone, disabled(draft) || !supported); return event ? [event] : []; })} zone={zone} now={clock}
          onChange={(event, day, minute, resize) => { const draft = eventDraft(event); if (draft) gridChange(draft, day, minute, resize); }}
          onAllDay={(event, day) => { const draft = eventDraft(event); if (draft) void move(draft, day, null); }}
          onRemove={(event) => { const draft = eventDraft(event); if (draft) void move(draft, '', null); }}
          onOpen={(event) => { const draft = eventDraft(event); if (draft) openDialog(draft); }} onAnnounce={announce}
          renderAllDay={(day) => <ul className="cal-chips">{(plan.byDate.get(day) ?? []).filter((draft) => !draft.planning_slot).map(chip)}</ul>}
          acceptDrop={acceptDrop} onDrop={drop} />}
      </div>
      <Splitter label="Undated drafts tray width" side="end" value={trayWidth} min={0} max={420} onResize={resizeTray} onToggle={() => resizeTray(trayWidth ? 0 : rememberedTray.current)} />
      <aside className="cal-tray" data-drop-date="" data-calendar-remove="" data-drop-active={overKey === 'tray' || undefined} aria-labelledby={`${id}-tray`} onDragOver={acceptDrop} onDrop={(event) => drop(event, '')}>
        <div className="cal-tray-head">
          <h3 id={`${id}-tray`}>No date yet</h3>
          {plan.undated.length > 0 && <span className="cal-count" aria-hidden="true">{plan.undated.length}</span>}
          <Button size="sm" variant="ghost" className="cal-tray-toggle" aria-label={trayWidth ? 'Collapse undated drafts' : 'Show undated drafts'}
            title={trayWidth ? 'Collapse undated drafts' : 'Show undated drafts'} onClick={() => resizeTray(trayWidth ? 0 : rememberedTray.current)}>
            <SocialIcon name={trayWidth ? 'chevron-right' : 'chevron-left'} />
          </Button>
        </div>
        {trayWidth > 0 && <>
          <p className="cal-tray-hint">Drag a draft onto a day to plan it. Drop one here to clear its date.</p>
          {plan.undated.length
            ? <ul className="cal-chips">{plan.undated.map(chip)}</ul>
            : <EmptyState icon="check" title="Everything is planned">Every active draft has a planned date.</EmptyState>}
        </>}
      </aside>
    </div>
    <Dialog open={selected !== null} onClose={() => setSelected(null)} title={selected ? `“${selected.title}”` : ''}
      description={selected ? `${brandName(selected.brand_id)} · ${selected.channel} · ${selected.planned_date ? `Planned ${dateLabel(selected.planned_date)}` : 'No date yet'}` : undefined}
      actions={selected && <>
        <Button variant="ghost" onClick={() => setSelected(null)}>Cancel</Button>
        <Button variant="ghost" onClick={() => { const target = selected; setSelected(null); navigate(contentDestination({ page: 'library', draftId: target.id })); }}>Open draft</Button>
        {selected.planned_date && <Button variant="secondary" disabled={disabled(selected)} onClick={() => { const target = selected; setSelected(null); void move(target, '', null); }}>Clear date</Button>}
        <Button variant="primary" disabled={disabled(selected) || !pickedDate || (pickedDate === selected.planned_date && withTime === Boolean(selected.planning_slot) && (!withTime || (pickedTime === selected.planning_slot?.start && duration === selected.planning_slot?.duration_minutes)))} onClick={saveDialog}>{withTime ? 'Save planning time' : 'Move to date'}</Button>
      </>}>
      <div className="cal-field"><label htmlFor={`${id}-date`}>Planned date</label><input id={`${id}-date`} type="date" value={pickedDate} onChange={(event) => setPickedDate(event.target.value)}
        aria-describedby={`${id}-date-hint${dialogError ? ` ${id}-slot-error` : ''}`} aria-invalid={dialogError ? true : undefined} />
        <small id={`${id}-date-hint`} className="hq-meta">An editorial planning label only; nothing is posted.</small></div>
      <label className="cal-check"><input type="checkbox" checked={withTime} disabled={!supported} onChange={(event) => setWithTime(event.target.checked)} />Set time</label>
      {withTime && <>
        <label className="cal-field">Start time<input type="time" step={900} value={pickedTime} onChange={(event) => { setPickedTime(event.target.value); if (!selected?.planning_slot) setDuration(event.target.value === '23:45' ? 15 : 30); }} {...fieldErrorProps(`${id}-slot-error`, dialogError)} /></label>
        <label className="cal-field">Duration (minutes)<input type="number" min={15} max={1440} step={15} value={duration} onChange={(event) => setDuration(Number(event.target.value))} {...fieldErrorProps(`${id}-slot-error`, dialogError)} /></label>
        <p className="hq-meta">Time zone: {selected?.planning_slot?.timezone ?? zone}</p>
      </>}
      <FieldError id={`${id}-slot-error`} announce>{dialogError}</FieldError>
    </Dialog>
  </section>;
}
