import { useEffect, useRef, useState, type DragEvent, type KeyboardEvent, type ReactNode } from 'react';
import { Button, Dialog, Menu, type MenuItem } from '@hq/ui';
import {
  DATE_KIND_IDS, DATE_KIND_LABEL, dateState, datedEntries, dayNum, formatDay, formatValue, isLive, isOpen,
  matchesFilters, periodBounds, plannerMonthGrid, relativeDays, sortByPosition, viewerLocalTime,
  type DateKind, type Item, type ItemPatch, type PlanningDate,
} from '../core';
import { isPending, isTyping, useEnv, useRemembered } from './env';
import {
  addDatePatch, CHIP_KEY_DAYS, outsideEntries, removeDatePatch, rescheduleDatePatch, scheduleDay, shiftDatePatch,
} from './moves';
import { cx, DateChip, MotivationPill, KindMark, SectionHead, ViewHint } from './parts';

// Calendar (RV-4): a month grid or agenda, a band for coarse dates, the
// Unscheduled tray and an Outside-this-month list. A day date moves by its
// menu (one day earlier, one day later, one week later), by Alt+arrow keys, or
// by dragging it to another day; kind, time, zone and note are kept. Dropping
// a date on the tray removes it; scheduling an undated item asks for the kind.
// Every move is one dates patch with Undo. A month-precision date never
// appears on a single day.

const MAX_CHIPS = 3;
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

type Entry = { item: Item; entry: PlanningDate; bounds: [string, string] };
type Drag = { type: 'date'; itemId: string; dateId: string } | { type: 'undated'; itemId: string };
type Mode = 'month' | 'agenda';

const pad = (n: number) => String(n).padStart(2, '0');
const overlaps = (a: readonly [string, string], b: readonly [string, string]) => dayNum(a[0]) <= dayNum(b[1]) && dayNum(b[0]) <= dayNum(a[1]);
const shiftMonth = (year: number, month: number, delta: number): [number, number] => {
  const index = year * 12 + (month - 1) + delta;
  return [Math.floor(index / 12), (index % 12) + 1];
};
const narrow = () => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(max-width: 760px)').matches;

