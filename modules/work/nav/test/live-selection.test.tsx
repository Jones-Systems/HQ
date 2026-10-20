import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseProjectContext, type ModulePort } from '@hq/contracts';
import { createFixturePlanner, EXAMPLE_SETTINGS, REPLAY_FEATURE } from '../../core';
import { WORK_READ_ROUTES, type WorkRoute } from '../../live';
import { fixtureTransport } from '../../live/test/support';
import { VIEW_TODAY, viewItems } from '../../views/fixtures';
import { EXAMPLE_NOTE, resetWorkSessions, setWorkSessionPort, WorkDomain, workSession } from '..';
import { fixedNow } from './support';

// Production Planner selection (nav/session.ts): live over `window.hqServices.work` when the bridge is present, chosen
// once; the labelled example when it is absent; never a fallback from an unreachable or unconfigured live Planner.
// The bridge here is synthetic: the fixture Planner behind the typed routes.

const CONTEXT = parseProjectContext({ id: 'selection-project', name: 'Selection fixture project' })!;
const port = (destination: string): ModulePort => ({
  context: CONTEXT, destination, appearance: 'light', desktop: { platform: 'browser', versions: { electron: null } }, navigate: vi.fn(),
});

type Global = { hqServices?: unknown };

/** Installs `window.hqServices.work`, counting how often the renderer reads it. */
function installBridge(call: (route: string, params: unknown) => Promise<unknown>) {
  const routes: WorkRoute[] = [];
  let reads = 0;
  const work = { call: (route: string, params: unknown) => { routes.push(route as WorkRoute); return call(route, params); } };
  const services = {};
  Object.defineProperty(services, 'work', { get: () => { reads += 1; return work; }, configurable: true });
  (globalThis as Global).hqServices = services;
  return { routes, reads: () => reads };
}

function fixtureBridge() {
  const fixture = createFixturePlanner({ items: viewItems(VIEW_TODAY), settings: { ...EXAMPLE_SETTINGS }, features: [REPLAY_FEATURE] });
  const wire = fixtureTransport(fixture);
  return { fixture, bridge: installBridge((route, params) => wire.transport.call(route as never, params as never)) };
}

beforeEach(() => {
  setWorkSessionPort(null);
  resetWorkSessions();
});

afterEach(() => {
  cleanup();
  delete (globalThis as Global).hqServices;
  setWorkSessionPort(null);
  resetWorkSessions();
});

describe('Work Planner selection', () => {
  it('without a bridge, runs on the labelled fictional example', async () => {
    expect((globalThis as Global).hqServices).toBeUndefined();
    expect(workSession(CONTEXT.id).example).toBe(true);
    render(<WorkDomain {...port('home')} now={fixedNow} />);
    expect(await screen.findByText(EXAMPLE_NOTE)).toBeTruthy();
  });

  it('with a bridge, chooses the live Planner once for every session, unlabelled as an example', async () => {
    const { bridge } = fixtureBridge();
    const first = workSession('project-a');
    const second = workSession('project-b');
    expect([first.example, second.example]).toEqual([false, false]);
    expect(bridge.reads()).toBe(1);
    await first.store.load();
    await second.store.load();
    expect(bridge.routes).toEqual(['state', 'state']);
    expect(first.store.getState().confirmed!.items.length).toBeGreaterThan(0);
    render(<WorkDomain {...port('home')} now={fixedNow} />);
    expect(await screen.findByRole('heading', { level: 2, name: 'Status board' })).toBeTruthy();
    expect(screen.queryByText(EXAMPLE_NOTE)).toBeNull();
  });

  it.each([
    ['unconfigured', { ok: false, kind: 'unavailable' }],
    ['unreachable', { ok: false, kind: 'unknown' }],
    ['answering 503', { ok: true, status: 503, body: null, replayed: false }],
  ])('an %s live Planner never falls back to the example', async (_, response) => {
    const bridge = installBridge(async () => response);
    render(<WorkDomain {...port('home')} now={fixedNow} />);
    expect(await screen.findByText('Planner service unreachable')).toBeTruthy();
    expect(screen.queryByText(EXAMPLE_NOTE)).toBeNull();
    expect(workSession(CONTEXT.id).example).toBe(false);
    expect(workSession(CONTEXT.id).store.getState().items).toEqual([]);
    expect(bridge.routes.every((route) => (WORK_READ_ROUTES as readonly string[]).includes(route))).toBe(true);
  });

  it('mounting, remounting and switching pages make reads only, with the session reused', async () => {
    const { bridge, fixture } = fixtureBridge();
    const version = fixture.control.stateVersion();
    const first = render(<WorkDomain {...port('home')} now={fixedNow} />);
    await screen.findByRole('heading', { level: 2, name: 'Status board' });
    first.unmount();
    const again = render(<WorkDomain {...port('home')} now={fixedNow} />);
    await screen.findByRole('heading', { level: 2, name: 'Status board' });
    again.rerender(<WorkDomain {...port('list')} now={fixedNow} />);
    again.rerender(<WorkDomain {...port('calendar')} now={fixedNow} />);
    again.unmount();
    expect(bridge.routes.filter((route) => route === 'state')).toHaveLength(1);
    expect(bridge.routes.every((route) => route === 'state' || route === 'version')).toBe(true);
    expect(fixture.control.stateVersion()).toBe(version);
    expect(bridge.reads()).toBe(1);
  });

  it('keeps the setWorkSessionPort seam ahead of the bridge', async () => {
    const { bridge } = fixtureBridge();
    const seam = createFixturePlanner({ items: viewItems(VIEW_TODAY) });
    setWorkSessionPort(seam.port);
    expect(workSession(CONTEXT.id).example).toBe(true);
    await workSession(CONTEXT.id).store.load();
    expect(bridge.routes).toEqual([]);
    setWorkSessionPort(seam.port, { example: false });
    expect(workSession('another-project').example).toBe(false);
  });
});
