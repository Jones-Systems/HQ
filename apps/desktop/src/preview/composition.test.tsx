import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { ModulePort } from '@hq/contracts';
import { createServiceDomains } from '../services/domains';
import { previewModules, seed, UNCONFIGURED } from './composition';
import { ENTRIES } from './capabilities';
import { PreviewChrome } from './PreviewChrome';

const props: ModulePort = { context: { id: 'preview-test', name: 'Synthetic preview' }, destination: 'home', appearance: 'light', desktop: { platform: 'browser', versions: { electron: null } }, navigate: vi.fn() };
afterEach(cleanup);

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

it('shows the revision, reset control and shared capability disclosure', () => {
  render(<PreviewChrome revision={'a'.repeat(40)} />);
  expect(screen.getByText('Preview · synthetic data · aaaaaaa')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Reset preview' })).toBeTruthy();
  expect(screen.getByText('work-example-create-edit')).toBeTruthy();
  expect(screen.getByText('persistence')).toBeTruthy();
});
