import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { toastStore } from '@hq/ui';
vi.mock('./modules', () => ({ designReferenceReads: { list: vi.fn(async () => { throw Error('Design unavailable in shell fixture'); }), read: vi.fn(async () => ({ status: 'unavailable' as const })) }, DOMAIN_LABELS: { design: 'Design', social: 'Social', work: 'Work', wiki: 'Wiki' }, MODULES: { design: ({ destination }: { destination: string }) => <div>Design stub<span data-testid="design-destination">{destination}</span></div>, wiki: () => <div>Wiki home stub</div>, work: () => <div>Work stub</div> }, MODULE_PRESENTATION: { design: 'fill' } }));
import { App } from './App';
import { selectDesktopProject } from './interactive-runtime';
import { DEFAULT_STATE, RAIL_KEY, navigationKey } from './state';
import { RECENT_PROJECTS_KEY } from './shell/recent-projects';

afterEach(() => { cleanup(); toastStore.dismiss(); });
function media(matching: readonly string[] = []) {
  window.matchMedia = vi.fn((query: string) => ({ matches: matching.includes(query), addEventListener() {}, removeEventListener() {} })) as never;
  window.localStorage.clear();
}

it('starts on the compact icon rail with the project, location and skip link in place', () => {
  media();
  render(<App />);
  const rail = screen.getByRole('complementary', { name: 'HQ navigation' });
  expect(rail.className).toContain('is-compact');
  expect(screen.getByRole('separator', { name: 'Primary navigation width' }).getAttribute('aria-valuenow')).toBe('64');
  const banner = within(screen.getByRole('banner', { name: 'HQ workspace' }));
  expect(banner.getByRole('button', { name: 'Project: Local projects' })).toBeTruthy();
  expect(banner.getByText('Design').getAttribute('aria-current')).toBe('location');
  fireEvent.click(screen.getByRole('link', { name: 'Skip to content' }));
  expect(document.activeElement?.id).toBe('hq-content');
  expect(document.activeElement?.contains(screen.getByRole('main'))).toBe(true);
});

it('keeps the rail compact in narrow windows without touching the saved width', () => {
  media(['(max-width: 999px)']);
  window.localStorage.setItem(RAIL_KEY, JSON.stringify({ width: 220, expanded: 220 }));
  render(<App />);
  expect(screen.getByRole('complementary', { name: 'HQ navigation' }).className).toContain('is-compact');
  expect(screen.queryByRole('separator', { name: 'Primary navigation width' })).toBeNull();
  expect(JSON.parse(window.localStorage.getItem(RAIL_KEY)!)).toEqual({ width: 220, expanded: 220 });
});

it('names the location and what the project means in each domain', () => {
  media();
  window.localStorage.setItem(navigationKey('hq-local'), JSON.stringify({ ...DEFAULT_STATE, domain: 'work', destinations: { ...DEFAULT_STATE.destinations, work: 'status-board' } }));
  render(<App />);
  const banner = within(screen.getByRole('banner', { name: 'HQ workspace' }));
  expect(banner.getByText('Status board').getAttribute('aria-current')).toBe('location');
  expect(banner.getByText('Work isn’t project-scoped')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
  expect(banner.getByText('Settings').getAttribute('aria-current')).toBe('location');
  expect(banner.queryByText('Status board')).toBeNull();
});

it('remembers opened projects and switches back only on an explicit pick', () => {
  media();
  render(<App />);
  act(() => selectDesktopProject({ id: 'synthetic-regular', label: 'Regular project' }));
  const trigger = screen.getByRole('button', { name: 'Project: Regular project' });
  expect(JSON.parse(window.localStorage.getItem(RECENT_PROJECTS_KEY)!)).toEqual([{ id: 'synthetic-regular', name: 'Regular project' }]);
  fireEvent.click(trigger);
  expect(screen.getAllByRole('menuitemradio').map(item => item.textContent)).toEqual(['Regular project', 'Local projects']);
  fireEvent.click(screen.getByRole('menuitemradio', { name: /Local projects/ }));
  expect(screen.getByRole('button', { name: 'Project: Local projects' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Project: Local projects' }));
  fireEvent.click(screen.getByRole('menuitem', { name: 'Browse Design projects…' }));
  expect(screen.getByTestId('design-destination').textContent).toBe('projects');
});

it('explains an appearance step that leaves the screen unchanged', () => {
  media();
  render(<App />);
  fireEvent.click(screen.getByRole('button', { name: 'Appearance: System' }));
  expect(document.documentElement.dataset.theme).toBe('light');
  expect(screen.getByRole('group', { name: 'Appearance: Light' })).toBeTruthy();
  expect(screen.getByText('Stays light when your system changes.')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Appearance: Light' }));
  expect(document.documentElement.dataset.theme).toBe('dark');
  expect(screen.queryByRole('group', { name: 'Appearance: Dark' })).toBeNull();
  fireEvent.click(within(screen.getByRole('radiogroup', { name: 'Appearance' })).getByRole('radio', { name: 'System' }));
  expect(document.documentElement.dataset.theme).toBe('light');
  expect(screen.queryByRole('group', { name: 'Appearance: System' })).toBeNull();
});
