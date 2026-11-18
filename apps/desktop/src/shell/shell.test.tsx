import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { HqServices } from '@hq/contracts/services';
import type { Appearance } from '@hq/contracts';
import { DataSourcesProvider } from '../settings/DataSources';
import { AppearanceControl } from './AppearanceControl';
import { PROJECT_SCOPE, ProjectSwitcher } from './ProjectSwitcher';
import { Rail } from './Rail';
import { SourcesStatus } from './SourcesStatus';
import { destinationLabel } from './TopBar';

const original = window.hqServices;
afterEach(() => { cleanup(); Object.defineProperty(window, 'hqServices', { configurable: true, value: original }); });
function services() {
  const value = {
    config: { status: vi.fn(async () => ({ configured: true, policy: 'ok', transport: 'https' })), set: vi.fn() },
    social: { call: vi.fn() }, work: { call: vi.fn() },
    wiki: { indexStatus: vi.fn(async () => ({ ok: false })) },
  };
  Object.defineProperty(window, 'hqServices', { configurable: true, value: value as unknown as HqServices });
  return value;
}

it('summarises every source on one top-bar button, shows the worst shape and opens rows without probing', async () => {
  const value = services(); const manage = vi.fn();
  render(<DataSourcesProvider><SourcesStatus onManage={manage} /></DataSourcesProvider>);
  const trigger = await screen.findByRole('button', { name: 'Data sources: Social: Set up · not checked; Work: Set up · not checked; Local Wiki: Index unavailable' });
  expect(trigger.querySelector('.hq-status--warning')).toBeTruthy();
  expect(trigger.getAttribute('aria-expanded')).toBe('false');
  fireEvent.click(trigger);
  expect(trigger.getAttribute('aria-expanded')).toBe('true');
  const row = screen.getByRole('button', { name: 'Social: Set up · not checked' });
  expect(document.activeElement).toBe(row);
  expect(screen.getByRole('region', { name: 'Data sources' }).closest('[data-hq-overlay="open"]')).toBeTruthy();
  fireEvent.click(row);
  expect(manage).toHaveBeenCalledWith('social', trigger);
  expect(trigger.getAttribute('aria-expanded')).toBe('false');
  expect(value.social.call).not.toHaveBeenCalled(); expect(value.work.call).not.toHaveBeenCalled();
});

it('closes the sources popover with Escape and returns focus to its button', async () => {
  services(); const manage = vi.fn();
  render(<DataSourcesProvider><SourcesStatus onManage={manage} /></DataSourcesProvider>);
  const trigger = await screen.findByRole('button', { name: /^Data sources: / });
  fireEvent.click(trigger);
  fireEvent.keyDown(screen.getByRole('button', { name: /^Recheck Social/ }), { key: 'Escape' });
  expect(trigger.getAttribute('aria-expanded')).toBe('false');
  expect(document.activeElement).toBe(trigger);
  fireEvent.click(trigger);
  fireEvent.click(screen.getByRole('button', { name: 'Manage in Settings' }));
  expect(manage).toHaveBeenCalledWith(null, trigger);
});

