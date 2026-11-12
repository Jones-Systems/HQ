import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { HqServices, ServiceResponse } from '@hq/contracts/services';
import { DataSourcesProvider, useDataSources } from './DataSources';
import { createObservedStatusStore } from '../services/observed-status';

function Consumer() {
  const { statuses, check } = useDataSources();
  return <><output aria-label="Work observation">{statuses.work.text}</output><button onClick={() => void check('work')}>Probe Work</button></>;
}
afterEach(() => { cleanup(); Reflect.deleteProperty(window, 'hqServices'); });

it.each([
  [{ ok: true, status: 403, body: null, replayed: false }, 'Refused'],
  [{ ok: true, status: 200, body: { api: 2, state_version: 7, features: [] }, replayed: false }, 'Reachable · limited (no replay, no HQ links, no batch create)'],
  [{ ok: false, kind: 'unavailable' }, 'Unreachable'],
] as const)('checks Planner health once and shares its wording and observation time: %s', async (answer, label) => {
  const call = vi.fn(async () => answer as ServiceResponse);
  const config = { status: async () => ({ configured: true, policy: 'ok', transport: 'loopback-http' }) };
  Object.defineProperty(window, 'hqServices', { configurable: true, value: { config, work: { call } } as unknown as HqServices });
  const store = createObservedStatusStore({ now: () => new Date(2026, 10, 12, 9, 30).getTime() });
  render(<DataSourcesProvider store={store}><Consumer /></DataSourcesProvider>);
  await screen.findByText('Set up · not checked');
  fireEvent.click(screen.getByRole('button', { name: 'Probe Work' }));
  await vi.waitFor(() => expect(screen.getByLabelText('Work observation').textContent).toContain(label));
  expect(screen.getByLabelText('Work observation').textContent).toContain('09:30');
  expect(call.mock.calls).toEqual([['version', {}]]);
  expect(store.getSnapshot().work?.status?.text).toBe(label === 'Refused' ? 'Refused · start the Planner with --allowed-host for this address' : label);
});
