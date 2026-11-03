import { useState } from 'react';
import { act, cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ModulePort } from '@hq/contracts';
import {
  FEATURE_HQ_BRAND_PROJECT, FEATURE_HQ_REFERENCES, FIXTURE_IDS, FIXTURE_OTHER_PROJECT_ID, FIXTURE_PROJECT_ID,
  recordCalls, resetSocialSessions, socialSession, type FixtureOptions, type RecordedPort,
} from '../../core';
import { createWorkbenchFixture, type WorkbenchFixture } from '../../workbench/fixtures/examples';
import { ACCOUNT_CHANNELS, NAV_ITEMS, PUBLISHING_NEEDS, SOURCES_PROPOSED, SWITCH_PROJECT_REASON, SocialDomain, parseSocialDestination } from '..';

const NOW = () => new Date('2026-10-20T12:00:00Z');
const CONTEXT = { id: FIXTURE_PROJECT_ID, name: 'Larkspur project' };

afterEach(() => {
  cleanup();
  resetSocialSessions();
  localStorage.removeItem('hq.social.sidebar.v1');
});

interface Setup {
  readonly fixture: WorkbenchFixture;
  readonly recorded: RecordedPort;
  readonly navigate: ReturnType<typeof vi.fn<(destination: string) => void>>;
  readonly user: ReturnType<typeof userEvent.setup>;
  readonly destination: () => string;
  readonly remount: () => void;
}

function setup({ destination = 'home', features, delay }: { destination?: string; features?: string[]; delay?: FixtureOptions['delay'] } = {}): Setup {
  const fixture = createWorkbenchFixture({ ...(features ? { features } : {}), ...(delay ? { delay } : {}), clock: NOW });
  const recorded = recordCalls(fixture.port);
  const navigate = vi.fn<(destination: string) => void>();
  let current = destination;
  let bump: () => void = () => {};
  function Shell() {
    const [where, setWhere] = useState(destination);
    const [generation, setGeneration] = useState(0);
    current = where;
    bump = () => act(() => setGeneration((value) => value + 1));
    const port: ModulePort = {
      context: CONTEXT, destination: where, appearance: 'light', desktop: { platform: 'browser', versions: { electron: null } },
      navigate: (next) => { navigate(next); setWhere(next); },
    };
    // A new key remounts the domain, as the shell does on every domain switch.
    return <SocialDomain key={generation} {...port} port={recorded.port} example now={NOW} />;
  }
  render(<Shell />);
  return { fixture, recorded, navigate, user: userEvent.setup(), destination: () => current, remount: () => bump() };
}

const side = () => within(screen.getByRole('complementary', { name: 'Social workspace' }));
const overview = () => screen.findByRole('heading', { level: 1, name: 'Overview' });
/** Calls with an effect: any execution, and any content-class write (everything but the snapshot read). */
const effects = (s: Setup) => s.recorded.calls().filter((call) => call.class === 'execution' || (call.class === 'content' && call.method !== 'snapshot'));

describe('destinations', () => {
  it('parses every reconciled Social destination and rejects others', () => {
    expect(parseSocialDestination('home')).toStrictEqual({ section: 'overview' });
    expect(parseSocialDestination('overview')).toStrictEqual({ section: 'overview' });
    expect(parseSocialDestination('sources')).toStrictEqual({ section: 'sources' });
    expect(parseSocialDestination('sources/fixture-source')).toStrictEqual({ section: 'sources', sourceId: 'fixture-source' });
    expect(parseSocialDestination('workbenches')).toStrictEqual({ section: 'workbenches' });
    expect(parseSocialDestination('workbenches/x-studio')).toStrictEqual({ section: 'workbenches' });
    expect(parseSocialDestination(`runs/${FIXTURE_IDS.failedRun}`)).toStrictEqual({ section: 'runs' });
    expect(parseSocialDestination(`library/${FIXTURE_IDS.autumnBlend}`)).toStrictEqual({ section: 'library' });
    expect(parseSocialDestination('library/new')).toStrictEqual({ section: 'library' });
    expect(parseSocialDestination('calendar/2026-11')).toStrictEqual({ section: 'calendar' });
    expect(parseSocialDestination('channels')).toStrictEqual({ section: 'channels' });
    for (const bad of ['brands', 'workbenches/unknown-tool', 'calendar?month=2026-11', 'sources/a/b', 'channels/x', '']) {
      expect(parseSocialDestination(bad)).toBeNull();
    }
  });
});

