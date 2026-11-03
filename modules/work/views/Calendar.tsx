import { useEffect, useLayoutEffect, useRef, useState, type DragEvent, type KeyboardEvent, type ReactNode } from 'react';
import { Button, Dialog, Menu, Splitter, type MenuItem } from '@hq/ui';
import {
  addDays, DATE_KIND_IDS, DATE_KIND_LABEL, dateState, datedEntries, dayNum, formatDay, formatValue, isLive, isOpen,
  matchesFilters, periodBounds, plannerMonthGrid, relativeDays, sortByPosition, viewerLocalTime,
  type DateKind, type Item, type ItemPatch, type PlanningDate,
} from '../core';
import { DateKindIcon, PageHeader, SegmentedNav } from '../theme';
import { settleInto, shake, slideIn } from './calendar-motion';
import { isPending, isTyping, useCssVars, useEnv, useRemembered } from './env';
import {
  addDatePatch, clearTimePatch, timeboxPatch, CHIP_KEY_DAYS, outsideEntries, removeDatePatch, rescheduleDatePatch, scheduleDay, shiftDatePatch,
  trayGroups, type TrayGroupId,
} from './moves';
import { TimeGrid } from './TimeGrid';
import { calendarDays, gridDatePatch, periodTitle } from './time-grid';
import { cx, DateChip, MotivationPill, KindMark, SectionHead } from './parts';
import './calendar.css';

// Calendar: month, timed week/day or agenda, a band for coarse dates, the
// Unscheduled tray and an Outside-this-month list. A day date moves by its
// menu (one day earlier, one day later, one week later), by Alt+arrow keys, or
// by dragging it to another day; kind, time, zone and note are kept. Dropping
// a date on the tray removes it; scheduling an undated item asks for the kind.
// Timed grid drops convert through the display zone; all-day drops clear time, end and zone.
// Every move is one dates patch with Undo. A month-precision date never
// appears on a single day.
//
// Presentation (flow assessment X-4, X-8, P-2): the page title names the period; changing the range or the layout
// slides the content in the direction of travel; the tray separates this week's focus, Next and Inbox captures; day
// cells light up as drop targets and a dropped date settles into its cell (a refused drop shakes once). Motion is
// decoration only: it never delays a write, and it is off under reduced motion.

const MAX_CHIPS = 3;
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MODES = [{ id: 'month', label: 'Month' }, { id: 'week', label: 'Week' }, { id: 'day', label: 'Day' }, { id: 'agenda', label: 'Agenda' }] as const;
const TRAY_GROUPS: readonly { id: TrayGroupId; title: string; hint: string }[] = [
  { id: 'focus', title: 'This week’s focus', hint: 'Horizon Now' },
  { id: 'next', title: 'Next', hint: 'Planned, no date yet' },
  { id: 'inbox', title: 'Inbox captures', hint: 'Not sorted yet' },
];
/** The drop targets: a month cell or agenda day, a timed day column, an all-day row, and the tray (removes a date). */
const DROP_ZONE = '[data-drop], [data-time-day], [data-grid-all-day], [data-calendar-remove]';

type Entry = { item: Item; entry: PlanningDate; bounds: [string, string] };
type Drag = { type: 'date'; itemId: string; dateId: string } | { type: 'undated'; itemId: string };
type Mode = (typeof MODES)[number]['id'];
type Point = { x: number; y: number };
/** A date that was just written: where to find its chip once it has moved, so it can settle and flash there. */
type Landing = { itemId: string; dateId?: string; day: string; from: Point | null };

const pad = (n: number) => String(n).padStart(2, '0');
const overlaps = (a: readonly [string, string], b: readonly [string, string]) => dayNum(a[0]) <= dayNum(b[1]) && dayNum(b[0]) <= dayNum(a[1]);
const shiftMonth = (year: number, month: number, delta: number): [number, number] => {
  const index = year * 12 + (month - 1) + delta;
  return [Math.floor(index / 12), (index % 12) + 1];
};
const narrow = () => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(max-width: 760px)').matches;
const pointOf = (event: DragEvent): Point | null => (
  Number.isFinite(event.clientX) && Number.isFinite(event.clientY) && (event.clientX !== 0 || event.clientY !== 0) ? { x: event.clientX, y: event.clientY } : null
);

