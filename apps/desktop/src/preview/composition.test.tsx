import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { ModulePort } from '@hq/contracts';
import { createServiceDomains } from '../services/domains';
import { previewModules, seed, UNCONFIGURED, PREVIEW_PRESENTATION, PREVIEW_REFERENCE_PROVIDERS } from './composition';
import { ENTRIES } from './capabilities';
import { PreviewChrome } from './PreviewChrome';
import { PresentationShell } from '../PresentationShell';
import { createReferencePort } from '../references';
import { DEFAULT_STATE, navigationKey } from '../state';
import userEvent from '@testing-library/user-event';
import { resetWorkSessions, setWorkSessionPort } from '../../../../modules/work/nav';
import { resetSocialSessions } from '../../../../modules/social/core';

const props: ModulePort = { context: { id: 'preview-test', name: 'Synthetic preview' }, destination: 'home', appearance: 'light', desktop: { platform: 'browser', versions: { electron: null } }, navigate: vi.fn() };
afterEach(() => { cleanup(); resetWorkSessions(); setWorkSessionPort(null); resetSocialSessions(); window.localStorage.clear(); vi.restoreAllMocks(); });

it('renders example Work and Social without any global service bridge', async () => {
  expect(window.hqServices).toBeUndefined(); expect(window.hqDesktop).toBeUndefined();
  const modules = previewModules('default');
  render(<modules.work {...props} />);
  expect(await screen.findByText('Work: Sample data · not set up.')).toBeTruthy();
  expect((await seed('default').planner().snapshot()).items.length).toBeGreaterThan(0);
  cleanup(); render(<modules.social {...props} />);
  expect(await screen.findByText('Social: Sample data · not set up.')).toBeTruthy();
  expect(window.hqServices).toBeUndefined(); expect(window.hqDesktop).toBeUndefined();
  expect(await UNCONFIGURED.work.call()).toEqual({ ok: false, kind: 'unavailable' });
});

it('keeps missing production bridges unavailable', async () => {
  const { Work, Social } = createServiceDomains(() => undefined);
  render(<><Work {...props} /><Social {...props} /></>);
  expect(await screen.findByText('Work: Unavailable.')).toBeTruthy();
  expect(await screen.findByText('Social: Unavailable.')).toBeTruthy();
  expect(screen.queryByText(/Sample data/)).toBeNull();
});

it('uses an empty fixture and preserves independently seeded planner stores', async () => {
  const empty = seed('empty').planner(); const other = seed('empty').planner();
  expect((await empty.snapshot()).items).toEqual([]);
  await empty.create({ title: 'Synthetic new item', kind: 'idea', status: 'inbox' }, crypto.randomUUID());
  expect((await empty.snapshot()).items).toHaveLength(1);
  expect((await other.snapshot()).items).toEqual([]);
  const modules = previewModules('empty'); render(<modules.work {...props} />);
  expect(await screen.findByText('Work: Sample data · not set up.')).toBeTruthy();
  expect(ENTRIES.map(entry => entry.id)).toEqual(['default', 'empty']);
});

