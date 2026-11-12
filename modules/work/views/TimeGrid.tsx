import { useEffect, useLayoutEffect, useRef, useState, type DragEvent, type ReactNode } from 'react';
import { TimeGrid as SharedTimeGrid, type CalendarGridEvent } from '@hq/ui';
import { DATE_KIND_LABEL, dateState, isOpen, type Item, type PlanningDate } from '../core';
import { isPending, useEnv } from './env';
import { displayedInterval, type GridEntry } from './time-grid';
import './calendar.css';

interface Props {
  days: readonly string[];
  onOpenDay?: (day: string) => void;
  entries: readonly GridEntry[];
  chip: (entry: GridEntry & { bounds: [string, string] }, movable: boolean) => ReactNode;
  onCommit: (item: Item, entry: PlanningDate, day: string, minute: number, resize: boolean) => void;
  onAllDay: (item: Item, entry: PlanningDate, day: string) => void;
  onRemove: (itemId: string, dateId: string) => void;
  onDrop: (event: DragEvent, day: string, minute?: number) => void;
  acceptDrop: (event: DragEvent) => void;
}

/**
 * The timed Week and Day grid: the shared hour rail, now-line, all-day row and time-sized events, with each event
 * named by its date kind and tagged so the stylesheet can give it the kind's hue (the shared grid has no kind slot).
 */
export function TimeGrid({ days, onOpenDay, entries, chip, onCommit, onAllDay, onRemove, onDrop, acceptDrop }: Props) {
  const env = useEnv();
  const frame = useRef<HTMLDivElement>(null);
  const [clock, setClock] = useState(() => env.now());
  useEffect(() => { const id = window.setInterval(() => setClock(env.now()), 60000); return () => window.clearInterval(id); }, [env.now]);
  const eventId = (x: GridEntry) => `${x.item.id}:${x.entry.id}`;
  const events: CalendarGridEvent[] = entries.flatMap((x) => {
    const interval = displayedInterval(x.entry, env.settings.default_tz);
    return interval ? [{ id: eventId(x), title: x.item.title, subtitle: [DATE_KIND_LABEL[x.entry.kind], x.entry.tz].filter(Boolean).join(' · '), day: interval.day, start: interval.start,
      endDay: interval.endDay, end: interval.end, revision: x.item.revision, disabled: isPending(env.state, x.item.id), estimated: !x.entry.end_time }] : [];
  });
  // Tag each event with its kind and date state for the stylesheet. React never sets these attributes, so it never clears them.
  useLayoutEffect(() => {
    const byId = new Map(entries.map((x) => [eventId(x), x]));
    frame.current?.querySelectorAll<HTMLElement>('[data-event-id]').forEach((holder) => {
      const x = byId.get(holder.dataset.eventId ?? '');
      if (!x) return;
      holder.dataset.dk = x.entry.kind;
      holder.dataset.ds = dateState(x.entry, env.today, isOpen(x.item));
    });
  });
  const current = (event: CalendarGridEvent): GridEntry | null => {
    const x = entries.find((entry) => eventId(entry) === event.id);
    if (!x || x.item.revision !== event.revision || isPending(env.state, x.item.id)) {
      env.announce('This item changed. Try again with its current date.'); return null;
    }
    return x;
  };
  return (
    <div ref={frame} className="wv-time-grid">
      <SharedTimeGrid days={days} onOpenDay={onOpenDay} events={events} zone={env.settings.default_tz} now={clock} onAnnounce={env.announce}
        onChange={(event, day, minute, resize) => { const x = current(event); if (x) onCommit(x.item, x.entry, day, minute, resize); }}
        onAllDay={(event, day) => { const x = current(event); if (x) onAllDay(x.item, x.entry, day); }}
        onRemove={(event) => { const x = current(event); if (x) onRemove(x.item.id, x.entry.id); }}
        onOpen={(event) => { const x = entries.find((entry) => eventId(entry) === event.id); if (x) env.openItem?.(x.item.id); }}
        onDrop={onDrop} acceptDrop={acceptDrop}
        renderAllDay={(day) => entries.filter(({ entry }) => entry.precision === 'day' && !entry.time && entry.value === day)
          .map((x) => chip({ ...x, bounds: [day, day] }, true))} />
    </div>
  );
}
