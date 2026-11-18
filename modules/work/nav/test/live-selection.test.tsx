import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseProjectContext, type ModulePort } from '@hq/contracts';
import * as Work from '@hq/work';
import { createFixturePlanner, EXAMPLE_SETTINGS, REPLAY_FEATURE } from '../../core';
import { createPlannerLive, WORK_READ_ROUTES, type WorkRoute } from '../../live';
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
  it('exports the shell injection seam and example factory, but not the test reset', () => {
    expect(Work.setWorkSessionPort).toBe(setWorkSessionPort);
    expect(Work.examplePlanner).toBeTypeOf('function');
    expect(Work).not.toHaveProperty('resetWorkSessions');
  });

  it('uses the publicly injected live Planner and recovery across shell remounts', async () => {
    const { bridge } = fixtureBridge();
    const fixture = createFixturePlanner({ items: viewItems(VIEW_TODAY), features: [REPLAY_FEATURE] });
    const wire = fixtureTransport(fixture);
    const live = createPlannerLive(wire.transport);
    const check = vi.spyOn(live.recovery, 'check');
    Work.setWorkSessionPort(live.port, { example: false, recovery: live.recovery });
    const first = render(<Work.WorkModule {...port('home')} />);
    await screen.findByRole('heading', { level: 2, name: 'Status board' });
    const session = workSession(CONTEXT.id);
    expect(session.store.getState().confirmed!.items).toHaveLength(viewItems(VIEW_TODAY).length);
    expect(screen.queryByText(EXAMPLE_NOTE)).toBeNull();
    const item = session.store.getState().items[0]!;
    wire.next('patch', 'lose-response');
    const outcome = await session.store.patch(item.id, { notes: 'Shell-injected recovery' });
    expect(outcome.status).toBe('unconfirmed');
    const readsBeforeRemount = wire.calls.filter(({ route }) => route === 'state').length;
    first.unmount();
    render(<Work.WorkModule {...port('home')} />);
    await screen.findByRole('heading', { level: 2, name: 'Status board' });
    expect(workSession(CONTEXT.id)).toBe(session);
    expect(wire.calls.filter(({ route }) => route === 'state')).toHaveLength(readsBeforeRemount);
    expect(session.store.getState().unconfirmed).toHaveLength(1);
    await session.store.reconcile();
    expect(check).toHaveBeenCalledWith(outcome.status === 'unconfirmed' ? outcome.requestId : '');
    expect(session.store.getState().unconfirmed).toEqual([]);
    expect(wire.calls.filter(({ route }) => route === 'patch')).toHaveLength(1);
    expect(bridge.reads()).toBe(0);
    expect(bridge.routes).toEqual([]);
  });

  it.each([true, false])('labels an explicitly injected example according to example: %s', async (example) => {
    Work.setWorkSessionPort(Work.examplePlanner(fixedNow()), { example });
    render(<Work.WorkModule {...port('home')} />);
    await screen.findByRole('heading', { level: 2, name: 'Status board' });
    expect(workSession(CONTEXT.id).example).toBe(example);
    expect(screen.queryByText(EXAMPLE_NOTE) !== null).toBe(example);
  });

  it('keeps a configured injected live error unavailable across remounts without fixtures', async () => {
    const call = vi.fn(async () => ({ ok: false as const, kind: 'unavailable' as const }));
    const live = createPlannerLive({ call });
    Work.setWorkSessionPort(live.port, { example: false, recovery: live.recovery });
    const first = render(<Work.WorkModule {...port('home')} />);
    await screen.findByText('Planner service unreachable');
    const session = workSession(CONTEXT.id);
    first.unmount();
    render(<Work.WorkModule {...port('home')} />);
    await screen.findByText('Planner service unreachable');
    expect(workSession(CONTEXT.id)).toBe(session);
    expect(session.example).toBe(false);
    expect(session.store.getState().items).toEqual([]);
    expect(screen.queryByText(EXAMPLE_NOTE)).toBeNull();
    expect(call).toHaveBeenCalled();
  });

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