it('shows the revision, resets by reloading and shares the capability disclosure', () => {
  const reload = vi.spyOn(window.location, 'reload').mockImplementation(() => {});
  render(<PreviewChrome revision={'a'.repeat(40)} />);
  expect(screen.getByText('Preview · synthetic data · aaaaaaa')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Reset preview' }));
  expect(reload).toHaveBeenCalledTimes(1);
  expect(screen.getByText('work-example-create-edit')).toBeTruthy();
  expect(screen.getByText('persistence')).toBeTruthy();
});

it.each(['default', 'empty'] as const)('mounts the shared shell with %s fixtures and explicit native-only domains', async entry => {
  window.matchMedia = vi.fn().mockReturnValue({ matches: false, addEventListener() {}, removeEventListener() {} });
  window.localStorage.clear();
  window.localStorage.setItem(navigationKey('hq-local'), JSON.stringify({ ...DEFAULT_STATE, domain: 'work' }));
  render(<PresentationShell modules={previewModules(entry)} presentation={PREVIEW_PRESENTATION} referenceProviders={PREVIEW_REFERENCE_PROVIDERS} />);
  expect(await screen.findByText('Work: Sample data · not set up.')).toBeTruthy();
  const user = userEvent.setup();
  await user.type(await screen.findByRole('textbox', { name: 'Capture to Inbox' }), 'Preview created item{Enter}');
  const card = (await screen.findByText('Preview created item')).closest<HTMLElement>('[data-card-id]');
  expect(card).toBeTruthy();
  await user.click(card!);
  const title = await screen.findByRole('textbox', { name: 'Card title' });
  await user.clear(title); await user.type(title, 'Preview edited item'); await user.tab();
  expect(await screen.findByText('Preview edited item')).toBeTruthy();
  const rail = within(screen.getByRole('navigation', { name: 'Domains' }));
  fireEvent.click(rail.getByRole('button', { name: 'Design' }));
  expect(screen.getByRole('region', { name: 'Design unavailable' }).textContent).toContain('Open the desktop app');
  fireEvent.click(rail.getByRole('button', { name: 'Wiki' }));
  expect(screen.getByRole('region', { name: 'Wiki unavailable' }).textContent).toContain('Open the desktop app');
  fireEvent.click(rail.getByRole('button', { name: 'Social' }));
  expect(await screen.findByText('Social: Sample data · not set up.')).toBeTruthy();
  const social = within(screen.getByRole('complementary', { name: 'Social workspace' }));
  fireEvent.click(social.getByRole('button', { name: 'Calendar' }));
  expect(social.getByRole('button', { name: 'Calendar' }).getAttribute('aria-current')).toBe('page');
  fireEvent.click(screen.getByRole('button', { name: 'Appearance: System' }));
  expect(document.documentElement.dataset.theme).toBe('light');
  fireEvent.click(screen.getByRole('button', { name: 'Appearance: Light' }));
  expect(document.documentElement.dataset.theme).toBe('dark');
  const splitter = screen.getByRole('separator', { name: 'Primary navigation width' });
  fireEvent.keyDown(splitter, { key: 'Home' });
  expect(splitter.getAttribute('aria-valuenow')).toBe('64');
  fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
  expect(screen.getByRole('region', { name: 'Settings page' })).toBeTruthy();
  expect(screen.getAllByText('Service configuration is unavailable in this window.')).toHaveLength(2);
  expect(window.hqServices).toBeUndefined(); expect(window.hqDesktop).toBeUndefined();
});

it('keeps registered preview references unavailable without opening a fixture target', async () => {
  const open = vi.fn(); const notice = vi.fn();
  const references = createReferencePort(PREVIEW_REFERENCE_PROVIDERS, { projectId: () => 'hq-local', open, notice });
  expect(await references.find('', { projectId: 'hq-local', limit: 10 })).toEqual([]);
  for (const [domain, kind] of [['work', 'item'], ['social', 'draft'], ['design', 'version']] as const) {
    const envelope = { version: 1 as const, domain, kind, projectId: 'hq-local', entityId: 'synthetic', title: 'Synthetic reference', returnDestination: { domain, destination: 'home' } };
    expect((await references.resolve(envelope)).status).toBe('unavailable');
    references.open(envelope, { label: 'Work', to: { domain: 'work', destination: 'home' } });
    await vi.waitFor(() => expect(notice).toHaveBeenCalledWith({ title: 'Synthetic reference', message: 'unavailable. Snapshot is read-only.' }));
    notice.mockClear();
  }
  expect(open).not.toHaveBeenCalled();
  expect((await references.resolve({ version: 1, domain: 'work', kind: 'unregistered', projectId: 'hq-local', entityId: 'synthetic', title: 'Unknown', returnDestination: { domain: 'work', destination: 'home' } })).status).toBe('unknown');
});
