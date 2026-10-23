import {
  createFixturePlanner, createWorkStore, PLANNER_PORT_KEYS, STATUS_IDS, withFaults,
  type Item, type PlannerPort, type Status,
} from '../../core';
import { createDraftStore } from '../../capture/drafts';
import { createDetailState } from '../../detail/detail-state';
import { createFeedback } from '../feedback';

// Shared fixtures for the Work board, detail and capture tests. Everything is
// fictional: the real fixture adapter and core store, with only transport
// faults synthetic.

export const NOW = '2026-10-21T16:00:00.000Z';
export const TODAY = '2026-10-21';
export const fixedNow = () => new Date(NOW);

export function clock(start = NOW) {
  let t = Date.parse(start);
  return () => new Date((t += 1000));
}

export function counter(prefix: string, width = 8) {
  let n = 0;
  return () => `${prefix}${String((n += 1)).padStart(width, '0')}`;
}

export interface PortCall { method: string; args: unknown[] }

/** Records every port call with its exact arguments, as sent. */
export function recording(inner: PlannerPort) {
  const calls: PortCall[] = [];
  const port = Object.fromEntries(PLANNER_PORT_KEYS.map((key) => [key, (...args: unknown[]) => {
    calls.push({ method: key, args: structuredClone(args) });
    return (inner[key] as (...a: unknown[]) => Promise<unknown>)(...args);
  }])) as unknown as PlannerPort;
  return { port, calls };
}

const STAMP = '2026-10-01T15:00:00.000Z';

export function item(id: string, title: string, status: Status, position: number, fields: Partial<Item> = {}): Item {
  return {
    id, revision: 1, title, kind: 'idea', status, motivation: null, horizon: null, priority: null, area: null, notes: '',
    next_steps: [], references: [], dates: [], position, is_example: false, created_at: STAMP, updated_at: STAMP,
    archived_at: null, reviewed_at: null, ...fields,
  };
}

/** A small fictional board: three in Inbox, two in Next, one Active, one Done, one Dropped. */
export function boardItems(): Item[] {
  return [
    item('it-seed', 'Sort the seed packets', 'inbox', 1024),
    item('it-kite', 'Sketch a kite frame', 'inbox', 2048, { motivation: 'want' }),
    item('it-lamp', 'Fix the porch lamp', 'inbox', 3072, { kind: 'chore' }),
    item('it-zine', 'Draft a garden zine', 'next', 1024, { motivation: 'exploring', horizon: 'soon', area: 'Garden' }),
    item('it-bread', 'Bake a rye loaf', 'next', 2048, { dates: [{ id: 'd-bread', kind: 'deadline', precision: 'day', value: '2026-10-19', time: null, end_time: null, tz: null, note: '' }] }),
    item('it-shed', 'Repaint the shed', 'active', 1024, { motivation: 'need', priority: 'high', notes: 'Primer first.' }),
    item('it-bike', 'Tune the bicycle', 'done', 1024),
    item('it-pond', 'Dig a pond', 'dropped', 1024),
  ];
}

export async function setup(options: { items?: Item[]; features?: string[]; load?: boolean } = {}) {
  const now = clock();
  const fixture = createFixturePlanner({ items: options.items ?? boardItems(), now, newId: counter('item-'), features: options.features });
  const device = fixture.port; // another device writing to the same Planner
  const otherRid = counter('other-');
  const faulty = withFaults(fixture.port);
  const rec = recording(faulty.port);
  const store = createWorkStore(rec.port, { now, newRequestId: counter('req-') });
  const feedback = createFeedback();
  const drafts = createDraftStore({ now });
  const detail = createDetailState();
  if (options.load !== false) await store.load();
  const order = (status: Status) => store.getState().items
    .filter((i) => i.status === status && !i.archived_at).sort((a, b) => a.position - b.position).map((i) => i.id);
  const layout = () => Object.fromEntries(STATUS_IDS.map((status) => [status, order(status)]));
  const byId = (id: string) => store.getState().confirmed!.items.find((i) => i.id === id)!;
  return { fixture, device, otherRid, faults: faulty.faults, calls: rec.calls, store, feedback, drafts, detail, order, layout, byId };
}

/** Writes made through the port: everything except reads. */
export const writes = (calls: readonly PortCall[]) => calls.filter((c) => !['snapshot', 'version', 'history'].includes(c.method));

/** A `move` call without its request ID, for call-for-call comparison. */
export const moveShape = (call: PortCall) => ({ method: call.method, args: call.args.slice(0, -1) });

