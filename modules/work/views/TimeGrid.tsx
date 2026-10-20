import { useEffect, useState, type DragEvent, type ReactNode } from 'react';
import { TimeGrid as SharedTimeGrid, type CalendarGridEvent } from '@hq/ui';
import type { Item, PlanningDate } from '../core';
import { isPending, useEnv } from './env';
import { displayedInterval, type GridEntry } from './time-grid';

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

export function TimeGrid({ days, onOpenDay, entries, chip, onCommit, onAllDay, onRemove, onDrop, acceptDrop }: Props) {
  const env = useEnv();
  const [clock, setClock] = useState(() => env.now());
  useEffect(() => { const id = window.setInterval(() => setClock(env.now()), 60000); return () => window.clearInterval(id); }, [env.now]);
  const eventId = (x: GridEntry) => `${x.item.id}:${x.entry.id}`;
  const events: CalendarGridEvent[] = entries.flatMap((x) => {
    const interval = displayedInterval(x.entry, env.settings.default_tz);
    return interval ? [{ id: eventId(x), title: x.item.title, subtitle: x.entry.tz ?? '', day: interval.day, start: interval.start,
      endDay: interval.endDay, end: interval.end, revision: x.item.revision, disabled: isPending(env.state, x.item.id), estimated: !x.entry.end_time }] : [];
  });
  const current = (event: CalendarGridEvent): GridEntry | null => {
    const x = entries.find((entry) => eventId(entry) === event.id);
    if (!x || x.item.revision !== event.revision || isPending(env.state, x.item.id)) {
      env.announce('This item changed. Try again with its current date.'); return null;
    }
    return x;
  };
  return <SharedTimeGrid days={days} onOpenDay={onOpenDay} events={events} zone={env.settings.default_tz} now={clock} onAnnounce={env.announce}
    onChange={(event, day, minute, resize) => { const x = current(event); if (x) onCommit(x.item, x.entry, day, minute, resize); }}
    onAllDay={(event, day) => { const x = current(event); if (x) onAllDay(x.item, x.entry, day); }}
    onRemove={(event) => { const x = current(event); if (x) onRemove(x.item.id, x.entry.id); }}
    onOpen={(event) => { const x = entries.find((entry) => eventId(entry) === event.id); if (x) env.openItem?.(x.item.id); }}
    onDrop={onDrop} acceptDrop={acceptDrop}
    renderAllDay={(day) => entries.filter(({ entry }) => entry.precision === 'day' && !entry.time && entry.value === day)
      .map((x) => chip({ ...x, bounds: [day, day] }, true))} />;
}