describe('secondary navigation', () => {
  it('collapses fully, restores its last size, and retains the preference across remounts without content effects', async () => {
    const s = setup();
    await overview();
    const splitter = screen.getByRole('separator', { name: 'Social sidebar' });
    splitter.focus();
    await s.user.keyboard('{End}{Home}');
    expect(splitter.getAttribute('aria-valuenow')).toBe('0');
    expect(screen.queryByRole('complementary', { name: 'Social workspace' })).toBeNull();
    expect(screen.getByRole('separator', { name: 'Social sidebar' })).toBeTruthy();
    s.remount();
    const restoredSplitter = screen.getByRole('separator', { name: 'Social sidebar' });
    expect(restoredSplitter.getAttribute('aria-valuenow')).toBe('0');
    restoredSplitter.focus();
    await s.user.keyboard('{Enter}');
    expect(restoredSplitter.getAttribute('aria-valuenow')).toBe('320');
    expect(side().getByRole('button', { name: 'Overview' })).toBeTruthy();
    expect(s.navigate).not.toHaveBeenCalled();
    expect(effects(s)).toHaveLength(0);
  });

  it('opens the collapsed sidebar with an arrow key and ignores invalid stored widths', async () => {
    localStorage.setItem('hq.social.sidebar.v1', '{"width":-1,"restored":9999}');
    const s = setup();
    await overview();
    const splitter = screen.getByRole('separator', { name: 'Social sidebar' });
    expect(splitter.getAttribute('aria-valuenow')).toBe('216');
    splitter.focus();
    await s.user.keyboard('{Home}{ArrowRight}');
    expect(Number(splitter.getAttribute('aria-valuenow'))).toBeGreaterThan(0);
    expect(side().getByRole('button', { name: 'Overview' })).toBeTruthy();
    expect(effects(s)).toHaveLength(0);
  });

  it('lists the T3 pages in order, with Sources proposed and Channels & accounts under Later', async () => {
    setup();
    await overview();
    const nav = within(screen.getByRole('navigation', { name: 'Social' }));
    const names = nav.getAllByRole('button').map((button) => button.textContent);
    expect(names).toStrictEqual(['Overview', 'SourcesProposed', 'Workbenches', 'Library', 'Calendar', 'Run history', 'Channels & accounts']);
    expect(within(nav.getByRole('group', { name: 'Later' })).getByRole('button').textContent).toBe('Channels & accounts');
    expect(NAV_ITEMS.map((item) => item.destination)).toStrictEqual(['overview', 'sources', 'workbenches', 'library', 'calendar', 'runs', 'channels']);
    expect(nav.getByRole('button', { name: 'Overview' }).getAttribute('aria-current')).toBe('page');
  });

  it('marks the current section and returns each section to its last destination', async () => {
    const s = setup({ destination: `library/${FIXTURE_IDS.autumnBlend}` });
    await screen.findByLabelText('Body');
    expect(side().getByRole('button', { name: 'Library' }).getAttribute('aria-current')).toBe('page');
    await s.user.click(side().getByRole('button', { name: 'Run history' }));
    expect(s.destination()).toBe('runs');
    expect(await screen.findByRole('heading', { level: 1, name: 'Run history' })).toBeTruthy();
    await s.user.click(side().getByRole('button', { name: 'Library' }));
    expect(s.destination()).toBe(`library/${FIXTURE_IDS.autumnBlend}`);
    // The current section's own item goes to its landing view.
    await s.user.click(side().getByRole('button', { name: 'Library' }));
    expect(s.destination()).toBe('library');
    expect(s.recorded.callsOf('execution')).toHaveLength(0);
  });

  it('shows an honest page for an unknown destination without changing anything', async () => {
    const s = setup({ destination: 'brands' });
    expect(screen.getByText("This Social page doesn't exist")).toBeTruthy();
    await s.user.click(screen.getByRole('button', { name: 'Open overview' }));
    expect(s.destination()).toBe('overview');
    expect(effects(s)).toHaveLength(0);
  });

  it('opens a draft from Overview by navigating only, and marks Library current', async () => {
    const s = setup();
    await overview();
    await s.user.click(screen.getByRole('button', { name: /^Autumn blend tasting notes/u }));
    expect(s.destination()).toBe(`library/${FIXTURE_IDS.autumnBlend}`);
    expect(await screen.findByRole('heading', { name: 'Edit draft' })).toBeTruthy();
    expect(side().getByRole('button', { name: 'Library' }).getAttribute('aria-current')).toBe('page');
    expect(effects(s)).toHaveLength(0);
  });
});

