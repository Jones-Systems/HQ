import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { HqServices } from '@hq/contracts/services';
vi.mock('./modules', () => ({ DOMAIN_LABELS: { design: 'Design', social: 'Social', work: 'Work', wiki: 'Wiki' }, MODULES: { design: () => <div>Design stub</div>, wiki: () => <div>Wiki home stub</div> }, MODULE_PRESENTATION: {} }));
import { App } from './App';
afterEach(() => { cleanup(); delete (window as { hqServices?: HqServices }).hqServices; });
it('settings rail action is absent in browser preview; explicit opening is required on desktop', async () => {
  window.matchMedia = vi.fn().mockReturnValue({ matches: false, addEventListener() {}, removeEventListener() {} }); window.localStorage.clear();
  const first = render(<App />); expect(screen.queryByText('Service settings')).toBeNull(); first.unmount();
  const status = vi.fn(async () => ({ configured: false, policy: 'ok' as const, transport: null }));
  Object.defineProperty(window, 'hqServices', { configurable: true, value: { config: { status, set: vi.fn() } } });
  render(<App />); expect(status).not.toHaveBeenCalled(); fireEvent.click(screen.getByText('Service settings'));
  await screen.findAllByText('Not connected.'); expect(status).toHaveBeenCalledTimes(2); expect(screen.getByRole('dialog')).toBeTruthy();
});
