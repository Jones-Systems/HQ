import { useEffect, useId, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { Button, Dialog, Menu, Splitter, StatusChip, TimeGrid, Toast, ToastRegion, TOAST_AUTO_DISMISS_MS, calendarGridSnap, CALENDAR_HOUR_HEIGHT, type CalendarGridEvent } from '@hq/ui';
import { checkSlot, FEATURE_HQ_EDITORIAL_TIMEBOX, SLOT_MESSAGES, zonedSlotParts, type Draft, type PlanningSlot, type SocialSession, type SocialWorkspacePort, type WorkspaceSnapshot } from '../core';
import { changeDraft, errorText } from './actions';
import { calendarPlan, contentDestination, dateLabel, monthGrid, monthLabel, shiftMonth } from './model';
import { calendarRange, draftGridEvent, gridPlanning, shiftCalendarDay } from './calendar-time';
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
interface ToastState {
  readonly id: number;
  readonly message: string;
  readonly success?: boolean;
  readonly undo?: CalendarUndo;
}
interface CalendarUndo { readonly draft: Draft; readonly plannedDate: string; readonly slot: PlanningSlot | null }
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const DRAG_THRESHOLD = 4;
const DRAG_TYPE = 'application/x-hq-social-draft';
export const CALENDAR_NOTE = "Planned dates are editorial intent. Nothing on this calendar is posted. Work's planning dates stay in Work and aren't copied here.";
const systemNow = () => new Date();

export function Calendar({ session, port, snapshot, month, brand, onBrandChange, navigate, paused, now = systemNow }: CalendarProps) {
  const id = useId();
  const [zone] = useState(() => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC');
  const [clock, setClock] = useState(now);
  const today = zonedSlotParts(clock.getTime(), zone).date;
  const [view, setView] = useState<'month' | 'week' | 'day'>('month');
  const [anchor, setAnchor] = useState(today.startsWith(month) ? today : `${month}-01`);
  const [selected, setSelected] = useState<Draft | null>(null);
  const [pickedDate, setPickedDate] = useState('');
  const [withTime, setWithTime] = useState(false);
  const [pickedTime, setPickedTime] = useState('09:00');
  const [duration, setDuration] = useState(30);
  const [dialogError, setDialogError] = useState('');
  const [toast, setToast] = useState<ToastState | null>(null);
  const notificationId = useRef(0);
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
  const dragEndedAt = useRef(-Infinity);
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
  const announce = (message: string) => { setToast({ id: ++notificationId.current, message }); };
  useEffect(() => { const timer = window.setInterval(() => setClock(now()), 60_000); return () => window.clearInterval(timer); }, [now]);
  useEffect(() => {
    if (pendingMonth.current === month) { pendingMonth.current = null; return; }
    setAnchor((current) => current.startsWith(month) ? current : today.startsWith(month) ? today : `${month}-01`);
  }, [month]);
  useEffect(() => {
    if (focusTitle.current) { title.current?.focus(); focusTitle.current = false; }
  }, [view, anchor]);
  useLayoutEffect(() => { body.current?.style.setProperty('--soc-calendar-tray-width', `${trayWidth}px`); }, [trayWidth]);
  const resizeTray = (width: number) => {
    const next = width < 72 ? 0 : width;
    if (next > 0) rememberedTray.current = next;
    setTrayWidth(next); session.setView('calendarTrayWidth', next);
  };

  /** One versioned date/slot save. Unknown outcomes get one read, never an automatic second save. */
  async function move(draft: Draft, plannedDate: string, slot: PlanningSlot | null = draft.planning_slot ?? null, isUndo = false) {
    if (busy.current || disabled(draft)) return;
    if (!plannedDate) slot = null;
    if (draft.planned_date === plannedDate && JSON.stringify(draft.planning_slot ?? null) === JSON.stringify(slot)) return;
    const checked = checkSlot(slot, plannedDate, snapshot.features);
    if (!checked.ok) { announce(errorText(checked.error)); return; }
    busy.current = true; setMoving(true);
    const result = await changeDraft(session, port, draft, { planned_date: plannedDate,
      ...(supported ? { planning_slot: checked.value ?? null } : {}) }, true);
    busy.current = false; setMoving(false);
    if (!result.ok) {
      if (result.error.kind === 'unknown' && result.reconciliation !== 'not-applied') {
        const next = [...new Set([...uncertain, draft.id])];
        setUncertain(next); session.setView('calendarUncertain', next);
      }
      announce(`${isUndo ? 'Could not undo' : 'Not moved'}: ${errorText(result.error)}${result.reconciliation === 'not-applied' ? ' The workspace read confirmed no change; you can try again explicitly.' : ''}`);
      return;
    }
    const message = isUndo ? `Undone. “${draft.title}” is ${plannedDate ? `planned for ${dateLabel(plannedDate)}` : 'back in No date yet'}.`
      : plannedDate ? `Moved “${draft.title}” to ${dateLabel(plannedDate)}${slot ? ` at ${slot.start} (${slot.timezone}), ${slot.duration_minutes} minutes` : ''}.`
      : `Cleared the planned date of “${draft.title}”.`;
    const undo = isUndo ? null : { draft: result.draft, plannedDate: draft.planned_date, slot: draft.planning_slot ?? null };
    undoRef.current = undo; setUndoOffer(undo);
    setToast({ id: ++notificationId.current, message, success: true, ...(undo ? { undo } : {}) });
  }

  function undoLastChange() {
    const undo = undoRef.current;
    if (!undo || busy.current || disabled(undo.draft)) return;
    undoRef.current = null; setUndoOffer(null); setToast(null);
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
    if (!change.ok) announce(errorText(change.error));
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
    if (!state || state.pointerId !== event.pointerId || state.active) return;
    if (Math.hypot(event.clientX - state.x, event.clientY - state.y) >= DRAG_THRESHOLD) { state.active = true; setDragging(state.draft.id); }
  }
  function onPointerUp(event: ReactPointerEvent<HTMLButtonElement>) {
    const state = drag.current; drag.current = null; setDragging(null);
    if (!state?.active || state.pointerId !== event.pointerId) return;
    event.preventDefault(); dragEndedAt.current = performance.now();
    const hit = document.elementFromPoint?.(event.clientX, event.clientY);
    const timed = hit?.closest<HTMLElement>('[data-time-day]');
    if (timed) {
      const rect = timed.getBoundingClientRect();
      gridChange(state.draft, timed.dataset.timeDay!, calendarGridSnap((event.clientY - rect.top) * 60 / CALENDAR_HOUR_HEIGHT)); return;
    }
    const allDay = hit?.closest<HTMLElement>('[data-grid-all-day]');
    if (allDay) { void move(state.draft, allDay.dataset.gridAllDay!, null); return; }
    const target = hit?.closest<HTMLElement>('[data-drop-date]');
    if (target) moveMonth(state.draft, target.dataset.dropDate ?? '');
  }
  // A completed pointer drag is followed by a click; suppress only that synthetic activation.
  const chip = (draft: Draft) => <li key={draft.id}>
    <button type="button" className="soc-chip" data-dragging={dragging === draft.id || undefined} disabled={disabled(draft)}
      aria-label={`${draft.title}, ${draft.channel}, ${brandName(draft.brand_id)}. ${draft.planned_date ? `Planned ${dateLabel(draft.planned_date)}` : 'No date yet'}. Move or open`}
      draggable={!disabled(draft)} onDragStart={(event) => { drag.current = null; event.dataTransfer.setData(DRAG_TYPE, draft.id); }}
      onClick={() => { if (performance.now() - dragEndedAt.current >= 400) openDialog(draft); }}
      onPointerDown={(event) => onPointerDown(event, draft)} onPointerMove={onPointerMove} onPointerUp={onPointerUp}
      onPointerCancel={() => { drag.current = null; setDragging(null); }}>
      <span className="soc-chip-channel">{draft.channel}</span><span className="soc-chip-title">{draft.title}</span>
      {draft.planning_slot && <span>{draft.planning_slot.start} · {draft.planning_slot.duration_minutes}m · {draft.planning_slot.timezone}</span>}
    </button>
  </li>;
  const acceptDrop = (event: React.DragEvent) => { if (event.dataTransfer.types.includes(DRAG_TYPE)) event.preventDefault(); };
  const drop = (event: React.DragEvent, day: string, minute?: number) => {
    event.preventDefault();
    const draft = active.find((item) => item.id === event.dataTransfer.getData(DRAG_TYPE));
    if (!draft) return;
    if (minute !== undefined) gridChange(draft, day, minute);
    else if (view === 'month') moveMonth(draft, day);
    else void move(draft, day, null);
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
  return <section className="soc-calendar" aria-labelledby={`${id}-heading`}>
    <header className="soc-calendar-head">
      <h2 ref={title} tabIndex={-1} id={`${id}-heading`}>{view === 'month' ? monthLabel(month) : view === 'day' ? dateLabel(anchor) : `${dateLabel(days[0]!)} – ${dateLabel(days[6]!)}`}</h2>
      <span className="soc-inline">
        <Button size="sm" variant="secondary" onClick={() => rangeNavigate(-1)} aria-label={`Previous ${view}`}>←</Button>
        <Button size="sm" variant="secondary" onClick={() => goTo(today)}>{view === 'month' ? 'This month' : 'Today'}</Button>
        <Button size="sm" variant="secondary" onClick={() => rangeNavigate(1)} aria-label={`Next ${view}`}>→</Button>
      </span>
      <div className="soc-inline" role="group" aria-label="Calendar view">
        <Menu size="sm" trigger={`${view[0]!.toUpperCase() + view.slice(1)} ▾`}
          triggerLabel={`Calendar view: ${view[0]!.toUpperCase() + view.slice(1)}`}
          items={(['month', 'week', 'day'] as const).map((value) => ({
            id: value, label: value[0]!.toUpperCase() + value.slice(1), checked: view === value,
            onSelect: () => selectView(value),
          }))} />
      </div>
      {undoOffer && <Button size="sm" variant="ghost" disabled={disabled(undoOffer.draft)} onClick={undoLastChange}>Undo last calendar change</Button>}
      <label className="soc-field soc-field--inline"><span>Brand</span><select value={brand} onChange={(event) => onBrandChange(event.target.value)}>
        <option value="all">All brands</option>{snapshot.brands.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
      </select></label>
    </header>
    <p className="soc-note" role="note">{CALENDAR_NOTE}</p>
    {!supported && <p className="soc-note" role="note">{SLOT_MESSAGES.unsupported}. The time grid is read-only; date-only planning remains available.</p>}
    {paused && <p className="soc-note soc-note--warning" role="note">{paused} Moves are paused.</p>}
    {uncertain.length > 0 && <p role="alert">Moves for drafts with an unresolved save are paused. Reload and inspect the stored draft before making another change.</p>}
    <div className="soc-calendar-body soc-calendar-layout" ref={body} data-tray-collapsed={trayWidth === 0 || undefined}>
      <div className="soc-calendar-main">
        {view === 'month' ? <table className="soc-month" aria-label={`Planned drafts, ${monthLabel(month)}`}>
          <thead><tr>{WEEKDAYS.map((day) => <th key={day} scope="col">{day}</th>)}</tr></thead>
          <tbody>{monthGrid(month, today).map((week) => <tr key={week[0]!.date}>{week.map((day) => {
            const items = monthDates.get(day.date) ?? [];
            return <td key={day.date} data-drop-date={day.date} data-outside={!day.inMonth || undefined} aria-current={day.isToday ? 'date' : undefined} onDragOver={acceptDrop} onDrop={(event) => drop(event, day.date)}>
              <div className="soc-day-head" title="Double-click to open this week" onDoubleClick={() => openDay(day.date, 'week')}>
                <button type="button" className="soc-day-number" aria-label={`Open week of ${dateLabel(day.date)}`}
                  onClick={(event) => { if (event.detail === 0) openDay(day.date, 'week'); }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openDay(day.date, 'week'); }
                  }}>{Number(day.date.slice(8))}{day.isToday && <span className="hq-sr-only"> (today)</span>}</button>
              </div>
              {items.length > 0 && <ul className="soc-day-items" aria-label={dateLabel(day.date)}>{items.map(chip)}</ul>}
            </td>;
          })}</tr>)}</tbody>
        </table> : <TimeGrid days={days} onOpenDay={view === 'week' ? (day) => openDay(day, 'day') : undefined} events={active.flatMap((draft) => { const event = draftGridEvent(draft, zone, disabled(draft) || !supported); return event ? [event] : []; })} zone={zone} now={clock}
          onChange={(event, day, minute, resize) => { const draft = eventDraft(event); if (draft) gridChange(draft, day, minute, resize); }}
          onAllDay={(event, day) => { const draft = eventDraft(event); if (draft) void move(draft, day, null); }}
          onRemove={(event) => { const draft = eventDraft(event); if (draft) void move(draft, '', null); }}
          onOpen={(event) => { const draft = eventDraft(event); if (draft) openDialog(draft); }} onAnnounce={announce}
          renderAllDay={(day) => <ul className="soc-day-items">{(plan.byDate.get(day) ?? []).filter((draft) => !draft.planning_slot).map(chip)}</ul>}
          acceptDrop={acceptDrop} onDrop={drop} />}
      </div>
      <Splitter label="Undated drafts tray width" side="end" value={trayWidth} min={0} max={420} onResize={resizeTray} onToggle={() => resizeTray(trayWidth ? 0 : rememberedTray.current)} />
      <aside className="soc-tray" data-drop-date="" data-calendar-remove="" aria-labelledby={`${id}-tray`} onDragOver={acceptDrop} onDrop={(event) => drop(event, '')}>
        <Button size="sm" variant="ghost" aria-label={trayWidth ? 'Collapse undated drafts' : 'Show undated drafts'} onClick={() => resizeTray(trayWidth ? 0 : rememberedTray.current)}>{trayWidth ? '→' : '←'}</Button>
        <h3 id={`${id}-tray`}>No date yet</h3>
        {trayWidth > 0 && (plan.undated.length ? <ul className="soc-day-items">{plan.undated.map(chip)}</ul> : <p className="hq-meta">Every active draft has a planned date.</p>)}
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
      <div className="soc-field"><label htmlFor={`${id}-date`}>Planned date</label><input id={`${id}-date`} type="date" value={pickedDate} onChange={(event) => setPickedDate(event.target.value)} aria-describedby={`${id}-date-hint`} />
        <small id={`${id}-date-hint`} className="hq-meta">An editorial planning label only; nothing is posted.</small></div>
      <label className="soc-inline"><input type="checkbox" checked={withTime} disabled={!supported} onChange={(event) => setWithTime(event.target.checked)} />Set time</label>
      {withTime && <>
        <label className="soc-field">Start time<input type="time" step={900} value={pickedTime} onChange={(event) => { setPickedTime(event.target.value); if (!selected?.planning_slot) setDuration(event.target.value === '23:45' ? 15 : 30); }} /></label>
        <label className="soc-field">Duration (minutes)<input type="number" min={15} max={1440} step={15} value={duration} onChange={(event) => setDuration(Number(event.target.value))} /></label>
        <p className="hq-meta">Time zone: {selected?.planning_slot?.timezone ?? zone}</p>
      </>}
      {dialogError && <p role="alert">{dialogError}</p>}
    </Dialog>
    <ToastRegion label="Calendar notifications">
      {moving && <StatusChip tone="info" label="Saving…" />}
      {toast && <Toast key={toast.id} message={toast.message} autoDismissMs={toast.success ? TOAST_AUTO_DISMISS_MS : undefined}
        action={toast.undo && toast.undo === undoOffer ? { label: 'Undo', onAction: undoLastChange } : undefined}
        onDismiss={() => setToast((current) => current?.id === toast.id ? null : current)} />}
    </ToastRegion>
  </section>;
}