describe('brand switcher', () => {
  it('scopes Overview, Library and Calendar to the chosen brand and survives a remount', async () => {
    const s = setup();
    await overview();
    await s.user.selectOptions(side().getByLabelText('Brand'), FIXTURE_IDS.harbor);
    expect(screen.getByText('Harbor Lane Bakery', { selector: '.sd-page-head p' })).toBeTruthy();
    const comingUp = within(screen.getByRole('region', { name: 'Coming up' }));
    expect(comingUp.getByText('Sourdough starter open day')).toBeTruthy();
    expect(comingUp.queryByText('Autumn blend tasting notes')).toBeNull();

    const view = socialSession(CONTEXT.id).getState().view;
    expect((view.library as { brand: string }).brand).toBe(FIXTURE_IDS.harbor);
    expect(view.calendarBrand).toBe(FIXTURE_IDS.harbor);

    s.remount();
    await overview();
    expect((side().getByLabelText('Brand') as HTMLSelectElement).value).toBe(FIXTURE_IDS.harbor);
    expect(effects(s)).toHaveLength(0);
  });

  it('manages brands from the switcher in a dialog', async () => {
    const s = setup();
    await overview();
    await s.user.click(side().getByRole('button', { name: 'Manage brands' }));
    const dialog = within(screen.getByRole('dialog', { name: 'Manage brands' }));
    expect(dialog.getByRole('heading', { name: 'Brands' })).toBeTruthy();
    expect(dialog.getByText('My workspace')).toBeTruthy();
    expect(s.recorded.callsOf('execution')).toHaveLength(0);
  });
});

