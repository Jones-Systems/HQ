import { useId, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { Button, Dialog, StatusChip, Toast, ToastRegion } from '@hq/ui';
import type { Draft, SocialSession, SocialWorkspacePort, WorkspaceSnapshot } from '../core';
import { changeDraft, errorText } from './actions';
import { calendarPlan, contentDestination, dateLabel, localToday, monthGrid, monthLabel, shiftMonth } from './model';

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
  readonly message: string;
  readonly undo?: { readonly draft: Draft; readonly plannedDate: string };
}

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const DRAG_THRESHOLD = 4;

export const CALENDAR_NOTE = "Planned dates are editorial intent. Nothing on this calendar is posted. Work's planning dates stay in Work and aren't copied here.";

function moveMessage(draft: Draft, plannedDate: string): string {
  return plannedDate ? `Moved “${draft.title}” to ${dateLabel(plannedDate)}.` : `Cleared the planned date of “${draft.title}”.`;
}

export function Calendar({ session, port, snapshot, month, brand, onBrandChange, navigate, paused, now = () => new Date() }: CalendarProps) {
  const id = useId();
  const [selected, setSelected] = useState<Draft | null>(null);
  const [pickedDate, setPickedDate] = useState('');
  const [toast, setToast] = useState<ToastState | null>(null);
  const [moving, setMoving] = useState(false);
  const drag = useRef<{ draft: Draft; x: number; y: number; active: boolean; pointerId: number } | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const dragEndedAt = useRef(-Infinity);
  const plan = calendarPlan(snapshot.content, brand);
  const today = localToday(now());
  const brandName = (brandId: string) => snapshot.brands.find((item) => item.id === brandId)?.name ?? 'Unknown brand';

  /** One versioned save of the planned date; on success, offers Undo as another explicit versioned save. */
  async function move(draft: Draft, plannedDate: string, isUndo = false) {
    if (moving || paused || draft.planned_date === plannedDate) return;
    setMoving(true);
    const result = await changeDraft(session, port, draft, { planned_date: plannedDate });
    setMoving(false);
    if (!result.ok) {
      setToast({ message: `${isUndo ? 'Could not undo' : 'Not moved'}: ${errorText(result.error)}` });
      return;
    }
    setToast(isUndo
      ? { message: `Undone. “${draft.title}” is ${plannedDate ? `planned for ${dateLabel(plannedDate)}` : 'back in No date yet'}.` }
      : { message: moveMessage(draft, plannedDate), undo: { draft: result.draft, plannedDate: draft.planned_date } });
  }

  function openDialog(draft: Draft) {
    setSelected(draft);
    setPickedDate(draft.planned_date || `${month}-01`);
  }

  function onPointerDown(event: ReactPointerEvent<HTMLButtonElement>, draft: Draft) {
    if (event.button !== 0 || paused) return;
    drag.current = { draft, x: event.clientX, y: event.clientY, active: false, pointerId: event.pointerId };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }

  function onPointerMove(event: ReactPointerEvent<HTMLButtonElement>) {
    const state = drag.current;
    if (!state || state.pointerId !== event.pointerId || state.active) return;
    if (Math.hypot(event.clientX - state.x, event.clientY - state.y) >= DRAG_THRESHOLD) {
      state.active = true;
      setDragging(state.draft.id);
    }
  }

  function onPointerUp(event: ReactPointerEvent<HTMLButtonElement>) {
    const state = drag.current;
    drag.current = null;
    setDragging(null);
    if (!state?.active || state.pointerId !== event.pointerId) return;
    event.preventDefault();
    dragEndedAt.current = performance.now();
    const target = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>('[data-drop-date]');
    if (target) void move(state.draft, target.dataset.dropDate ?? '');
  }

  function onClick(draft: Draft) {
    // A completed drag is followed by a click; only a plain click or keyboard activation opens the dialog.
    if (performance.now() - dragEndedAt.current < 400) return;
    openDialog(draft);
  }

  const chip = (draft: Draft) => (
    <li key={draft.id}>
      <button
        type="button" className="soc-chip" data-dragging={dragging === draft.id || undefined}
        aria-label={`${draft.title}, ${draft.channel}, ${brandName(draft.brand_id)}. ${draft.planned_date ? `Planned ${dateLabel(draft.planned_date)}` : 'No date yet'}. Move or open`}
        onClick={() => onClick(draft)}
        onPointerDown={(event) => onPointerDown(event, draft)} onPointerMove={onPointerMove} onPointerUp={onPointerUp}
        onPointerCancel={() => { drag.current = null; setDragging(null); }}
      >
        <span className="soc-chip-channel">{draft.channel}</span>
        <span className="soc-chip-title">{draft.title}</span>
      </button>
    </li>
  );

  return (
    <section className="soc-calendar" aria-labelledby={`${id}-heading`}>
      <header className="soc-calendar-head">
        <h2 id={`${id}-heading`}>{monthLabel(month)}</h2>
        <span className="soc-inline">
          <Button size="sm" variant="secondary" onClick={() => navigate(contentDestination({ page: 'calendar', month: shiftMonth(month, -1) }))} aria-label="Previous month">←</Button>
          <Button size="sm" variant="secondary" onClick={() => navigate(contentDestination({ page: 'calendar', month: today.slice(0, 7) }))}>This month</Button>
          <Button size="sm" variant="secondary" onClick={() => navigate(contentDestination({ page: 'calendar', month: shiftMonth(month, 1) }))} aria-label="Next month">→</Button>
        </span>
        <label className="soc-field soc-field--inline">
          <span>Brand</span>
          <select value={brand} onChange={(event) => onBrandChange(event.target.value)}>
            <option value="all">All brands</option>
            {snapshot.brands.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
        </label>
      </header>
      <p className="soc-note" role="note">{CALENDAR_NOTE}</p>
      {paused && <p className="soc-note soc-note--warning" role="note">{paused} Moves are paused.</p>}

      <div className="soc-calendar-body">
        <table className="soc-month" aria-label={`Planned drafts, ${monthLabel(month)}`}>
          <thead><tr>{WEEKDAYS.map((day) => <th key={day} scope="col">{day}</th>)}</tr></thead>
          <tbody>
            {monthGrid(month, today).map((week) => (
              <tr key={week[0]!.date}>
                {week.map((day) => {
                  const items = plan.byDate.get(day.date) ?? [];
                  return (
                    <td key={day.date} data-drop-date={day.date} data-outside={!day.inMonth || undefined} aria-current={day.isToday ? 'date' : undefined}>
                      <span className="soc-day-number">{Number(day.date.slice(8))}{day.isToday && <span className="hq-sr-only"> (today)</span>}</span>
                      {items.length > 0 && <ul className="soc-day-items" aria-label={dateLabel(day.date)}>{items.map(chip)}</ul>}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>

        <aside className="soc-tray" data-drop-date="" aria-labelledby={`${id}-tray`}>
          <h3 id={`${id}-tray`}>No date yet</h3>
          {plan.undated.length ? <ul className="soc-day-items">{plan.undated.map(chip)}</ul> : <p className="hq-meta">Every active draft has a planned date.</p>}
        </aside>
      </div>

      <Dialog
        open={selected !== null} onClose={() => setSelected(null)} title={selected ? `“${selected.title}”` : ''}
        description={selected ? `${brandName(selected.brand_id)} · ${selected.channel} · ${selected.planned_date ? `Planned ${dateLabel(selected.planned_date)}` : 'No date yet'}` : undefined}
        actions={selected && <>
          <Button variant="ghost" onClick={() => setSelected(null)}>Cancel</Button>
          <Button variant="ghost" onClick={() => { const target = selected; setSelected(null); navigate(contentDestination({ page: 'library', draftId: target.id })); }}>Open draft</Button>
          {selected.planned_date && <Button variant="secondary" disabled={Boolean(paused)} onClick={() => { const target = selected; setSelected(null); void move(target, ''); }}>Clear date</Button>}
          <Button variant="primary" disabled={Boolean(paused) || !pickedDate || pickedDate === selected.planned_date} onClick={() => { const target = selected; setSelected(null); void move(target, pickedDate); }}>Move to date</Button>
        </>}
      >
        <div className="soc-field">
          <label htmlFor={`${id}-date`}>Planned date</label>
          <input id={`${id}-date`} type="date" value={pickedDate} onChange={(event) => setPickedDate(event.target.value)} aria-describedby={`${id}-date-hint`} />
          <small id={`${id}-date-hint`} className="hq-meta">An editorial planning label only; nothing is posted.</small>
        </div>
      </Dialog>

      <ToastRegion label="Calendar notifications">
        {moving && <StatusChip tone="info" label="Saving…" />}
        {toast && (
          <Toast
            message={toast.message}
            action={toast.undo ? { label: 'Undo', onAction: () => { const undo = toast.undo!; setToast(null); void move(undo.draft, undo.plannedDate, true); } } : undefined}
            onDismiss={() => setToast(null)}
          />
        )}
      </ToastRegion>
    </section>
  );
}
