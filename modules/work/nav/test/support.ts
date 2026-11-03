import { createFixturePlanner, EXAMPLE_SETTINGS, PLANNER_PORT_KEYS, withFaults, type Item, type PlannerPort, type Settings } from '../../core';
import { resetViewMemory } from '../../views/env';
import { VIEW_NOW, viewItems } from '../../views/fixtures';
import { resetWorkSessions, setWorkSessionPort } from '../session';

// Test support for the Work domain: a recorded fixture Planner installed as the port of new Work sessions.

export const READ_METHODS = new Set(['snapshot', 'version', 'history']);
export const WRITE_METHODS = new Set(['create', 'patch', 'move', 'setArchived', 'markReviewed', 'updateSettings']);

export const fixedNow = () => new Date(VIEW_NOW);

/** Records every port call. Any method outside the Planner's read and write sets would be an execution-class call. */
export function recordPlanner(inner: PlannerPort) {
  const calls: { method: string; args: unknown[] }[] = [];
  const port = Object.fromEntries(PLANNER_PORT_KEYS.map((key) => [key, (...args: unknown[]) => {
    calls.push({ method: key, args: structuredClone(args) });
    return (inner[key] as (...a: unknown[]) => Promise<unknown>)(...args);
  }])) as unknown as PlannerPort;
  return {
    port,
    calls,
    writes: () => calls.filter((call) => WRITE_METHODS.has(call.method)),
    reads: () => calls.filter((call) => READ_METHODS.has(call.method)),
    execution: () => calls.filter((call) => !READ_METHODS.has(call.method) && !WRITE_METHODS.has(call.method)),
  };
}

export type RecordedPlanner = ReturnType<typeof recordPlanner>;

/** Installs a fresh recorded fixture Planner for the next Work session and forgets earlier sessions. */
export function installPlanner(options: { items?: Item[]; settings?: Settings } = {}) {
  resetWorkSessions();
  resetViewMemory();
  const fixture = createFixturePlanner({ items: options.items ?? viewItems(), settings: options.settings ?? { ...EXAMPLE_SETTINGS } });
  const faulty = withFaults(fixture.port);
  const recorded = recordPlanner(faulty.port);
  setWorkSessionPort(recorded.port);
  return { recorded, device: fixture.port, faults: faulty.faults, fixture };
}

export function uninstallPlanner(): void {
  setWorkSessionPort(null);
  resetWorkSessions();
  resetViewMemory();
}
