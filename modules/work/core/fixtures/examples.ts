import { addDays, isoWeekOf } from '../upstream/manual-planner/dates.js';
import { DEFAULT_SETTINGS, type Item, type PlanningDate, type Settings } from '../types';

// Synthetic, fictional planning items for the fixture adapter and view
// fixtures. No real records, people, organisations or addresses.

const STAMP = '2026-10-01T15:00:00.000Z';

function item(id: string, title: string, fields: Partial<Item>, position: number): Item {
  return {
    id, revision: 1, title, kind: 'idea', status: 'inbox', motivation: null, horizon: null, priority: null,
    area: null, notes: '', next_steps: [], references: [], dates: [], position, is_example: true,
    created_at: STAMP, updated_at: STAMP, archived_at: null, reviewed_at: null, ...fields,
  };
}

function date(id: string, kind: PlanningDate['kind'], precision: PlanningDate['precision'], value: string, extra: Partial<PlanningDate> = {}): PlanningDate {
  return { id, kind, precision, value, time: null, end_time: null, tz: null, note: '', ...extra };
}

/** Example items dated relative to `today` (an ISO day) so every view has content. */
export function exampleItems(today: string): Item[] {
  return [
    item('ex-shed-paint', 'Repaint the garden shed', {
      kind: 'chore', status: 'active', motivation: 'need', horizon: 'now', priority: 'high', area: 'Home',
      next_steps: [{ id: 'step-primer', text: 'Buy primer', done: true }, { id: 'step-sand', text: 'Sand the door', done: false }],
      dates: [date('date-shed-dl', 'deadline', 'day', addDays(today, 3))],
    }, 1024),
    item('ex-bread', 'Learn three bread recipes', {
      kind: 'goal', status: 'next', motivation: 'want', horizon: 'soon', area: 'Kitchen',
      dates: [date('date-bread-wk', 'target', 'week', isoWeekOf(addDays(today, 14)))],
    }, 1024),
    item('ex-market-list', 'Draft the spring market stall list', {
      kind: 'project', status: 'considering', motivation: 'exploring', horizon: 'later', area: 'Market',
      notes: 'Sketch which stalls fit the fictional square.',
      references: [{ id: 'ref-market-notes', kind: 'doc', label: 'Stall sketch', url: 'https://example.com/stalls' }],
      dates: [date('date-market-q', 'target', 'quarter', `${Number(today.slice(0, 4)) + 1}-Q2`)],
    }, 1024),
    item('ex-library', 'Renew the library card', {
      kind: 'chore', status: 'inbox', priority: 'low',
      dates: [date('date-library', 'event', 'day', today, { time: '10:30', tz: 'America/New_York' })],
    }, 1024),
    item('ex-bike', 'Tune up the old bicycle', { kind: 'chore', status: 'on_hold', horizon: 'someday' }, 1024),
    item('ex-kite', 'Build a box kite', { kind: 'idea', status: 'done', motivation: 'want' }, 1024),
    item('ex-pond', 'Dig a garden pond', { kind: 'idea', status: 'dropped' }, 1024),
  ];
}

export const EXAMPLE_SETTINGS: Readonly<Settings> = DEFAULT_SETTINGS;
