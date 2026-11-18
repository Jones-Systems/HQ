import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { ModulePort } from '@hq/contracts';
import { createServiceDomains } from '../services/domains';
import { findServiceStatus } from '../services/test-support';
import { previewModules, seed, UNCONFIGURED, PREVIEW_PRESENTATION, PREVIEW_REFERENCE_PROVIDERS } from './composition';
import { ENTRIES } from './capabilities';
import { PreviewChrome } from './PreviewChrome';
import { PresentationShell } from '../PresentationShell';
import { createReferencePort } from '../references';
import { DEFAULT_STATE, navigationKey } from '../state';
import userEvent from '@testing-library/user-event';
import { resetWorkSessions, setWorkSessionPort } from '../../../../modules/work/nav';
import { FIXTURE_IDS, FIXTURE_WORK_ITEM_ID, resetSocialSessions, type SocialWorkspacePort } from '../../../../modules/social/core';

const props: ModulePort = { context: { id: 'preview-test', name: 'Synthetic preview' }, destination: 'home', appearance: 'light', desktop: { platform: 'browser', versions: { electron: null } }, navigate: vi.fn() };
afterEach(() => { cleanup(); resetWorkSessions(); setWorkSessionPort(null); resetSocialSessions(); window.localStorage.clear(); vi.restoreAllMocks(); });

it('renders example Work and Social without any global service bridge', async () => {
  expect(window.hqServices).toBeUndefined(); expect(window.hqDesktop).toBeUndefined();
  const modules = previewModules('default');
  render(<modules.work {...props} />);
  expect(await findServiceStatus('Work', 'Sample data')).toBeTruthy();
  expect((await seed('default').planner().snapshot()).items.length).toBeGreaterThan(0);
  cleanup(); render(<modules.social {...props} />);
  expect(await findServiceStatus('Social', 'Sample data')).toBeTruthy();
  expect(window.hqServices).toBeUndefined(); expect(window.hqDesktop).toBeUndefined();
  expect(await UNCONFIGURED.work.call()).toEqual({ ok: false, kind: 'unavailable' });
});

it('keeps missing production bridges unavailable', async () => {
  const { Work, Social } = createServiceDomains(() => undefined);
  render(<><Work {...props} /><Social {...props} /></>);
  expect(await findServiceStatus('Work', 'Unavailable')).toBeTruthy();
  expect(await findServiceStatus('Social', 'Unavailable')).toBeTruthy();
  expect(screen.queryByText(/Sample data/)).toBeNull();
});

it('uses an empty fixture and preserves independently seeded planner stores', async () => {
  const empty = seed('empty').planner(); const other = seed('empty').planner();
  expect((await empty.snapshot()).items).toEqual([]);
  await empty.create({ title: 'Synthetic new item', kind: 'idea', status: 'inbox' }, crypto.randomUUID());
  expect((await empty.snapshot()).items).toHaveLength(1);
  expect((await other.snapshot()).items).toEqual([]);
  const modules = previewModules('empty'); render(<modules.work {...props} />);
  expect(await findServiceStatus('Work', 'Sample data')).toBeTruthy();
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
  expect(await findServiceStatus('Work', 'Sample data')).toBeTruthy();
  const user = userEvent.setup();
  await user.type(await screen.findByRole('textbox', { name: 'Capture to Inbox' }), 'Preview created item{Enter}');
  const card = (await screen.findByText('Preview created item')).closest<HTMLElement>('[data-card-id]');
  expect(card).toBeTruthy();
  await user.click(card!);
  const title = await screen.findByRole('textbox', { name: 'Card title' });
  await user.clear(title); await user.type(title, 'Preview edited item'); await user.tab();
  expect(await screen.findByRole('article', { name: 'Preview edited item' })).toBeTruthy();
  expect(title).toHaveProperty('value', 'Preview edited item');
  const rail = within(screen.getByRole('navigation', { name: 'Domains' }));
  fireEvent.click(rail.getByRole('button', { name: 'Design' }));
  expect(screen.getByRole('region', { name: 'Design unavailable' }).textContent).toContain('Open the desktop app');
  fireEvent.click(rail.getByRole('button', { name: 'Wiki' }));
  expect(screen.getByRole('region', { name: 'Wiki unavailable' }).textContent).toContain('Open the desktop app');
  fireEvent.click(rail.getByRole('button', { name: 'Social' }));
  expect(await findServiceStatus('Social', 'Sample data')).toBeTruthy();
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
  fireEvent.click(screen.getByRole('button', { name: 'Social & Work' }));
  expect(screen.getAllByText('Service configuration is unavailable in this window.').length).toBeGreaterThanOrEqual(1);
  for (const name of ['Social', 'Work']) {
    const button = screen.getByRole('button', { name: `Check connection for ${name}` });
    expect(button.getAttribute('aria-disabled')).toBe('true');
    expect(button.getAttribute('aria-describedby')).toBeTruthy();
  }
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

it('opens the Social example in the project it is shown in, so its sample links are not read as another project', async () => {
  const social = vi.fn((projectId: string) => seed('default').social(projectId));
  const { Social } = createServiceDomains(() => UNCONFIGURED, { social });
  render(<Social {...props} destination={`library/${FIXTURE_IDS.steepingThread}`} />);
  expect(await screen.findByDisplayValue('Steeping times thread')).toBeTruthy();
  expect(social).toHaveBeenCalledWith('preview-test');
  const port = social.mock.results[0]!.value as SocialWorkspacePort;
  const draft = (await port.snapshot()).content.find((item) => item.id === FIXTURE_IDS.steepingThread)!;
  expect(draft.links?.map((link) => [link.domain, link.projectId, link.entityId])).toEqual([
    ['social', 'preview-test', FIXTURE_IDS.exampleRun], ['work', 'preview-test', FIXTURE_WORK_ITEM_ID],
  ]);
  expect(screen.queryByText(/Another project: links are read-only/u)).toBeNull();
});