describe('brand ↔ HQ project (proposed)', () => {
  const linked = [FEATURE_HQ_REFERENCES, FEATURE_HQ_BRAND_PROJECT];

  it('shows a mismatch banner that never switches project and keeps Switch HQ project disabled with its reason', async () => {
    const s = setup({ features: linked });
    await overview();
    expect(screen.queryByRole('region', { name: /belongs to a different HQ project/u })).toBeNull();

    await s.user.selectOptions(side().getByLabelText('Brand'), FIXTURE_IDS.harbor);
    const banner = within(screen.getByRole('region', { name: 'Harbor Lane Bakery belongs to a different HQ project' }));
    expect(banner.getByText(new RegExp(`names “${FIXTURE_OTHER_PROJECT_ID}”, but HQ is showing Larkspur project`, 'u'))).toBeTruthy();
    expect(banner.getByText(/HQ has not switched projects, and nothing about this link is saved in HQ\./u)).toBeTruthy();
    const button = banner.getByRole('button', { name: 'Switch HQ project' }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(button.getAttribute('aria-describedby')).toBeTruthy();
    expect(document.getElementById(button.getAttribute('aria-describedby')!)!.textContent).toBe(SWITCH_PROJECT_REASON);
    await s.user.click(button);
    expect(side().getByText('Proposed link to a different HQ project. HQ did not switch.')).toBeTruthy();

    await s.user.selectOptions(side().getByLabelText('Brand'), FIXTURE_IDS.larkspur);
    expect(screen.queryByRole('button', { name: 'Switch HQ project' })).toBeNull();
    expect(side().getByText('Proposed link to this HQ project. Not a saved HQ mapping.')).toBeTruthy();
    await s.user.selectOptions(side().getByLabelText('Brand'), 'default');
    expect(side().getByText('Not linked to an HQ project.')).toBeTruthy();

    expect(s.navigate).not.toHaveBeenCalled();
    expect(effects(s)).toHaveLength(0);
  });

  it('says the link is unsupported, with no banner, when the service lacks hq-brand-project-v1', async () => {
    const s = setup();
    await overview();
    await s.user.selectOptions(side().getByLabelText('Brand'), FIXTURE_IDS.harbor);
    expect(side().getByText('HQ project link: proposed, needs Social service support (hq-brand-project-v1).')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Switch HQ project' })).toBeNull();
  });
});

describe('Overview', () => {
  it('shows the capability strip and the delivered limits', async () => {
    setup();
    await overview();
    const strip = within(screen.getByRole('region', { name: 'What Social can do here' }));
    for (const text of ['Analysis', 'Drafts & calendar', 'Live collection', 'Accounts & posting']) expect(strip.getByText(text)).toBeTruthy();
    expect(strip.getAllByText('Not available')).toHaveLength(2);
    expect(strip.getByRole('note').textContent).toBe('Delivered limits No account connection, posting, live collection or scheduling. Workbenches analyze only the material you supply, offline.');
  });

  it('lists coming up, needs attention, recent research and links across HQ, each with its freshness', async () => {
    const s = setup();
    await overview();
    for (const name of ['Coming up', 'Needs attention', 'Recent research', 'Linked across HQ']) {
      expect(within(screen.getByRole('region', { name })).getByText(/^As of /u)).toBeTruthy();
    }
    const comingUp = within(screen.getByRole('region', { name: 'Coming up' }));
    expect(comingUp.getAllByRole('button').map((button) => button.querySelector('strong')?.textContent)).toStrictEqual(['Autumn blend tasting notes', 'Sourdough starter open day']);

    const attention = within(screen.getByRole('region', { name: 'Needs attention' }));
    expect(attention.getByText('Failed')).toBeTruthy();
    expect(attention.getByText('Interrupted')).toBeTruthy();
    expect(attention.getByText(/the source registry is proposed/u)).toBeTruthy();

    const recent = within(screen.getByRole('region', { name: 'Recent research' }));
    expect(recent.getAllByRole('listitem')).toHaveLength(5);
    expect(recent.getByText('Example data')).toBeTruthy();

    const links = within(screen.getByRole('region', { name: 'Linked across HQ' }));
    expect(links.getByText('Plan the cupping hour')).toBeTruthy();
    expect(links.getAllByText('Not checked')).toHaveLength(2);
    await s.user.click(links.getByRole('button', { name: 'Open run' }));
    expect(s.destination()).toBe(`runs/${FIXTURE_IDS.exampleRun}`);
    expect(effects(s)).toHaveLength(0);
  });

  it('lists unsaved drafts from this session under Needs attention', async () => {
    const s = setup({ destination: `library/${FIXTURE_IDS.steepingThread}` });
    await s.user.type(await screen.findByLabelText('Body'), ' 2/ Taste at two minutes.');
    await s.user.click(side().getByRole('button', { name: 'Overview' }));
    const attention = within(await screen.findByRole('region', { name: 'Needs attention' }));
    expect(attention.getByText('Steeping times thread')).toBeTruthy();
    expect(attention.getByText('Unsaved changes')).toBeTruthy();
    expect(effects(s)).toHaveLength(0);
  });

  it('opens an unsaved Start draft from Needs attention at its run receipt, not a missing page', async () => {
    socialSession(FIXTURE_PROJECT_ID).openEditor(`workbench-run:${FIXTURE_IDS.exampleRun}`, null, {
      title: 'Draft from a run', body: 'Half-written', brand_id: FIXTURE_IDS.larkspur, channel: 'General', planned_date: '', archived: 0,
    });
    const s = setup();
    await overview();
    const attention = within(screen.getByRole('region', { name: 'Needs attention' }));
    await s.user.click(attention.getByRole('button', { name: /^Draft from a run/u }));
    expect(s.destination()).toBe(`runs/${FIXTURE_IDS.exampleRun}`);
    expect(screen.queryByText("This Social page doesn't exist")).toBeNull();
    expect(effects(s)).toHaveLength(0);
  });

  it('shows Offline with the last synced time and Unknown for active runs when the service is unreachable', async () => {
    const s = setup();
    await overview();
    s.fixture.controls.setUnavailable(true);
    await act(() => socialSession(CONTEXT.id).load(s.recorded.port));
    expect(screen.getByText(/The Social service is unreachable\. Showing the last synced data\./u)).toBeTruthy();
    expect(screen.getAllByText('Offline').length).toBe(4);
    const attention = within(screen.getByRole('region', { name: 'Needs attention' }));
    expect(attention.getAllByText('Unknown')).toHaveLength(2);
    expect(attention.getAllByText(/don't start it again until its status is known/u)).toHaveLength(2);
    s.fixture.controls.setUnavailable(false);
    await s.user.click(screen.getByRole('button', { name: 'Check again' }));
    expect(await screen.findAllByText(/^As of /u)).toHaveLength(4);
    expect(s.recorded.callsOf('execution')).toHaveLength(0);
  });

  it('says links need Social service support when hq-references-v1 is absent', async () => {
    setup({ features: [] });
    await overview();
    const links = within(screen.getByRole('region', { name: 'Linked across HQ' }));
    expect(links.getByText('Not available')).toBeTruthy();
    expect(links.getByText(/needs Social service support \(hq-references-v1\)/u)).toBeTruthy();
  });

  it('shows loading, then an error with Try again, before any snapshot', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const s = setup({ delay: () => gate });
    expect(screen.getByText('Loading the Social workspace…')).toBeTruthy();
    s.fixture.controls.failNext('snapshot', { kind: 'unavailable' });
    await act(async () => release());
    expect(await screen.findByText('The Social service is unreachable')).toBeTruthy();
    await s.user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await overview()).toBeTruthy();
  });
});

describe('Sources (reserved)', () => {
  it('says it is proposed and needs the source registry, and is not built on fixtures', async () => {
    const s = setup({ destination: 'sources/fixture-source' });
    expect(screen.getByRole('heading', { level: 1, name: 'Sources' })).toBeTruthy();
    expect(screen.getByText(SOURCES_PROPOSED)).toBeTruthy();
    expect(SOURCES_PROPOSED.startsWith('Proposed — needs the Social service source registry')).toBe(true);
    expect(screen.getByText(/The source “fixture-source” can't be shown: there is no source registry yet\./u)).toBeTruthy();
    expect(screen.queryByRole('table')).toBeNull();
    await s.user.click(screen.getByRole('button', { name: 'Open workbenches' }));
    expect(s.destination()).toBe('workbenches');
    expect(effects(s)).toHaveLength(0);
  });
});

describe('Channels & accounts', () => {
  it('is an honest capability page whose controls have no external effect', async () => {
    const s = setup({ destination: 'channels' });
    expect(screen.getByRole('heading', { level: 1, name: 'Channels & accounts' })).toBeTruthy();
    for (const channel of ACCOUNT_CHANNELS) expect(screen.getByRole('heading', { level: 2, name: channel })).toBeTruthy();
    expect(screen.getAllByText('Planned')).toHaveLength(ACCOUNT_CHANNELS.length * 3);
    for (const item of PUBLISHING_NEEDS) expect(screen.getByText(item)).toBeTruthy();

    const connect = screen.getAllByRole('button', { name: 'Connect account…' });
    expect(connect).toHaveLength(ACCOUNT_CHANNELS.length);
    for (const button of connect) expect(button.getAttribute('aria-disabled')).toBe('true');
    await s.user.click(connect[0]!);
    expect(screen.getByRole('status').textContent).toBe("Nothing changed. Connecting X accounts isn't available in HQ.");
    expect(s.destination()).toBe('channels');
    expect(effects(s)).toHaveLength(0);

    // Honesty copy: nothing reads as connected, posted, published, scheduled or live.
    const text = document.querySelector('.sd-page')!.textContent!;
    expect(text).not.toMatch(/\b(connected|posted|published|scheduled|live)\b/iu);
  });
});

describe('mounted sections', () => {
  it('mounts the workbench section, with its limits banner, for workbench and run destinations', async () => {
    setup({ destination: 'workbenches' });
    expect(await screen.findByRole('heading', { level: 1, name: 'Workbenches' })).toBeTruthy();
    expect(screen.getByText('Delivered limits')).toBeTruthy();
    cleanup();
    resetSocialSessions();
    setup({ destination: 'runs' });
    expect(await screen.findByRole('heading', { level: 1, name: 'Run history' })).toBeTruthy();
  });

  it('mounts the content section for library and calendar destinations', async () => {
    setup({ destination: 'calendar/2026-10' });
    expect(await screen.findByRole('heading', { level: 2, name: 'October 2026' })).toBeTruthy();
    expect(screen.getByRole('heading', { level: 1, name: 'Calendar' })).toBeTruthy();
  });
});