/** The chip, or timed event, that a write put on `day` (or, when `day` is not given, anywhere). */
function findLanded(root: HTMLElement | null, itemId: string, dateId: string | undefined, day: string | undefined): HTMLElement | null {
  if (!root) return null;
  for (const el of root.querySelectorAll<HTMLElement>('[data-item-id], [data-event-id]')) {
    const id = el.dataset.itemId ?? '';
    const event = el.dataset.eventId ?? '';
    const isItem = id === itemId || event.startsWith(`${itemId}:`);
    if (!isItem) continue;
    if (dateId && el.dataset.dateId !== dateId && !event.endsWith(`:${dateId}`)) continue;
    if (day && !el.closest(`[data-day="${day}"], [data-time-day="${day}"], [data-grid-all-day="${day}"]`)) continue;
    return el;
  }
  return null;
}

function ChevronIcon({ dir }: { dir: 'prev' | 'next' }) {
  return <svg className="work-icon work-icon--sm" viewBox="0 0 24 24" aria-hidden="true"><path d={dir === 'prev' ? 'm14.5 6-6 6 6 6' : 'm9.5 6 6 6-6 6'} /></svg>;
}

export function CalendarView() {
  const env = useEnv();
  const { today, state, settings } = env;
  const [cursor, setCursor] = useRemembered('calendar.cursor', () => ({ year: Number(today.slice(0, 4)), month: Number(today.slice(5, 7)) }));
  const [mode, setMode] = useRemembered<Mode>('calendar.mode', () => (narrow() ? 'agenda' : 'month'));
  const [dayCursor, setDayCursor] = useRemembered('calendar.day', today);
  const [kinds, setKinds] = useRemembered<readonly DateKind[]>('calendar.kinds', DATE_KIND_IDS);
  const [showFinished, setShowFinished] = useRemembered('calendar.finished', false);
  const [sidebarWidth, setSidebarWidth] = useRemembered('calendar.sidebar.width', () => narrow() ? 0 : 280);
  const [sidebarRestore, setSidebarRestore] = useRemembered('calendar.sidebar.restore', 280);
  const [inboxOpen, setInboxOpen] = useRemembered('calendar.tray.inbox', false);
  const resizeSidebar = (size: number) => {
    const next = size < 112 ? 0 : Math.min(420, size);
    if (next > 0) setSidebarRestore(next);
    setSidebarWidth(next);
  };
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const [dropChoice, setDropChoice] = useState<{ itemId: string; day: string; minute?: number; from: Point | null } | null>(null);
  const [picker, setPicker] = useState<{ itemId: string; day: string; kind: DateKind } | null>(null);
  const [landing, setLanding] = useState<Landing | null>(null);
  const drag = useRef<Drag | null>(null);
  const over = useRef<Element | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const title = useRef<HTMLSpanElement>(null);
  const focusTitle = useRef(false);
  const slid = useRef<{ mode: Mode; anchor: number } | null>(null);
  useCssVars(root, { '--wv-cal-sidebar-width': `${sidebarWidth}px` });

  const { year, month } = cursor;
  const timed = mode === 'week' || mode === 'day';
  const days = calendarDays(dayCursor, mode === 'day' ? 'day' : 'week', settings.week_start);
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

  useEffect(() => {
    if (focusTitle.current) { title.current?.focus(); focusTitle.current = false; }
  }, [mode, dayCursor]);

  // Slide the content in the direction of travel: a later range or a deeper layout (Month → Week → Day → Agenda)
  // arrives from the end side. The header and its controls stay mounted, so focus stays on the control pressed.
  const anchor = timed ? dayNum(days[0]!) : year * 12 + month - 1;
  useLayoutEffect(() => {
    const before = slid.current;
    slid.current = { mode, anchor };
    if (!before || (before.mode === mode && before.anchor === anchor)) return;
    const order = MODES.map((m) => m.id);
    slideIn(stage.current, before.mode === mode ? anchor - before.anchor : order.indexOf(mode) - order.indexOf(before.mode));
  }, [mode, anchor]);

  // A date that was just written glides into its new cell and flashes. The write is projected at once, so the chip
  // is found within a few frames; if it never appears (a day outside the shown range) nothing animates.
  useEffect(() => {
    if (!landing) return undefined;
    let frames = 0;
    let handle = 0;
    const attempt = () => {
      const el = findLanded(root.current, landing.itemId, landing.dateId, landing.day);
      if (el) { settleInto(el, landing.from); return; }
      frames += 1;
      if (frames < 12) handle = requestAnimationFrame(attempt);
    };
    handle = requestAnimationFrame(attempt);
    return () => cancelAnimationFrame(handle);
  }, [landing]);

  const latest = (id: string) => state.items.find((it) => it.id === id);
  const dayText = (iso: string) => formatDay(iso, { year: 'auto', today });
  const land = (itemId: string, dateId: string | undefined, day: string, from: Point | null) => setLanding({ itemId, dateId, day, from });
  const shakeChip = (itemId: string, dateId?: string) => shake(findLanded(root.current, itemId, dateId, undefined));
  /**
   * One write: the chip settles where it lands and the toast offers Undo (env.run). A null patch is refused (the
   * reason is announced) and a failed write is rolled back by the store; either way the chip shakes once.
   */
  const commit = async (item: Item, patch: ItemPatch | null, message: string, where: { dateId?: string; day: string; from?: Point | null; refusal?: string }): Promise<boolean> => {
    if (!patch) {
      if (where.refusal) env.announce(where.refusal);
      shakeChip(item.id, where.dateId);
      return false;
    }
    const saved = env.run(env.store.patch(item.id, patch), message);
    land(item.id, where.dateId, where.day, where.from ?? null);
    const ok = await saved;
    if (!ok) shakeChip(item.id, where.dateId);
    return ok;
  };
  const reschedule = (item: Item, entry: PlanningDate, day: string, from: Point | null = null) => {
    if (entry.value === day) { env.announce('Same day'); shakeChip(item.id, entry.id); return; }
    void commit(item, rescheduleDatePatch(item, entry.id, day), `Moved “${item.title}” to ${dayText(day)}.`, { dateId: entry.id, day, from });
  };
  const shift = (itemId: string, dateId: string, days: number) => {
    const item = latest(itemId);
    const entry = item?.dates.find((d) => d.id === dateId);
    if (!item || !entry) return;
    const patch = shiftDatePatch(item, dateId, days);
    if (!patch) return;
    const value = (patch.dates!.find((d) => d.id === dateId) as PlanningDate).value;
    void commit(item, patch, `Moved “${item.title}” to ${dayText(value)}.`, { dateId, day: value });
  };
  const remove = (itemId: string, dateId: string) => {
    const item = latest(itemId);
    const patch = item ? removeDatePatch(item, dateId) : null;
    if (item && patch) void env.run(env.store.patch(item.id, patch), `Removed date from “${item.title}”.`);
  };
  const add = (itemId: string, kind: DateKind, day: string, minute?: number, from: Point | null = null) => {
    const item = latest(itemId);
    if (item) {
      const patch = minute === undefined ? addDatePatch(item, kind, day) : timeboxPatch(item, null, day, minute, settings.default_tz, kind);
      void commit(item, patch, `${DATE_KIND_LABEL[kind]} set for “${item.title}” on ${dayText(day)}.`, {
        day, from, refusal: 'Choose a valid timebox that ends before midnight. Clock-change gaps cannot be scheduled.',
      });
    }
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
    void commit(item, patch, `Moved “${item.title}” to ${dayText(value)}.`, { dateId: entry.id, day: value }).finally(() => setFocusKey((k) => (k === key ? null : k)));
  };

  // ---- drag: arm on dragstart, light up the day under the pointer, disarm on drop or dragend
  const setOver = (next: Element | null) => {
    if (over.current === next) return;
    over.current?.removeAttribute('data-over');
    next?.setAttribute('data-over', 'true');
    over.current = next;
  };
  const beginDrag = (payload: Drag, event: DragEvent) => {
    drag.current = payload;
    event.dataTransfer?.setData('text/plain', latest(payload.itemId)?.title ?? '');
    // Marked after the browser has taken its drag image, so the image shows the chip as it was.
    window.setTimeout(() => { if (drag.current === payload) root.current?.setAttribute('data-wk-dragging', payload.type); }, 0);
  };
  const takeDrag = (): Drag | null => {
    const payload = drag.current;
    drag.current = null;
    setOver(null);
    root.current?.removeAttribute('data-wk-dragging');
    return payload;
  };
  const trackOver = (event: DragEvent) => {
    const payload = drag.current;
    if (!payload) return;
    const zone = event.target instanceof Element ? event.target.closest(DROP_ZONE) : null;
    setOver(zone && (!zone.hasAttribute('data-calendar-remove') || payload.type === 'date') ? zone : null);
  };
  const onDayDrop = (event: DragEvent, day: string) => {
    const payload = takeDrag();
    if (!payload) return;
    event.preventDefault();
    const item = latest(payload.itemId);
    if (!item) return;
    const from = pointOf(event);
    if (payload.type === 'undated') { setDropChoice({ itemId: item.id, day, from }); return; }
    const entry = item.dates.find((d) => d.id === payload.dateId);
    if (entry) reschedule(item, entry, day, from);
  };
  const commitTime = (item: Item, entry: PlanningDate, day: string, minute: number, resize: boolean) => {
    if (isPending(state, item.id)) return;
    const patch = gridDatePatch(item, entry, day, minute, settings.default_tz, resize);
    if (patch && !days.includes(day)) goTo(day);
    void commit(item, patch, `${resize ? 'Resized' : 'Moved'} “${item.title}”.`, {
      dateId: entry.id, day, refusal: 'No change saved. Choose a valid time on the same day; clock-change gaps and midnight crossings are unavailable.',
    });
  };
  const allDay = (item: Item, entry: PlanningDate, day: string) => {
    if (!isPending(state, item.id)) void commit(item, clearTimePatch(item, entry.id, day), `Moved “${item.title}” to all day.`, { dateId: entry.id, day });
  };
  const onGridDrop = (event: DragEvent, day: string, minute?: number) => {
    const payload = takeDrag();
    if (!payload) return;
    event.preventDefault();
    const item = latest(payload.itemId);
    if (!item || isPending(state, item.id)) return;
    if (payload.type === 'undated') { setDropChoice({ itemId: item.id, day, from: pointOf(event), ...(minute === undefined ? {} : { minute }) }); return; }
    const entry = item.dates.find((date) => date.id === payload.dateId);
    if (!entry) return;
    if (minute === undefined) allDay(item, entry, day);
    else commitTime(item, entry, day, minute, false);
  };
  const onTrayDrop = (event: DragEvent) => {
    const payload = takeDrag();
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
      onDragStart={(event) => beginDrag({ type: 'date', itemId: x.item.id, dateId: x.entry.id }, event)}
    />
  );

  const goTo = (iso: string) => { setDayCursor(iso); setCursor({ year: Number(iso.slice(0, 4)), month: Number(iso.slice(5, 7)) }); };
  const selectMode = (next: Mode) => {
    if (next === mode) return;
    if (next === 'week' || next === 'day') {
      if (!timed) {
        const shownMonth = `${year}-${pad(month)}`;
        goTo(dayCursor.startsWith(shownMonth) ? dayCursor : today.startsWith(shownMonth) ? today : `${shownMonth}-01`);
      }
    } else if (timed) goTo(dayCursor);
    setMode(next);
  };
  const openDay = (iso: string, next: 'week' | 'day') => {
    focusTitle.current = true; goTo(iso); setMode(next);
  };
  const step = (delta: number) => {
    if (timed) { goTo(addDays(dayCursor, delta * (mode === 'week' ? 7 : 1))); return; }
    const [y, m] = shiftMonth(year, month, delta); setCursor({ year: y, month: m });
  };
  const shownRange: [string, string] = timed ? [days[0]!, days[days.length - 1]!] : monthRange;
  const coarse = entries.filter(({ entry, bounds }) => (timed ? ['week', 'month', 'quarter', 'year'] : ['month', 'quarter', 'year']).includes(entry.precision) && overlaps(bounds, shownRange));
  const undated = sortByPosition(items.filter((it) => !it.dates.length));
  const groups = trayGroups(undated);
  const outside = outsideEntries(entries, shownRange, today);
  const target = timed ? dayCursor : scheduleDay(year, month, today);
  const unit = timed ? mode : 'month';
  const startPicker = (item: Item) => setPicker({ itemId: item.id, day: target, kind: 'target' });

  const trayItem = (item: Item) => (
    <div
      key={item.id}
      className={cx('wv-tray-item', isPending(state, item.id) && 'is-pending', item.is_example && 'is-example')}
      draggable
      onDragStart={(event) => beginDrag({ type: 'undated', itemId: item.id }, event)}
    >
      <KindMark kind={item.kind} />
      {env.openItem
        ? <button type="button" className="wv-link wv-tray-title" onClick={() => env.openItem!(item.id)}>{item.title}</button>
        : <span className="wv-tray-title">{item.title}</span>}
      <MotivationPill motivation={item.motivation} />
      <Menu
        size="sm"
        align="end"
        className="wv-tray-schedule"
        trigger="Schedule"
        triggerLabel={`Schedule “${item.title}”`}
        items={[
          ...DATE_KIND_IDS.map((k) => ({
            id: k,
            label: `${DATE_KIND_LABEL[k]}${k === 'target' ? ' (default)' : ''}`,
            onSelect: () => add(item.id, k, target),
          })),
          { id: 'pick', label: 'Pick another day…', onSelect: () => startPicker(item) },
        ]}
      />
    </div>
  );

  const pickedItem = picker ? latest(picker.itemId) : undefined;
  const confirmPicker = () => {
    if (!picker || !/^\d{4}-\d{2}-\d{2}$/.test(picker.day)) return;
    const choice = picker;
    setPicker(null);
    add(choice.itemId, choice.kind, choice.day);
  };

  return (
    <div
      ref={root}
      className="wv-cal"
      onDragOver={trackOver}
      onDragEnd={() => { takeDrag(); }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') takeDrag();
        if ((event.key === 'PageUp' || event.key === 'PageDown') && !event.altKey && !isTyping(event.target)) {
          event.preventDefault();
          step(event.key === 'PageUp' ? -1 : 1);
        }
      }}
    >
      <PageHeader
        title={(
          <span ref={title} tabIndex={-1} className="wv-cal-title" aria-live="polite">
            {timed ? periodTitle(mode, year, month, days) : <>{MONTHS[month - 1]} <span className="wv-cal-year">{year}</span></>}
          </span>
        )}
        meta="Coarse dates stay periods: they sit in the period band and are never pinned to a day."
        actions={(
          <>
            <div className="wk-seg wv-cal-range" role="group" aria-label="Calendar range">
              <button type="button" className="wk-seg-item wv-cal-step" aria-label={`Previous ${unit}`} onClick={() => step(-1)}><ChevronIcon dir="prev" /></button>
              <button type="button" className="wk-seg-item" onClick={() => goTo(today)}>Today</button>
              <button type="button" className="wk-seg-item wv-cal-step" aria-label={`Next ${unit}`} onClick={() => step(1)}><ChevronIcon dir="next" /></button>
            </div>
            <SegmentedNav
              label="Calendar view"
              items={MODES.map((m) => ({ id: m.id, label: m.label, current: mode === m.id, onSelect: () => selectMode(m.id) }))}
            />
          </>
        )}
      >
        <div className="wv-cal-filters">
          <div className="wv-cal-kinds" role="group" aria-label="Show date kinds">
            {DATE_KIND_IDS.map((k) => {
              const on = kinds.includes(k);
              return (
                <button
                  key={k}
                  type="button"
                  className={cx('wk-chip', 'wv-kind-toggle', on && `wk-chip--${k}`)}
                  aria-pressed={on}
                  onClick={() => setKinds(on ? kinds.filter((x) => x !== k) : DATE_KIND_IDS.filter((x) => x === k || kinds.includes(x)))}
                >
                  <DateKindIcon kind={k} />{DATE_KIND_LABEL[k]}s
                </button>
              );
            })}
          </div>
          <label className="wv-check">
            <input type="checkbox" checked={showFinished} onChange={(event) => setShowFinished(event.target.checked)} />
            Show done &amp; dropped
          </label>
        </div>
      </PageHeader>

      {sidebarWidth === 0 && <section className="wv-cal-closed-tray" data-calendar-remove aria-label="Remove date"
        onDragOver={acceptDrop(['date'])} onDrop={onTrayDrop}>
        <Button size="sm" variant="ghost" onClick={() => resizeSidebar(sidebarRestore)}>Show calendar sidebar</Button>
        <span>Drop a date here to remove it</span>
      </section>}
      <div className="wv-cal-layout">
        <div ref={stage} className="wv-cal-main">
          <section className="wv-period-band" aria-label="Dates without a set day">
            <div className="wv-band-label">{timed ? `This ${mode}, no set day` : 'This month, no set day'}</div>
            <div className="wv-band-list">
              {coarse.length ? coarse.map((x) => chip(x, false, true)) : <span className="wv-muted">Month, quarter and year dates appear here.</span>}
            </div>
          </section>
          {timed ? <TimeGrid days={days} onOpenDay={mode === 'week' ? (day) => openDay(day, 'day') : undefined} entries={entries} chip={chip} onCommit={commitTime} onAllDay={allDay} onRemove={remove} onDrop={onGridDrop} acceptDrop={acceptDrop(['date', 'undated'])} /> : mode === 'month'
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
                          // Three chips fit a cell; a fourth turns the last slot into "+N more", which opens the day.
                          const shown = list.length > MAX_CHIPS ? list.slice(0, MAX_CHIPS - 1) : list;
                          return (
                            <div
                              key={iso}
                              role="group"
                              data-day={iso}
                              data-drop="day"
                              aria-label={`${formatDay(iso, { year: true })}, ${list.length} date${list.length === 1 ? '' : 's'}`}
                              className={cx('wv-day', Number(iso.slice(5, 7)) !== month && 'is-outside', iso === today && 'is-today', dayNum(iso) < dayNum(today) && 'is-past')}
                              onDragOver={acceptDrop(['date', 'undated'])}
                              onDrop={(event) => onDayDrop(event, iso)}
                            >
                              <div className="wv-day-head" title="Double-click to open this week" onDoubleClick={() => openDay(iso, 'week')}>
                                <button type="button" className="wv-day-num" aria-label={`Open week of ${formatDay(iso, { year: true })}`}
                                  aria-current={iso === today ? 'date' : undefined}
                                  onClick={(event) => { if (event.detail === 0) openDay(iso, 'week'); }}
                                  onKeyDown={(event) => {
                                    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openDay(iso, 'week'); }
                                  }}>{Number(iso.slice(8))}</button>
                                {env.capture && (
                                  <button
                                    type="button"
                                    className="wv-day-add"
                                    aria-label={`New item on ${formatDay(iso, { year: true })}`}
                                    title="New item on this day"
                                    onDoubleClick={(event) => event.stopPropagation()}
                                    onClick={() => env.capture!({ date: { kind: 'target', precision: 'day', value: iso } })}
                                  >+</button>
                                )}
                              </div>
                              <div className="wv-day-chips">
                                {shown.map((x) => chip(x, true))}
                                {list.length > MAX_CHIPS && (
                                  <button type="button" className="wv-day-more" aria-label={`${list.length - shown.length} more on ${formatDay(iso, { year: true })}. Open the day.`}
                                    onClick={() => openDay(iso, 'day')}>
                                    +{list.length - shown.length} more
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

        <div className="wv-cal-divider">
          <Splitter label="Calendar sidebar width" value={sidebarWidth} min={0} max={420} side="end" onResize={resizeSidebar}
            onToggle={() => resizeSidebar(sidebarWidth === 0 ? sidebarRestore : 0)} />
          {sidebarWidth === 0 && <button type="button" className="wv-cal-restore" aria-label="Restore calendar sidebar" title="Restore calendar sidebar" onClick={() => resizeSidebar(sidebarRestore)}>‹</button>}
        </div>
        <aside className="wv-cal-side" aria-label="Calendar sidebar" hidden={sidebarWidth === 0}>
          <section className="wv-tray" data-calendar-remove aria-label="Unscheduled items" onDragOver={acceptDrop(['date'])} onDrop={onTrayDrop}>
            <SectionHead title="Unscheduled" count={undated.length} />
            <p className="wv-hint">Drag onto a day to add a date, or use Schedule. Schedule adds a date on {dayText(target)}.</p>
            <div className="wv-tray-list">
              {TRAY_GROUPS.map((group) => {
                const list = groups[group.id];
                if (group.id === 'inbox') {
                  return list.length > 0 && (
                    <div key={group.id} className="wv-tray-group wv-tray-group--inbox" data-group={group.id}>
                      <div className="wv-tray-group-head">
                        <button type="button" className="wv-tray-toggle" aria-expanded={inboxOpen} aria-controls="wv-tray-inbox-list" onClick={() => setInboxOpen(!inboxOpen)}>
                          <svg className="work-icon work-icon--sm wv-tray-caret" viewBox="0 0 24 24" aria-hidden="true"><path d="m9.5 6 6 6-6 6" /></svg>
                          <span className="wv-tray-group-title">{group.title}</span>
                          <span className="wv-count">{list.length}</span>
                        </button>
                        {env.navigate && <button type="button" className="wv-more" onClick={() => env.navigate!({ view: 'review' })}>Sort in Review</button>}
                      </div>
                      <div id="wv-tray-inbox-list" className="wv-tray-group-list" hidden={!inboxOpen}>{list.map(trayItem)}</div>
                    </div>
                  );
                }
                return list.length > 0 && (
                  <div key={group.id} className="wv-tray-group" data-group={group.id} role="group" aria-labelledby={`wv-tray-${group.id}`}>
                    <div className="wv-tray-group-head">
                      <h4 id={`wv-tray-${group.id}`} className="wv-tray-group-title">{group.title}</h4>
                      <span className="wv-count">{list.length}</span>
                    </div>
                    <div className="wv-tray-group-list">{list.map(trayItem)}</div>
                  </div>
                );
              })}
              {!undated.length && <p className="wv-muted">Every visible item has a date. Unscheduled is a normal state, too.</p>}
            </div>
            <div className="wv-tray-drop" aria-hidden="true">Drop a date here to remove it</div>
          </section>

          <section className="wv-outside" aria-label={`Outside this ${unit}`}>
            <SectionHead title={`Outside this ${unit}`} count={outside.earlier.length + outside.later.length} />
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
              onClick={() => { const choice = dropChoice!; setDropChoice(null); add(choice.itemId, k, choice.day, choice.minute, choice.from); }}
            >
              {DATE_KIND_LABEL[k]}{k === 'target' ? ' (default)' : ''}
            </Button>
          ))}
        </div>
      </Dialog>

      <Dialog
        open={picker !== null && pickedItem !== undefined}
        onClose={() => setPicker(null)}
        title={pickedItem ? `Schedule “${pickedItem.title}”` : ''}
        description="Pick the day and the kind of date to create. Nothing is added until you schedule it."
        actions={(
          <>
            <Button onClick={() => setPicker(null)}>Cancel</Button>
            <Button variant="primary" disabled={!picker || !/^\d{4}-\d{2}-\d{2}$/.test(picker.day)} onClick={confirmPicker}>Schedule</Button>
          </>
        )}
      >
        {picker && (
          <div className="wv-picker">
            <label className="work-field">
              <span className="work-field-label">Day</span>
              <input
                type="date"
                className="work-input"
                value={picker.day}
                onChange={(event) => setPicker({ ...picker, day: event.target.value })}
                onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); confirmPicker(); } }}
              />
            </label>
            <div className="work-field">
              <span className="work-field-label" id="wv-picker-kind">Kind of date</span>
              <div className="wv-picker-kinds" role="group" aria-labelledby="wv-picker-kind">
                {DATE_KIND_IDS.map((k) => (
                  <button
                    key={k}
                    type="button"
                    className={cx('wk-chip', 'wv-kind-toggle', picker.kind === k && `wk-chip--${k}`)}
                    aria-pressed={picker.kind === k}
                    onClick={() => setPicker({ ...picker, kind: k })}
                  >
                    <DateKindIcon kind={k} />{DATE_KIND_LABEL[k]}{k === 'target' ? ' (default)' : ''}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
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
      className={cx('wv-cal-chip', `wv-dk--${entry.kind}`, `wv-ds--${st}`, !isDay && 'is-coarse', isPending(env.state, item.id) && 'is-pending', !isOpen(item) && 'is-closed', item.is_example && 'is-example')}
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
            <DateKindIcon kind={entry.kind} />
            {entry.time && <span className="wv-chip-time">{entry.time}</span>}
            <span className="wv-chip-title">{item.title}</span>
            {showPeriod && <span className="wv-chip-period">{value}</span>}
            {st === 'overdue' && <span className="wv-chip-flag" aria-hidden="true">Overdue</span>}
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
            data-drop={g.week ? undefined : 'day'}
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
