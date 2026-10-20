import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { HqServices } from '@hq/contracts/services';
vi.mock('./modules', () => ({ DOMAIN_LABELS: { design: 'Design', social: 'Social', work: 'Work', wiki: 'Wiki' }, MODULES: { design: () => <div>Design stub</div>, wiki: () => <div>Wiki home stub</div> }, MODULE_PRESENTATION: {} }));
import { App } from './App';
afterEach(() => { cleanup(); delete (window as { hqServices?: HqServices }).hqServices; });
it('keeps settings accessible without a bridge and reads only sanitized configuration before explicit recheck', async () => {
  window.matchMedia = vi.fn().mockReturnValue({ matches: false, addEventListener() {}, removeEventListener() {} }); window.localStorage.clear();
  const first = render(<App />);
  fireEvent.click(screen.getByRole('button', { name: 'Service settings' }));
  expect(screen.getByRole('dialog')).toBeTruthy();
  expect(within(screen.getByRole('dialog')).getAllByText(/unavailable/i).length).toBeGreaterThan(0);
  first.unmount();
  const status = vi.fn(async () => ({ configured: true, policy: 'ok' as const, transport: 'https' as const }));
  const set = vi.fn(); const socialCall = vi.fn(); const workCall = vi.fn();
  Object.defineProperty(window, 'hqServices', { configurable: true, value: { config: { status, set }, social: { call: socialCall }, work: { call: workCall } } });
  render(<App />);
  await screen.findAllByText('Configured · not checked');
  expect(status).toHaveBeenCalledWith('social'); expect(status).toHaveBeenCalledWith('work');
  expect(socialCall).not.toHaveBeenCalled(); expect(workCall).not.toHaveBeenCalled(); expect(set).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Service settings' }));
  const settings = screen.getByRole('dialog');
  expect(await within(settings).findAllByText('Configured · not checked')).toHaveLength(2);
  expect(within(settings).getAllByRole('textbox').every(input => (input as HTMLInputElement).value === '')).toBe(true);
  expect(socialCall).not.toHaveBeenCalled(); expect(workCall).not.toHaveBeenCalled(); expect(set).not.toHaveBeenCalled();
});


it('cycles appearance through all modes and restores the selected preference on remount', () => {
  window.matchMedia = vi.fn().mockReturnValue({ matches: true, addEventListener() {}, removeEventListener() {} });
  window.localStorage.clear();
  const first = render(<App />);
  expect(document.documentElement.dataset.theme).toBe('dark');
  fireEvent.click(screen.getByRole('button', { name: 'Appearance: System' }));
  expect(document.documentElement.dataset.theme).toBe('light');
  fireEvent.click(screen.getByRole('button', { name: 'Appearance: Light' }));
  expect(document.documentElement.dataset.theme).toBe('dark');
  expect(window.localStorage.getItem('hq.appearance.v1')).toBe('dark');
  first.unmount();
  render(<App />);
  fireEvent.click(screen.getByRole('button', { name: 'Appearance: Dark' }));
  expect(screen.getByRole('button', { name: 'Appearance: System' })).toBeTruthy();
  expect(document.documentElement.dataset.theme).toBe('dark');
});

it('collapses the rail with Home, retains named navigation and footer controls, and restores its saved width', () => {
  window.matchMedia = vi.fn().mockReturnValue({ matches: false, addEventListener() {}, removeEventListener() {} });
  window.localStorage.clear();
  const first = render(<App />);
  const splitter = screen.getByRole('separator', { name: 'Primary navigation width' });
  splitter.focus();
  fireEvent.keyDown(splitter, { key: 'End' });
  expect(splitter.getAttribute('aria-valuenow')).toBe('280');
  fireEvent.keyDown(splitter, { key: 'Home' });
  expect(splitter.getAttribute('aria-valuenow')).toBe('64');
  expect(screen.getByRole('button', { name: 'Design' }).getAttribute('title')).toBe('Design');
  expect(screen.getByRole('button', { name: 'Service settings' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Appearance: System' })).toBeTruthy();
  expect(document.activeElement).toBe(splitter);
  first.unmount();
  render(<App />);
  const restored = screen.getByRole('separator', { name: 'Primary navigation width' });
  expect(restored.getAttribute('aria-valuenow')).toBe('64');
  fireEvent.keyDown(restored, { key: 'Enter' });
  expect(restored.getAttribute('aria-valuenow')).toBe('280');
  fireEvent.doubleClick(restored);
  expect(restored.getAttribute('aria-valuenow')).toBe('64');
});
