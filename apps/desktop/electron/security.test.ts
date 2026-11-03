import { expect, it } from 'vitest';
import { DEVELOPMENT_URL, validateDevelopmentUrl, WINDOW_SECURITY } from './security';

it('loads local built content by default and only the exact dev origin when requested', () => {
  expect(validateDevelopmentUrl(undefined, false)).toBeNull();
  expect(validateDevelopmentUrl(DEVELOPMENT_URL, false)).toBe(DEVELOPMENT_URL);
  for (const value of ['https://example.com', 'http://127.0.0.1:5173.evil.test', 'file:///private', 'http://localhost:5173']) {
    expect(() => validateDevelopmentUrl(value, false)).toThrow();
  }
  expect(() => validateDevelopmentUrl(DEVELOPMENT_URL, true)).toThrow();
  expect(WINDOW_SECURITY).toMatchObject({ sandbox: true, contextIsolation: true, nodeIntegration: false, webviewTag: false, webSecurity: true });
});
