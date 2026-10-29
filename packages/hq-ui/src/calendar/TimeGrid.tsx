import { useEffect, useLayoutEffect, useRef, useState, type RefObject, type DragEvent, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import { calendarAddDays, calendarClock, calendarDayNumber, calendarGridSnap, calendarZonedParts, CALENDAR_HOUR_HEIGHT, layoutCalendarEvents, type CalendarGridEvent, type CalendarGridPosition } from './geometry';
import './calendar.css';
export type { CalendarGridEvent } from './geometry';

function useCssVars(ref: RefObject<HTMLElement | null>, vars: Readonly<Record<string, string>>) {
  const signature = JSON.stringify(vars);
  useLayoutEffect(() => { if (ref.current) for (const [key, value] of Object.entries(vars)) ref.current.style.setProperty(key, value); }, [ref, signature]);
}

type Preview = { eventId: string; day: string; start: number; end: number };
type Gesture = { x: number; y: number; pointerId: number; event: CalendarGridEvent; resize: boolean; offset: number; moved: boolean; preview: Preview | null; lane: 'time' | 'all-day' | 'remove' | null };
export interface TimeGridProps {
  days: readonly string[];
  events: readonly CalendarGridEvent[];
  zone: string;
  now: Date;
  onChange: (event: CalendarGridEvent, day: string, minute: number, resize: boolean) => void;
  onAllDay?: (event: CalendarGridEvent, day: string) => void;
  onRemove?: (event: CalendarGridEvent) => void;
  onOpen?: (event: CalendarGridEvent) => void;
  onOpenDay?: (day: string) => void;
  onAnnounce: (message: string) => void;
  renderAllDay?: (day: string) => ReactNode;
  onDrop?: (event: DragEvent, day: string, minute?: number) => void;
  acceptDrop?: (event: DragEvent) => void;
}

export function TimeGrid({ days, events, zone, now: clock, onChange, onAllDay, onRemove, onOpen, onOpenDay, onAnnounce, renderAllDay, onDrop, acceptDrop }: TimeGridProps) {
  const root = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const hours = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => { if (hours.current) hours.current.scrollTop = 7 * CALENDAR_HOUR_HEIGHT; }, []);
  const gesture = useRef<Gesture | null>(null);
  const suppressClick = useRef(false);
  const keyboardFocus = useRef<string | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  useCssVars(root, { '--hq-calendar-grid-days': String(days.length) });
  const now = calendarZonedParts(clock, zone);
  useLayoutEffect(() => {
    if (!keyboardFocus.current) return;
    const holder = [...(root.current?.querySelectorAll<HTMLElement>('[data-event-id]') ?? [])].find((element) => element.dataset.eventId === keyboardFocus.current);
    const button = holder?.querySelector<HTMLButtonElement>('button');
    if (button && !button.disabled) { button.focus(); keyboardFocus.current = null; }
  }, [events, days]);


  useEffect(() => {
    const cancel = () => { gesture.current = null; setPreview(null); };
    const move = (event: globalThis.PointerEvent) => {
      const active = gesture.current;
      const rect = body.current?.getBoundingClientRect();
      if (!active || active.pointerId !== event.pointerId || !rect || rect.width <= 0) return;
      if (!active.moved && Math.hypot(event.clientX - active.x, event.clientY - active.y) < 5) return;
      active.moved = true;
      suppressClick.current = true;
      const hit = document.elementFromPoint?.(event.clientX, event.clientY);
      const allDay = hit?.closest<HTMLElement>('[data-grid-all-day]');
      const tray = hit?.closest('[data-calendar-remove]');
      if (tray && onRemove && !active.resize) { active.lane = 'remove'; active.preview = null; setPreview(null); return; }
      if (allDay && onAllDay && !active.resize) {
        active.lane = 'all-day'; active.preview = { eventId: active.event.id, day: allDay.dataset.gridAllDay!, start: 0, end: 0 };
        setPreview(null); return;
      }
      if (event.clientX < rect.left || event.clientX >= rect.right || event.clientY < rect.top || event.clientY > rect.bottom) {
        active.lane = null; active.preview = null; setPreview(null); return;
      }
      const index = Math.min(days.length - 1, Math.floor((event.clientX - rect.left) / (rect.width / days.length)));
      const interval = active.event;
      const day = days[index]!;
      const minute = calendarGridSnap((event.clientY - rect.top) * 60 / CALENDAR_HOUR_HEIGHT - (active.resize ? 0 : active.offset));
      active.lane = 'time';
      active.preview = { eventId: active.event.id, day,
        start: active.resize ? (calendarDayNumber(interval.day) - calendarDayNumber(day)) * 1440 + interval.start : minute, end: active.resize ? minute : minute + ((calendarDayNumber(interval.endDay) - calendarDayNumber(interval.day)) * 1440 + interval.end - interval.start) };
      setPreview(active.preview);
    };
    const up = (event: globalThis.PointerEvent) => {
      const active = gesture.current;
      if (!active || active.pointerId !== event.pointerId) return;
      cancel();
      if (!active.moved) return;
      const current = events.find((x) => x.id === active.event.id);
      if (!current || current.revision !== active.event.revision || current.disabled) {
        onAnnounce('This event changed while dragging. Try again with its current date.'); return;
      }
      if (active.lane === 'remove') onRemove?.(current);
      else if (active.lane === 'all-day' && active.preview) onAllDay?.(current, active.preview.day);
      else if (active.lane === 'time' && active.preview) onChange(current, active.preview.day,
        active.resize ? active.preview.end : active.preview.start, active.resize);
    };
    const key = (event: globalThis.KeyboardEvent) => { if (event.key === 'Escape' && gesture.current) { cancel(); onAnnounce('Calendar move cancelled.'); } };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancel);
    window.addEventListener('keydown', key);
    window.addEventListener('blur', cancel);
    return () => {
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancel); window.removeEventListener('keydown', key); window.removeEventListener('blur', cancel);
    };
  }, [days, events, onChange, onAllDay, onRemove, onAnnounce]);

  const begin = (event: PointerEvent, x: CalendarGridPosition, resize: boolean) => {
    if (event.button !== 0 || x.event.disabled) return;
    event.stopPropagation();
    keyboardFocus.current = null;
    const rect = body.current!.getBoundingClientRect();
    suppressClick.current = false;
    gesture.current = { x: event.clientX, y: event.clientY, pointerId: event.pointerId, event: x.event, resize, moved: false, preview: null, lane: null,
      offset: (event.clientY - rect.top) * 60 / CALENDAR_HOUR_HEIGHT - x.start };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };
  const keyboard = (event: KeyboardEvent, x: CalendarGridEvent) => {
    if (!event.altKey || !['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) return;
    event.preventDefault(); event.stopPropagation();
    if (x.disabled) return;
    keyboardFocus.current = x.id;
    const interval = x;
    if (event.shiftKey) {
      if (event.key === 'ArrowUp' || event.key === 'ArrowDown') onChange(x, interval.endDay, interval.end + (event.key === 'ArrowUp' ? -15 : 15), true);
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      onChange(x, calendarAddDays(interval.day, event.key === 'ArrowLeft' ? -1 : 1), interval.start, false);
    } else onChange(x, interval.day, interval.start + (event.key === 'ArrowUp' ? -15 : 15), false);
  };

  return <section className="hq-calendar-time-grid" ref={root} aria-label="Timed calendar">
    <p className="hq-calendar-time-help">Times in {zone}. Drag to move · drag the lower edge to resize · Alt + arrows to move · Alt + Shift + ↑/↓ to resize.</p>
    <div className="hq-calendar-time-head"><span>All day</span>{days.map((day) => <div key={day} className={day === now.day ? 'is-today' : ''}>
      {onOpenDay ? <button type="button" className="hq-calendar-day-header" aria-label={`Open day ${day}`}
        onClick={(event) => { if (event.detail === 0) onOpenDay(day); }} onDoubleClick={() => onOpenDay(day)}>
        <strong>{new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' }).format(new Date(`${day}T12:00:00Z`))}</strong>
      </button> : <strong>{new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' }).format(new Date(`${day}T12:00:00Z`))}</strong>}
      <div className="hq-calendar-all-day" data-grid-all-day={day} aria-label={`All day ${day}`} onDragOver={acceptDrop} onDrop={(event) => onDrop?.(event, day)}>
        {renderAllDay?.(day)}
      </div>
    </div>)}</div>
    <div className="hq-calendar-time-rows" ref={hours} tabIndex={0} role="region" aria-label="Calendar hours">
      <div className="hq-calendar-time-hours" aria-hidden="true">{Array.from({ length: 24 }, (_, hour) => <div key={hour}>{calendarClock(hour * 60)}</div>)}</div>
      <div className="hq-calendar-time-columns" ref={body}>
        {days.map((day) => <div className="hq-calendar-time-day" data-time-day={day} key={day} aria-label={`Time slots ${day}`}
          onDragOver={acceptDrop} onDrop={(event) => {
            const rect = event.currentTarget.getBoundingClientRect();
            onDrop?.(event, day, calendarGridSnap((event.clientY - rect.top) * 60 / CALENDAR_HOUR_HEIGHT));
          }}>
          {layoutCalendarEvents(events, day).map((x) => <TimeEvent key={x.event.id} x={x}
            onPointerDown={(event, resize) => begin(event, x, resize)} onKeyDown={(event) => keyboard(event, x.event)}
            onClick={() => { if (!suppressClick.current) onOpen?.(x.event); suppressClick.current = false; }} />)}
          {preview?.day === day && <TimeMarker start={preview.start} end={preview.end} className="hq-calendar-time-preview" label={`${calendarClock(preview.start)}–${calendarClock(preview.end)}`} />}
          {now.day === day && <TimeMarker start={now.minute} end={now.minute} className="hq-calendar-now-line" label="Current time" />}
        </div>)}
      </div>
    </div>
  </section>;
}

function TimeEvent({ x, onPointerDown, onKeyDown, onClick }: {
  x: CalendarGridPosition; onPointerDown(event: PointerEvent, resize: boolean): void; onKeyDown(event: KeyboardEvent): void; onClick(): void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useCssVars(ref, { '--hq-calendar-event-top': `${x.start * CALENDAR_HOUR_HEIGHT / 60}px`, '--hq-calendar-event-height': `${Math.max(12, (x.end - x.start) * CALENDAR_HOUR_HEIGHT / 60)}px`,
    '--hq-calendar-event-left': `${x.column / x.columns * 100}%`, '--hq-calendar-event-width': `${100 / x.columns}%` });
  const duration = x.end - x.start;
  const density = duration <= 15 ? 'tiny' : duration < 45 ? 'compact' : 'full';
  // Compact title and metadata need two 12px lines plus 4px of padding and borders.
  const hasMetadataRoom = duration * CALENDAR_HOUR_HEIGHT / 60 >= 28;
  const label = `${x.event.title}, ${calendarClock(x.start)}–${calendarClock(x.end)}, ${x.event.subtitle ?? ''}${x.event.estimated ? ', 30 minute display estimate' : ''}`;
  const tooltip = `${x.event.title}, ${x.event.day} ${calendarClock(x.event.start)}–${x.event.endDay} ${calendarClock(x.event.end)}${x.event.subtitle ? `, ${x.event.subtitle}` : ''}`;
  return <div ref={ref} className={`hq-calendar-time-event hq-calendar-time-event--${density}`} data-event-id={x.event.id}>
    <button className="hq-calendar-time-event-body" type="button" disabled={x.event.disabled}
      aria-label={label} title={tooltip}
      onPointerDown={(event) => onPointerDown(event, false)} onKeyDown={onKeyDown} onClick={onClick}>
      <strong>{x.event.title}</strong>{hasMetadataRoom && <span>{calendarClock(x.start)}–{calendarClock(x.end)}{x.event.estimated && ' · 30m'}{x.event.subtitle && ` · ${x.event.subtitle}`}</span>}
    </button>
    {x.lastSegment && <button type="button" className="hq-calendar-time-resize" aria-label={`Resize ${x.event.title}`} disabled={x.event.disabled}
      onPointerDown={(event) => onPointerDown(event, true)} onKeyDown={onKeyDown} onClick={(event) => event.stopPropagation()} />}
  </div>;
}

function TimeMarker({ start, end, className, label }: { start: number; end: number; className: string; label: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useCssVars(ref, { '--hq-calendar-event-top': `${Math.max(0, start) * CALENDAR_HOUR_HEIGHT / 60}px`, '--hq-calendar-event-height': `${Math.max(0, Math.min(1440, end) - Math.max(0, start)) * CALENDAR_HOUR_HEIGHT / 60}px` });
  return <div ref={ref} className={className} aria-label={label}>{className === 'hq-calendar-time-preview' ? label : null}</div>;
}
