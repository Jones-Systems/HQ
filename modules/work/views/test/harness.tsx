import { render } from '@testing-library/react';
import {
  createFixturePlanner, createWorkStore, PLANNER_PORT_KEYS, withFaults, type Filters, type Item, type PlannerPort, type Settings,
} from '../../core';
import { resetViewMemory, type ViewLinks } from '../env';
import { VIEW_NOW, viewItems } from '../fixtures';
import type { PlanningViewId } from '../meta';
import { PlanningViews } from '../PlanningViews';

export const WRITE_METHODS = new Set(['create', 'patch', 'move', 'setArchived', 'markReviewed', 'updateSettings']);

/** Records every port call with its exact arguments (the core store tests use the same recorder). */
export function recording(inner: PlannerPort) {
  const calls: { method: string; args: unknown[] }[] = [];
  const port = Object.fromEntries(PLANNER_PORT_KEYS.map((key) => [key, (...args: unknown[]) => {
    calls.push({ method: key, args: structuredClone(args) });
    return (inner[key] as (...a: unknown[]) => Promise<unknown>)(...args);
  }])) as unknown as PlannerPort;
  return { port, calls, writes: () => calls.filter((c) => WRITE_METHODS.has(c.method)) };
}

/** Holds writes in flight until released, so the saving state can be observed. */
export function holding(inner: PlannerPort) {
  let gate: Promise<void> | null = null;
  let open = () => {};
  const port = Object.fromEntries(PLANNER_PORT_KEYS.map((key) => [key, async (...args: unknown[]) => {
    if (gate && WRITE_METHODS.has(key)) await gate;
    return (inner[key] as (...a: unknown[]) => Promise<unknown>)(...args);
  }])) as unknown as PlannerPort;
  return {
    port,
    hold: () => { gate = new Promise<void>((resolve) => { open = resolve; }); },
    release: () => { open(); gate = null; },
  };
}

/** A clock that starts at the fixture's Wednesday morning and ticks one second per call. */
export function clock(start = VIEW_NOW) {
  let t = Date.parse(start);
  return () => new Date((t += 1000));
}

export interface SetupOptions extends ViewLinks {
  view: PlanningViewId;
  items?: Item[];
  settings?: Settings;
  /** Load before rendering (default true). */
  loaded?: boolean;
  /** Reads fail as unavailable from the start. */
  readsDown?: boolean;
  filters?: Filters;
}

export async function setup({ view, items = viewItems(), settings, loaded = true, readsDown = false, filters, ...links }: SetupOptions) {
  resetViewMemory();
  const fixedNow = () => new Date(VIEW_NOW);
  const fixture = createFixturePlanner({ items, settings, now: clock() });
  const faulty = withFaults(fixture.port);
  const held = holding(faulty.port);
  const rec = recording(held.port);
  const store = createWorkStore(rec.port, { now: clock() });
  faulty.faults.readsUnavailable(readsDown);
  if (loaded) await store.load();
  const ui = render(<PlanningViews store={store} view={view} now={fixedNow} pollMs={3_600_000} filters={filters} {...links} />);
  const rerender = (next: { view: PlanningViewId }) => ui.rerender(
    <PlanningViews store={store} view={next.view} now={fixedNow} pollMs={3_600_000} filters={filters} {...links} />,
  );
  return { ...ui, rerender, store, fixture, faults: faulty.faults, held, rec, device: fixture.port };
}

/** The most recent write with its arguments. */
export function lastWrite(rec: ReturnType<typeof recording>) {
  const writes = rec.writes();
  return writes[writes.length - 1];
}
