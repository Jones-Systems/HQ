import { useState } from 'react';
import { act, cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ModulePort } from '@hq/contracts';
import SocialDefault, { SocialModule } from '@hq/social';
import { FIXTURE_PROJECT_ID, resetSocialSessions } from '../../core';
import type { ServiceResponse, SocialServiceTransport } from '../../live';
import { createWireStub, type WireStub } from '../../live/test/wire-stub';
import { createWorkbenchFixture } from '../../workbench/fixtures/examples';
import { selectSocialWorkspace, setSocialWorkspacePort, socialWorkspace } from '../workspace';

/**
 * Production source selection (task.social-live-adapter.001): the Social module chooses its workspace
 * source once per window from the preload bridge, labels only the fictional example workspace, never
 * falls back from an unreachable live service to the fixture, and navigation or remount execute nothing.
 * The bridge here is a fictional wire-codec stub; Electron, the real bridge and service are not exercised.
 */

type Scope = { hqServices?: unknown };
const scope = () => window as unknown as Scope;

function installBridge(social: unknown): void {
  scope().hqServices = { social };
}

const BANNER = /^Fictional example workspace/u;
const CONTEXT = { id: FIXTURE_PROJECT_ID, name: 'Larkspur project' };
const NOW = () => new Date('2026-10-20T12:00:00Z');

beforeEach(() => {
  resetSocialSessions();
  setSocialWorkspacePort(null);
});

afterEach(() => {
  cleanup();
  resetSocialSessions();
  setSocialWorkspacePort(null);
  delete scope().hqServices;
});

/** Mounts the production module the way the shell does: destination state plus a remount key. */
function mount(destination = 'home') {
  let bump: () => void = () => {};
  let go: (next: string) => void = () => {};
  function Shell() {
    const [where, setWhere] = useState(destination);
    const [generation, setGeneration] = useState(0);
    bump = () => act(() => setGeneration((value) => value + 1));
    go = (next) => act(() => setWhere(next));
    const port: ModulePort = {
      context: CONTEXT, destination: where, appearance: 'light', desktop: { platform: 'browser', versions: { electron: null } },
      navigate: (next) => setWhere(next),
    };
    return <SocialModule key={generation} {...port} />;
  }
  render(<Shell />);
  return { remount: () => bump(), go: (next: string) => go(next), user: userEvent.setup() };
}

function liveStub(): WireStub {
  const stub = createWireStub({ clock: NOW, features: [] });
  installBridge(stub.transport);
  return stub;
}

const overview = () => screen.findByRole('heading', { level: 1, name: 'Overview' });

describe('Social workspace source selection', () => {
  it('uses the labelled fixture when no bridge is present', async () => {
    expect(selectSocialWorkspace({}).source).toBe('fixture');
    expect(SocialDefault).toBe(SocialModule);
    mount();
    await overview();
    expect(socialWorkspace().source).toBe('fixture');
    expect(screen.getByText(BANNER)).toBeTruthy();
  });

  it.each<[string, unknown]>([
    ['an empty Social bridge', {}],
    ['a non-function call', { call: 'workspace' }],
    ['a null Social bridge', null],
  ])('treats %s as absent: labelled fixture, no call attempted', async (_name, social) => {
    installBridge(social);
    expect(selectSocialWorkspace(window).source).toBe('fixture');
    mount();
    await overview();
    expect(screen.getByText(BANNER)).toBeTruthy();
  });

  it('chooses live for a structurally valid bridge, with no example banner', async () => {
    const stub = liveStub();
    expect(selectSocialWorkspace(window).source).toBe('live');
    mount();
    await overview();
    expect(socialWorkspace().source).toBe('live');
    expect(screen.queryByText(BANNER)).toBeNull();
    expect(stub.callsTo('workspace')).toHaveLength(1);
  });

  it('chooses once per window: a bridge appearing or disappearing later never switches the source', async () => {
    const first = socialWorkspace();
    expect(first.source).toBe('fixture');
    liveStub();
    expect(socialWorkspace()).toBe(first);
    resetSocialSessions();
    setSocialWorkspacePort(null);
    const live = socialWorkspace();
    expect(live.source).toBe('live');
    delete scope().hqServices;
    expect(socialWorkspace()).toBe(live);
  });

  it('shows the unreachable state for an unavailable live service and never falls back to the fixture', async () => {
    const call = vi.fn<SocialServiceTransport['call']>(async () => ({ ok: false, kind: 'unavailable' }) satisfies ServiceResponse);
    installBridge({ call });
    const { user } = mount();
    expect(await screen.findByText('The Social service is unreachable')).toBeTruthy();
    expect(screen.queryByText(BANNER)).toBeNull();
    expect(screen.queryByText('Larkspur Tea Co.')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('The Social service is unreachable')).toBeTruthy();
    expect(socialWorkspace().source).toBe('live');
    expect(call.mock.calls.map(([route]) => route)).toEqual(['workspace', 'workspace']);
    expect(screen.queryByText(BANNER)).toBeNull();
  });

  it('keeps the harness API: an injected port is labelled as the fixture unless marked live', async () => {
    const injected = createWorkbenchFixture().port;
    setSocialWorkspacePort(injected);
    expect(socialWorkspace()).toEqual({ port: injected, source: 'fixture' });
    setSocialWorkspacePort(injected, 'live');
    mount();
    await overview();
    expect(screen.queryByText(BANNER)).toBeNull();
  });

  it('live: navigation across every section and remounts make zero execution and zero writes', async () => {
    const stub = liveStub();
    const shell = mount();
    await overview();
    for (const destination of ['library', 'calendar', 'workbenches', 'workbenches/x-studio', 'runs', 'channels', 'sources', 'overview']) {
      shell.go(destination);
      await act(async () => {});
      shell.remount();
      await act(async () => {});
    }
    await overview();
    expect(within(screen.getByRole('complementary', { name: 'Social workspace' })).getByRole('button', { name: 'Overview' }).getAttribute('aria-current')).toBe('page');
    expect(stub.callsTo('submitRun')).toHaveLength(0);
    expect(stub.callsTo('saveContent')).toHaveLength(0);
    expect(stub.callsTo('addBrand')).toHaveLength(0);
    // The session's one snapshot survives every remount.
    expect(stub.callsTo('workspace')).toHaveLength(1);
    expect(stub.calls.every((call) => call.route === 'workspace' || call.route === 'run' || call.route === 'sample')).toBe(true);
  });
});
