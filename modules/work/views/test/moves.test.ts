import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { contrastRatio, parseColor } from '@hq/ui';
import { DATE_KIND_IDS, STATUS_IDS, withDerived, type Item } from '../../core';
import { VIEW_TODAY, viewItems } from '../fixtures';
import {
  addDatePatch, outsideEntries, removeDatePatch, rescheduleDatePatch, scheduleDay, shiftDatePatch, stepHorizon,
  timelineGeometry, timelineScale, untouchedDays, upcomingEntries,
} from '../moves';

const byId = (id: string) => viewItems().find((it) => it.id === id)!;
/** As read from the service: timed dates carry derived instants. */
const asRead = (item: Item): Item => ({ ...item, dates: item.dates.map(withDerived) });

describe('calendar patches (Planner changeDate)', () => {
  it('a day shift replaces only the value and sends every date in write form', () => {
    const library = asRead(byId('ex-library'));
    expect(library.dates[0]!.instant).toBeDefined();
    const patch = shiftDatePatch(library, 'date-library', 1)!;
    expect(patch).toEqual({ dates: [{
      id: 'date-library', kind: 'event', precision: 'day', value: '2026-10-22', time: '10:30', end_time: null, tz: 'America/New_York', note: '',
    }] });
  });

  it('sends the item’s other timed dates in write form too, without derived instants', () => {
    const two = asRead({
      ...byId('ex-library'),
      dates: [
        { id: 'date-a', kind: 'event', precision: 'day', value: '2026-10-21', time: '09:00', end_time: '10:00', tz: 'America/New_York', note: 'a' },
        { id: 'date-b', kind: 'event', precision: 'day', value: '2026-10-22', time: '18:00', end_time: null, tz: 'Europe/London', note: 'b' },
      ],
    });
    expect(two.dates[1]!.instant).toBeDefined();
    const patch = shiftDatePatch(two, 'date-a', 1)!;
    for (const entry of patch.dates!) {
      expect(Object.keys(entry).sort()).toEqual(['end_time', 'id', 'kind', 'note', 'precision', 'time', 'tz', 'value']);
    }
    expect(patch.dates![1]).toMatchObject({ id: 'date-b', value: '2026-10-22', time: '18:00', tz: 'Europe/London', note: 'b' });
    expect(Object.keys(removeDatePatch(two, 'date-a')!.dates![0]!)).not.toContain('instant');
    expect(Object.keys(addDatePatch(two, 'target', '2026-10-30').dates![0]!)).not.toContain('instant');
  });

  it('keeps the other dates of the item untouched and in order', () => {
    const quilt = byId('ex-quilt');
    const patch = shiftDatePatch(quilt, 'date-quilt-start', 7)!;
    expect(patch.dates!.map((d) => d.id)).toEqual(['date-quilt-start', 'date-quilt-target']);
    expect(patch.dates![1]).toEqual(quilt.dates[1]);
    expect(patch.dates![0]!.value).toBe('2026-09-28');
  });

  it('refuses coarse dates, unknown entries and no-op moves', () => {
    const quilt = byId('ex-quilt');
    expect(shiftDatePatch(quilt, 'date-quilt-target', 1)).toBeNull();
    expect(shiftDatePatch(quilt, 'missing', 1)).toBeNull();
    expect(shiftDatePatch(quilt, 'date-quilt-start', 0)).toBeNull();
    expect(rescheduleDatePatch(byId('ex-shed-paint'), 'date-shed-dl', '2026-10-24')).toBeNull();
  });

  it('removes one date, and adds a day date of the chosen kind without inventing an id', () => {
    expect(removeDatePatch(byId('ex-quilt'), 'date-quilt-start')).toEqual({ dates: [byId('ex-quilt').dates[1]] });
    expect(removeDatePatch(byId('ex-quilt'), 'missing')).toBeNull();
    expect(addDatePatch(byId('ex-bike'), 'deadline', '2026-10-21')).toEqual({ dates: [{ kind: 'deadline', precision: 'day', value: '2026-10-21', note: '' }] });
  });

  it('Schedule uses today in the current month, else the 1st of the shown month', () => {
    expect(scheduleDay(2026, 10, VIEW_TODAY)).toBe(VIEW_TODAY);
    expect(scheduleDay(2026, 12, VIEW_TODAY)).toBe('2026-12-01');
    expect(scheduleDay(2026, 9, VIEW_TODAY)).toBe('2026-09-01');
  });
});