export function CalendarView() {
  const env = useEnv();
  const { today, state, settings } = env;
  const [cursor, setCursor] = useRemembered('calendar.cursor', () => ({ year: Number(today.slice(0, 4)), month: Number(today.slice(5, 7)) }));
  const [mode, setMode] = useRemembered<Mode>('calendar.mode', () => (narrow() ? 'agenda' : 'month'));
  const [kinds, setKinds] = useRemembered<readonly DateKind[]>('calendar.kinds', DATE_KIND_IDS);
  const [showFinished, setShowFinished] = useRemembered('calendar.finished', false);
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [dropChoice, setDropChoice] = useState<{ itemId: string; day: string } | null>(null);
  const drag = useRef<Drag | null>(null);
  const root = useRef<HTMLDivElement>(null);

  const { year, month } = cursor;
  const items = state.items.filter((it) => isLive(it) && matchesFilters(it, env.filters) && (showFinished || isOpen(it)));
  const monthRange: [string, string] = [`${year}-${pad(month)}-01`, periodBounds('month', `${year}-${pad(month)}`)![1]];
  const entries: Entry[] = datedEntries(items).filter(({ entry }) => kinds.includes(entry.kind));

  // Keep focus on a chip while Alt+arrow moves it: the projected move remounts it in another day cell, so the
  // key is held until the write settles.
  useEffect(() => {
    if (!focusKey || !root.current) return;
    const holder = [...root.current.querySelectorAll<HTMLElement>('[data-focus-key]')].find((el) => el.dataset.focusKey === focusKey);
    const target = holder?.querySelector('button');
    if (target && document.activeElement !== target) target.focus();
  }, [focusKey, state.items, cursor]);

  const latest = (id: string) => state.items.find((it) => it.id === id);
  const send = (item: Item, patch: ItemPatch | null, message: string): Promise<unknown> => (
    patch ? env.run(env.store.patch(item.id, patch), message) : Promise.resolve()
  );
  const dayText = (iso: string) => formatDay(iso, { year: 'auto', today });
  const reschedule = (item: Item, entry: PlanningDate, day: string) => {
    if (entry.value === day) { env.announce('Same day'); return; }
    void send(item, rescheduleDatePatch(item, entry.id, day), `Moved “${item.title}” to ${dayText(day)}.`);
  };
  const shift = (itemId: string, dateId: string, days: number) => {
    const item = latest(itemId);
    const entry = item?.dates.find((d) => d.id === dateId);
    if (!item || !entry) return;
    const patch = shiftDatePatch(item, dateId, days);
    if (!patch) return;
    const value = (patch.dates!.find((d) => d.id === dateId) as PlanningDate).value;
    void send(item, patch, `Moved “${item.title}” to ${dayText(value)}.`);
  };
  const remove = (itemId: string, dateId: string) => {
    const item = latest(itemId);
    if (item) void send(item, removeDatePatch(item, dateId), `Removed date from “${item.title}”.`);
  };
  const add = (itemId: string, kind: DateKind, day: string) => {
    const item = latest(itemId);
    if (item) void send(item, addDatePatch(item, kind, day), `${DATE_KIND_LABEL[kind]} set for “${item.title}” on ${dayText(day)}.`);
  };

  const onChipKey = (event: KeyboardEvent, item: Item, entry: PlanningDate) => {
    if (!event.altKey || !(event.key in CHIP_KEY_DAYS)) return;
    // Capture phase: the chip's menu trigger would otherwise open on Alt+ArrowDown.
    event.preventDefault();
    event.stopPropagation();
    const days = CHIP_KEY_DAYS[event.key]!;
    const patch = shiftDatePatch(item, entry.id, days);
    if (!patch) return;
    const value = (patch.dates!.find((d) => d.id === entry.id) as PlanningDate).value;
    if (Number(value.slice(5, 7)) !== month || Number(value.slice(0, 4)) !== year) {
      setCursor({ year: Number(value.slice(0, 4)), month: Number(value.slice(5, 7)) });
    }
    const key = `chip:${item.id}:${entry.id}`;
    setFocusKey(key);
    void send(item, patch, `Moved “${item.title}” to ${dayText(value)}.`).finally(() => setFocusKey((k) => (k === key ? null : k)));
  };

  const onDayDrop = (event: DragEvent, day: string) => {
    const payload = drag.current;
    drag.current = null;
    if (!payload) return;
    event.preventDefault();
    const item = latest(payload.itemId);
    if (!item) return;
    if (payload.type === 'undated') { setDropChoice({ itemId: item.id, day }); return; }
    const entry = item.dates.find((d) => d.id === payload.dateId);
    if (entry) reschedule(item, entry, day);
  };
  const onTrayDrop = (event: DragEvent) => {
    const payload = drag.current;
    drag.current = null;
    if (!payload || payload.type !== 'date') return;
    event.preventDefault();
    remove(payload.itemId, payload.dateId);
  };
  const acceptDrop = (types: readonly Drag['type'][]) => (event: DragEvent) => {
    if (drag.current && types.includes(drag.current.type)) event.preventDefault();
  };

  const chip = (x: Entry, movable: boolean, showPeriod = false) => (
    <CalendarChip
      key={`${x.item.id}:${x.entry.id}`}
      item={x.item}
      entry={x.entry}
      movable={movable}
      showPeriod={showPeriod}
      onShift={shift}
      onRemove={remove}
      onKey={onChipKey}
      onDragStart={(event) => {
        drag.current = { type: 'date', itemId: x.item.id, dateId: x.entry.id };
        event.dataTransfer?.setData('text/plain', x.item.title);
      }}
    />
  );

  const goTo = (iso: string) => setCursor({ year: Number(iso.slice(0, 4)), month: Number(iso.slice(5, 7)) });
  const step = (delta: number) => { const [y, m] = shiftMonth(year, month, delta); setCursor({ year: y, month: m }); };
  const coarse = entries.filter(({ entry, bounds }) => ['month', 'quarter', 'year'].includes(entry.precision) && overlaps(bounds, monthRange));
  const undated = sortByPosition(items.filter((it) => !it.dates.length));
  const outside = outsideEntries(entries, monthRange, today);
  const target = scheduleDay(year, month, today);

  return (
    <div
      ref={root}
      className="wv-cal"
      onKeyDown={(event) => {
        if ((event.key === 'PageUp' || event.key === 'PageDown') && !event.altKey && !isTyping(event.target)) {
          event.preventDefault();
          step(event.key === 'PageUp' ? -1 : 1);
        }
      }}
    >
      <div className="wv-cal-toolbar">
        <div className="wv-cal-nav">
          <Button size="sm" variant="ghost" aria-label="Previous month" onClick={() => step(-1)}>‹</Button>
          <Button size="sm" onClick={() => goTo(today)}>Today</Button>
          <Button size="sm" variant="ghost" aria-label="Next month" onClick={() => step(1)}>›</Button>
          <h2 className="wv-cal-title" aria-live="polite">{MONTHS[month - 1]} <span className="wv-muted">{year}</span></h2>
        </div>
        <div className="wv-cal-controls">
          <div className="wv-seg" role="group" aria-label="Calendar layout">
            {(['month', 'agenda'] as const).map((id) => (
              <button key={id} type="button" className="wv-seg-btn" aria-pressed={mode === id} onClick={() => setMode(id)}>
                {id === 'month' ? 'Month' : 'Agenda'}
              </button>
            ))}
          </div>
          <div className="wv-seg" role="group" aria-label="Show date kinds">
            {DATE_KIND_IDS.map((k) => {
              const on = kinds.includes(k);
              return (
                <button
                  key={k}
                  type="button"
                  className={cx('wv-seg-btn', 'wv-kind-toggle', `wv-dk--${k}`)}
                  aria-pressed={on}
                  onClick={() => setKinds(on ? kinds.filter((x) => x !== k) : DATE_KIND_IDS.filter((x) => x === k || kinds.includes(x)))}
                >
                  <span className="wv-dk-shape" aria-hidden="true" />{DATE_KIND_LABEL[k]}s
                </button>
              );
            })}
          </div>
          <label className="wv-check">
            <input type="checkbox" checked={showFinished} onChange={(event) => setShowFinished(event.target.checked)} />
            Show done &amp; dropped
          </label>
        </div>
      </div>

      <div className="wv-cal-layout">
        <div className="wv-cal-main">
          <section className="wv-period-band" aria-label="Dates without a set day">
            <div className="wv-band-label">This month, no set day</div>
            <div className="wv-band-list">
              {coarse.length ? coarse.map((x) => chip(x, false, true)) : <span className="wv-muted">Month, quarter and year dates appear here.</span>}
            </div>
          </section>
          {mode === 'month'
            ? (
              <div className="wv-month" role="group" aria-label={`${MONTHS[month - 1]} ${year}`}>
                <div className="wv-month-head" aria-hidden="true">
                  {(settings.week_start === 'mon' ? [1, 2, 3, 4, 5, 6, 0] : [0, 1, 2, 3, 4, 5, 6]).map((d) => <div key={d}>{WEEKDAY_SHORT[d]}</div>)}
                </div>
                {plannerMonthGrid(year, month, settings).map((week) => {
                  const weekEntries = entries.filter(({ entry, bounds }) => entry.precision === 'week' && week.includes(bounds[0]));
                  return (
                    <div key={week[0]} className="wv-month-row">
                      {weekEntries.length > 0 && <div className="wv-week-band">{weekEntries.map((x) => chip(x, false, true))}</div>}
                      <div className="wv-month-cells">
                        {week.map((iso) => {
                          const list = entries.filter(({ entry }) => entry.precision === 'day' && entry.value === iso)
                            .sort((a, b) => (a.entry.time || '99').localeCompare(b.entry.time || '99'));
                          const open = expanded === iso;
                          const shown = open ? list : list.slice(0, MAX_CHIPS);
                          return (
                            <div
                              key={iso}
                              role="group"
                              data-day={iso}
                              aria-label={`${formatDay(iso, { year: true })}, ${list.length} date${list.length === 1 ? '' : 's'}`}
                              className={cx('wv-day', Number(iso.slice(5, 7)) !== month && 'is-outside', iso === today && 'is-today', dayNum(iso) < dayNum(today) && 'is-past')}
                              onDragOver={acceptDrop(['date', 'undated'])}
                              onDrop={(event) => onDayDrop(event, iso)}
                            >
                              <div className="wv-day-head">
                                <span className="wv-day-num">{Number(iso.slice(8))}</span>
                                {env.capture && (
                                  <button
                                    type="button"
                                    className="wv-day-add"
                                    aria-label={`New item on ${formatDay(iso, { year: true })}`}
                                    title="New item on this day"
                                    onClick={() => env.capture!({ date: { kind: 'target', precision: 'day', value: iso } })}
                                  >+</button>
                                )}
                              </div>
                              <div className="wv-day-chips">
                                {shown.map((x) => chip(x, true))}
                                {list.length > MAX_CHIPS && (
                                  <button type="button" className="wv-day-more" aria-expanded={open} onClick={() => setExpanded(open ? null : iso)}>
                                    {open ? 'Show fewer' : `+${list.length - MAX_CHIPS} more`}
                                  </button>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            )
            : <Agenda entries={entries} monthRange={monthRange} monthLabel={MONTHS[month - 1]!} chip={chip} onDayDrop={onDayDrop} acceptDrop={acceptDrop(['date', 'undated'])} />}
        </div>

        <aside className="wv-cal-side">
          <section className="wv-tray" aria-label="Unscheduled items" onDragOver={acceptDrop(['date'])} onDrop={onTrayDrop}>
            <SectionHead title="Unscheduled" count={undated.length} />
            <ViewHint>Drag onto a day to add a date, or use Schedule. Schedule adds a date on {dayText(target)}.</ViewHint>
            <div className="wv-tray-list">
              {undated.map((item) => (
                <div
                  key={item.id}
                  className={cx('wv-tray-item', isPending(state, item.id) && 'is-pending', item.is_example && 'is-example')}
                  draggable
                  onDragStart={(event) => {
                    drag.current = { type: 'undated', itemId: item.id };
                    event.dataTransfer?.setData('text/plain', item.title);
                  }}
                >
                  <KindMark kind={item.kind} />
                  {env.openItem
                    ? <button type="button" className="wv-link" onClick={() => env.openItem!(item.id)}>{item.title}</button>
                    : <span>{item.title}</span>}
                  <MotivationPill motivation={item.motivation} />
                  <Menu
                    size="sm"
                    trigger="Schedule"
                    triggerLabel={`Schedule “${item.title}” on ${formatDay(target, { year: true })}: choose a date kind`}
                    items={DATE_KIND_IDS.map((k) => ({
                      id: k,
                      label: `${DATE_KIND_LABEL[k]}${k === 'target' ? ' (default)' : ''}`,
                      onSelect: () => add(item.id, k, target),
                    }))}
                  />
                </div>
              ))}
              {!undated.length && <p className="wv-muted">Every visible item has a date. Unscheduled is a normal state, too.</p>}
            </div>
            <div className="wv-tray-drop" aria-hidden="true">Drop a date here to remove it</div>
          </section>

          <section className="wv-outside" aria-label="Outside this month">
            <SectionHead title="Outside this month" count={outside.earlier.length + outside.later.length} />
            {outside.earlier.length > 0 && <div className="wv-outside-label">Earlier, still open</div>}
            {outside.earlier.slice(0, 6).map((x) => <OutsideRow key={`${x.item.id}:${x.entry.id}`} x={x} goTo={goTo} />)}
            {outside.later.length > 0 && <div className="wv-outside-label">Later</div>}
            {outside.later.slice(0, 8).map((x) => <OutsideRow key={`${x.item.id}:${x.entry.id}`} x={x} goTo={goTo} />)}
            {!outside.earlier.length && !outside.later.length && <p className="wv-muted">No other dates.</p>}
          </section>
        </aside>
      </div>

      <Dialog
        open={dropChoice !== null}
        onClose={() => setDropChoice(null)}
        title={dropChoice ? `Add to ${dayText(dropChoice.day)} as…` : ''}
        description="Choose the kind of date to create."
        actions={<Button onClick={() => setDropChoice(null)}>Cancel</Button>}
      >
        <div className="wv-kind-choice">
          {DATE_KIND_IDS.map((k) => (
            <Button
              key={k}
              variant={k === 'target' ? 'primary' : 'secondary'}
              onClick={() => { const choice = dropChoice!; setDropChoice(null); add(choice.itemId, k, choice.day); }}
            >
              {DATE_KIND_LABEL[k]}{k === 'target' ? ' (default)' : ''}
            </Button>
          ))}
        </div>
      </Dialog>
    </div>
  );
}

interface ChipProps {
  item: Item;
  entry: PlanningDate;
  movable: boolean;
  showPeriod: boolean;
  onShift: (itemId: string, dateId: string, days: number) => void;
  onRemove: (itemId: string, dateId: string) => void;
  onKey: (event: KeyboardEvent, item: Item, entry: PlanningDate) => void;
  onDragStart: (event: DragEvent) => void;
}

/** One date entry. Its menu offers the Planner's date options; a day date also moves by Alt+arrow and drag. */
function CalendarChip({ item, entry, movable, showPeriod, onShift, onRemove, onKey, onDragStart }: ChipProps) {
  const env = useEnv();
  const st = dateState(entry, env.today, isOpen(item));
  const isDay = entry.precision === 'day';
  const value = formatValue(entry, env.today);
  const items: MenuItem[] = [
    ...(env.openItem ? [{ id: 'open', label: 'Open item', onSelect: () => env.openItem!(item.id) }] : []),
    ...(env.editDate ? [{ id: 'edit', label: entry.time ? 'Edit date & time…' : 'Edit date…', onSelect: () => env.editDate!(item.id, entry.id) }] : []),
    ...(isDay ? [
      { id: 'earlier', label: 'One day earlier · Alt+←', onSelect: () => onShift(item.id, entry.id, -1) },
      { id: 'later', label: 'One day later · Alt+→', onSelect: () => onShift(item.id, entry.id, 1) },
      { id: 'week', label: 'One week later · Alt+↓', onSelect: () => onShift(item.id, entry.id, 7) },
    ] : []),
    { id: 'remove', label: 'Remove this date', tone: 'danger' as const, onSelect: () => onRemove(item.id, entry.id) },
  ];
  return (
    <span
      className={cx('wv-cal-chip', `wv-dk--${entry.kind}`, `wv-ds--${st}`, isPending(env.state, item.id) && 'is-pending', !isOpen(item) && 'is-closed', item.is_example && 'is-example')}
      data-focus-key={`chip:${item.id}:${entry.id}`}
      data-item-id={item.id}
      data-date-id={entry.id}
      draggable={movable && isDay}
      onDragStart={movable && isDay ? onDragStart : undefined}
      onKeyDownCapture={movable && isDay ? (event) => onKey(event, item, entry) : undefined}
      title={`${item.title} — ${DATE_KIND_LABEL[entry.kind]} ${value}${entry.note ? ` (${entry.note})` : ''}`}
    >
      <Menu
        size="sm"
        variant="ghost"
        triggerLabel={`${item.title}, ${DATE_KIND_LABEL[entry.kind]} ${value}${st === 'overdue' ? ', overdue' : ''}. ${movable && isDay ? 'Alt+arrow keys move the day. ' : ''}Enter for options.`}
        trigger={(
          <>
            <span className="wv-dk-shape" aria-hidden="true" />
            {entry.time && <span className="wv-chip-time">{entry.time}</span>}
            <span className="wv-chip-title">{item.title}</span>
            {showPeriod && <span className="wv-chip-period">{value}</span>}
          </>
        )}
        items={items}
      />
    </span>
  );
}

function Agenda({ entries, monthRange, monthLabel, chip, onDayDrop, acceptDrop }: {
  entries: readonly Entry[];
  monthRange: [string, string];
  monthLabel: string;
  chip: (x: Entry, movable: boolean, showPeriod?: boolean) => ReactNode;
  onDayDrop: (event: DragEvent, day: string) => void;
  acceptDrop: (event: DragEvent) => void;
}) {
  const { today, settings } = useEnv();
  const inMonth = entries.filter(({ entry, bounds }) => (entry.precision === 'day' || entry.precision === 'week') && overlaps(bounds, monthRange))
    .sort((a, b) => dayNum(a.bounds[0]) - dayNum(b.bounds[0]) || (a.entry.time || '99').localeCompare(b.entry.time || '99'));
  if (!inMonth.length) return <p className="wv-quiet-title wv-agenda-empty">No day or week dates in {monthLabel}.</p>;
  const groups: { key: string; week: boolean; list: Entry[] }[] = [];
  for (const x of inMonth) {
    const last = groups[groups.length - 1];
    if (last && last.key === x.bounds[0]) last.list.push(x);
    else groups.push({ key: x.bounds[0], week: x.entry.precision === 'week', list: [x] });
  }
  return (
    <div className="wv-agenda">
      {groups.map((g) => {
        const isToday = g.key === today;
        const label = g.week ? `Week of ${formatDay(g.key, { weekday: false, today })}` : formatDay(g.key, { today });
        return (
          <section
            key={g.key}
            className={cx('wv-agenda-day', isToday && 'is-today', dayNum(g.key) < dayNum(today) && 'is-past')}
            data-day={g.key}
            onDragOver={g.week ? undefined : acceptDrop}
            onDrop={g.week ? undefined : (event) => onDayDrop(event, g.key)}
          >
            <h3 className="wv-agenda-label">{label}<span className="wv-muted">{isToday ? ' · today' : ` · ${relativeDays(today, g.key)}`}</span></h3>
            {g.list.map((x) => {
              const local = viewerLocalTime(x.entry, settings.default_tz);
              return (
                <div key={`${x.item.id}:${x.entry.id}`} className="wv-agenda-entry">
                  {chip(x, x.entry.precision === 'day')}
                  {local && <span className="wv-muted">({local} your time)</span>}
                </div>
              );
            })}
          </section>
        );
      })}
    </div>
  );
}

function OutsideRow({ x, goTo }: { x: Entry; goTo: (iso: string) => void }) {
  const env = useEnv();
  const st = dateState(x.entry, env.today, isOpen(x.item));
  const monthName = MONTHS[Number(x.bounds[0].slice(5, 7)) - 1];
  return (
    <div className="wv-outside-row">
      <DateChip entry={x.entry} state={st} />
      {env.openItem
        ? <button type="button" className="wv-link" onClick={() => env.openItem!(x.item.id)}>{x.item.title}</button>
        : <span>{x.item.title}</span>}
      <Button size="sm" variant="ghost" aria-label={`Go to ${monthName} ${x.bounds[0].slice(0, 4)}`} onClick={() => goTo(x.bounds[0])}>›</Button>
    </div>
  );
}
