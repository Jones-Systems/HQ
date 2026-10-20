import { addDays, exampleItems, type Item, type PlanningDate } from '../core';

// Synthetic, fictional planning items for the view tests and the evidence
// page. They extend the core examples so every view and Review bucket has
// content. No real records, people, organisations or addresses.

/** A Wednesday morning in the default display zone (America/New_York). */
export const VIEW_NOW = '2026-10-21T15:00:00.000Z';
export const VIEW_TODAY = '2026-10-21';

const STAMP = '2026-10-19T14:00:00.000Z';

function date(id: string, kind: PlanningDate['kind'], precision: PlanningDate['precision'], value: string, extra: Partial<PlanningDate> = {}): PlanningDate {
  return { id, kind, precision, value, time: null, end_time: null, tz: null, note: '', ...extra };
}

function item(id: string, title: string, fields: Partial<Item>): Item {
  return {
    id, revision: 1, title, kind: 'idea', status: 'inbox', motivation: null, horizon: null, priority: null,
    area: null, notes: '', next_steps: [], references: [], dates: [], position: 2048, is_example: true,
    created_at: STAMP, updated_at: STAMP, archived_at: null, reviewed_at: null, ...fields,
  };
}

/** Core examples plus items for overdue, passed, quiet, mismatched, spanned, archived and undated cases. */
export function viewItems(today: string = VIEW_TODAY): Item[] {
  return [
    ...exampleItems(today),
    item('ex-seed-tray', 'Return the seed-swap tray', {
      kind: 'chore', status: 'next', motivation: 'need', horizon: 'soon', area: 'Garden',
      dates: [date('date-seed-dl', 'deadline', 'day', addDays(today, -2))],
    }),
    item('ex-quilt', 'Finish the patchwork quilt', {
      kind: 'project', status: 'active', motivation: 'want', horizon: 'now', area: 'Home',
      created_at: '2026-08-01T14:00:00.000Z', updated_at: '2026-09-01T14:00:00.000Z',
      next_steps: [{ id: 'step-quilt-border', text: 'Sew the border', done: false }],
      dates: [date('date-quilt-start', 'start', 'day', addDays(today, -30)), date('date-quilt-target', 'target', 'month', addDays(today, 62).slice(0, 7))],
    }),
    item('ex-choir', 'Sing at the winter fair', {
      kind: 'goal', status: 'next', motivation: 'want', horizon: 'now',
      dates: [date('date-choir', 'event', 'day', addDays(today, 2), { time: '18:00', tz: 'America/New_York' })],
    }),
    item('ex-garden-plan', 'Sketch next year’s vegetable beds', {
      kind: 'project', status: 'considering', horizon: 'later', area: 'Garden',
      dates: [date('date-beds-target', 'target', 'day', addDays(today, -10))],
    }),
    item('ex-stargazing', 'Plan a stargazing night', {
      kind: 'idea', status: 'considering', motivation: 'exploring', horizon: 'someday',
      dates: [date('date-stars-dl', 'deadline', 'day', addDays(today, 20))],
    }),
    item('ex-long-walk', 'Walk the coastal path end to end', {
      kind: 'goal', status: 'next', motivation: 'want', horizon: 'now',
      dates: [date('date-walk-target', 'target', 'day', addDays(today, 200))],
    }),
    item('ex-postcards', 'Sort the old postcards', { kind: 'chore', status: 'inbox' }),
    item('ex-old-recipes', 'Copy out the old recipe cards', {
      kind: 'chore', status: 'done', archived_at: '2026-10-10T14:00:00.000Z', updated_at: '2026-10-10T14:00:00.000Z',
    }),
  ];
}