describe('timeline', () => {
  it('steps through Now, Soon, Later, Someday and No horizon, stopping at either end', () => {
    expect(stepHorizon('now', 1)).toBe('soon');
    expect(stepHorizon('someday', 1)).toBeNull();
    expect(stepHorizon(null, -1)).toBe('someday');
    expect(stepHorizon('now', -1)).toBeUndefined();
    expect(stepHorizon(null, 1)).toBeUndefined();
  });

  it('spans eight quarters from today’s and invents no duration', () => {
    const scale = timelineScale(VIEW_TODAY);
    expect(scale.quarters.map((q) => q.value)).toEqual(['2026-Q4', '2027-Q1', '2027-Q2', '2027-Q3', '2027-Q4', '2028-Q1', '2028-Q2', '2028-Q3']);
    expect(scale.quarters[0]!.left).toBe(0);
    expect(scale.today).toBeGreaterThan(0);
    expect(timelineGeometry(byId('ex-shed-paint'), VIEW_TODAY).spans).toEqual([]);
    const quilt = timelineGeometry(byId('ex-quilt'), VIEW_TODAY);
    expect(quilt.spans).toHaveLength(1);
    expect(quilt.spans[0]!.left).toBe(0);
    expect(quilt.marks.map((m) => m.shape)).toEqual(['edge-before', 'band']);
    expect(timelineGeometry(byId('ex-library'), VIEW_TODAY).marks[0]!.shape).toBe('marker');
  });
});

describe('selections', () => {
  it('Next 21 days excludes overdue deadlines and coarse periods', () => {
    const open = viewItems().filter((it) => !['done', 'dropped'].includes(it.status) && !it.archived_at);
    const ids = upcomingEntries(open, VIEW_TODAY).map((x) => x.item.id);
    expect(ids).toEqual(['ex-library', 'ex-choir', 'ex-shed-paint', 'ex-bread', 'ex-stargazing']);
    expect(ids).not.toContain('ex-seed-tray');
  });

  it('Outside this month keeps only open, non-event, ended dates as earlier', () => {
    const entries = viewItems().flatMap((item) => item.dates.map((entry) => ({ item, entry, bounds: [entry.value, entry.value] as [string, string] })))
      .filter((x) => x.entry.precision === 'day');
    const { earlier, later } = outsideEntries(entries, ['2026-11-01', '2026-11-30'], VIEW_TODAY);
    expect(earlier.map((x) => x.item.id)).toEqual(['ex-seed-tray', 'ex-garden-plan', 'ex-quilt']);
    expect(later.map((x) => x.item.id)).toEqual(['ex-long-walk']);
  });

  it('untouched days count from the later of updated and reviewed, in the display zone', () => {
    const quilt = byId('ex-quilt');
    const settings = { default_tz: 'America/New_York', week_start: 'sun' as const, stale_days: 21 };
    expect(untouchedDays(quilt, VIEW_TODAY, settings)).toBe(50);
    expect(untouchedDays({ ...quilt, reviewed_at: '2026-10-20T14:00:00.000Z' }, VIEW_TODAY, settings)).toBe(1);
  });
});

describe('module-local Work roles', () => {
  const css = readFileSync(new URL('../work-views.css', import.meta.url), 'utf8');
  const tokens = JSON.parse(readFileSync(new URL('../../../../packages/hq-ui/src/tokens/hq-tokens.json', import.meta.url), 'utf8')) as {
    color: Record<string, { light: string; dark: string }>;
  };
  const role = (name: string) => {
    const m = new RegExp(`--${name}:\\s*light-dark\\((#[0-9A-Fa-f]{6}),\\s*(#[0-9A-Fa-f]{6})\\)`).exec(css);
    if (!m) throw new Error(`missing role --${name}`);
    return { light: m[1]!, dark: m[2]! };
  };
  const surfaces = ['surface', 'surface-raised', 'surface-sunken'];

  it.each(STATUS_IDS)('--work-st-%s has a light and dark value with 3:1 on every HQ surface (it is a shape, paired with the word)', (status) => {
    const value = role(`work-st-${status}`);
    for (const mode of ['light', 'dark'] as const) {
      for (const surface of surfaces) {
        expect(contrastRatio(parseColor(value[mode]), parseColor(tokens.color[surface]![mode]))).toBeGreaterThanOrEqual(3);
      }
    }
  });

  it.each(DATE_KIND_IDS)('--work-dk-%s has a light and dark value with 4.5:1 text contrast on every HQ surface', (kind) => {
    const value = role(`work-dk-${kind}`);
    for (const mode of ['light', 'dark'] as const) {
      for (const surface of surfaces) {
        expect(contrastRatio(parseColor(value[mode]), parseColor(tokens.color[surface]![mode]))).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it('declares no inline style attributes, filters or blend modes', () => {
    expect(css).not.toMatch(/\bfilter\s*:/);
    expect(css).not.toMatch(/mix-blend-mode/);
    expect(css).toMatch(/prefers-reduced-motion: reduce/);
  });
});
