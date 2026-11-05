import { expect, it, vi } from 'vitest';
vi.mock('electron', () => ({ app: { on: vi.fn() }, BrowserWindow: vi.fn(), WebContentsView: vi.fn(), session: {} }));
import { assertIsolatedPreferences, ISOLATED_PREFERENCES } from './contents-factory';
it('rejects any preload and altered literal isolation preferences before construction', () => {
  expect(() => assertIsolatedPreferences({ ...ISOLATED_PREFERENCES })).not.toThrow();
  expect(() => assertIsolatedPreferences({ ...ISOLATED_PREFERENCES, preload: undefined })).toThrow();
  for (const key of Object.keys(ISOLATED_PREFERENCES)) expect(() => assertIsolatedPreferences({ ...ISOLATED_PREFERENCES, [key]: !ISOLATED_PREFERENCES[key as keyof typeof ISOLATED_PREFERENCES] })).toThrow();
});