it('lists the current, recent and fallback projects once, switches only on an explicit pick and says what each domain follows', () => {
  const select = vi.fn(); const browse = vi.fn();
  const view = render(<ProjectSwitcher current={{ id: 'larkspur', name: 'Larkspur Tea Co.' }} domain="work" onSelect={select} onBrowse={browse}
    recent={[{ id: 'larkspur', name: 'Larkspur Tea Co.' }, { id: 'atlas', name: 'Atlas Week' }]} fallback={{ id: 'hq-local', name: 'Local projects' }} />);
  expect(screen.getByText('Work isn’t project-scoped')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Project: Larkspur Tea Co.' }));
  const menu = screen.getByRole('menu');
  expect(menu.getAttribute('data-hq-overlay')).toBe('open');
  expect(within(menu).getAllByRole('menuitemradio').map(item => [item.textContent, item.getAttribute('aria-checked')]))
    .toEqual([['Larkspur Tea Co.', 'true'], ['Atlas Week', 'false'], ['Local projects', 'false']]);
  fireEvent.click(within(menu).getByRole('menuitemradio', { name: /Larkspur/ }));
  expect(select).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Project: Larkspur Tea Co.' }));
  fireEvent.click(screen.getByRole('menuitemradio', { name: /Atlas Week/ }));
  expect(select).toHaveBeenCalledWith({ id: 'atlas', name: 'Atlas Week' });
  fireEvent.click(screen.getByRole('button', { name: 'Project: Larkspur Tea Co.' }));
  fireEvent.click(screen.getByRole('menuitem', { name: 'Browse Design projects…' }));
  expect(browse).toHaveBeenCalledOnce();
  view.rerender(<ProjectSwitcher current={{ id: 'larkspur', name: 'Larkspur Tea Co.' }} domain="design" onSelect={select} onBrowse={browse} recent={[]} fallback={{ id: 'hq-local', name: 'Local projects' }} />);
  for (const note of Object.values(PROJECT_SCOPE)) if (note) expect(screen.queryByText(note)).toBeNull();
});

it('makes the domains one tab stop with arrow-key movement and marks Settings when it is open', () => {
  const navigate = vi.fn(); const settings = vi.fn();
  const view = render(<Rail current="work" settingsOpen={false} compact onNavigate={navigate} onOpenSettings={settings} />);
  const nav = within(screen.getByRole('navigation', { name: 'Domains' }));
  expect(nav.getAllByRole('button').filter(button => button.tabIndex === 0).map(button => button.textContent)).toEqual(['Work']);
  expect(nav.getByRole('button', { name: 'Work' }).getAttribute('aria-current')).toBe('page');
  nav.getByRole('button', { name: 'Work' }).focus();
  fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' });
  expect(document.activeElement).toBe(nav.getByRole('button', { name: 'Wiki' }));
  fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' });
  expect(document.activeElement).toBe(nav.getByRole('button', { name: 'Design' }));
  fireEvent.keyDown(document.activeElement!, { key: 'End' });
  expect(document.activeElement).toBe(nav.getByRole('button', { name: 'Wiki' }));
  expect(navigate).not.toHaveBeenCalled();
  fireEvent.click(document.activeElement!);
  expect(navigate).toHaveBeenCalledWith('wiki');
  const opener = screen.getByRole('button', { name: 'Settings' });
  fireEvent.click(opener);
  expect(settings).toHaveBeenCalledWith(opener);
  view.rerender(<Rail current="work" settingsOpen compact onNavigate={navigate} onOpenSettings={settings} />);
  expect(screen.getByRole('button', { name: 'Settings' }).getAttribute('aria-current')).toBe('page');
  expect(nav.getByRole('button', { name: 'Work' }).getAttribute('aria-current')).toBeNull();
});

it('offers every appearance as a radio with arrow keys, and a stepping button for compact windows', () => {
  const change = vi.fn<(next: Appearance, cycled: boolean) => void>();
  render(<AppearanceControl appearance="light" onChange={change} />);
  const group = screen.getByRole('radiogroup', { name: 'Appearance' });
  expect(within(group).getAllByRole('radio').map(radio => [radio.getAttribute('aria-label'), radio.getAttribute('aria-checked'), radio.tabIndex]))
    .toEqual([['Light', 'true', 0], ['Dark', 'false', -1], ['System', 'false', -1]]);
  fireEvent.keyDown(within(group).getByRole('radio', { name: 'Light' }), { key: 'ArrowLeft' });
  expect(change).toHaveBeenLastCalledWith('system', false);
  fireEvent.click(screen.getByRole('button', { name: 'Appearance: Light' }));
  expect(change).toHaveBeenLastCalledWith('dark', true);
});

it('names a destination for the location crumb and hides home', () => {
  expect(destinationLabel('home')).toBeNull();
  expect(destinationLabel('status-board')).toBe('Status board');
  expect(destinationLabel('cards/42?view=detail')).toBe('Cards');
  expect(destinationLabel('')).toBeNull();
});
