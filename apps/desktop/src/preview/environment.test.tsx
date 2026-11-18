import { beforeEach, describe, expect, it, vi } from 'vitest';
import { bootstrapPreview, createMemoryStorage, installEnvironment, installRandomUUID } from './environment';

const revision = 'a'.repeat(40);
function target() {
  document.head.innerHTML = '<meta name="jones-preview-entry" content="default">';
  document.body.innerHTML = '<div id="root"></div>';
  const realLocal = createMemoryStorage(); const realSession = createMemoryStorage();
  realLocal.setItem('existing', 'local'); realSession.setItem('existing', 'session');
  const localRead = vi.fn(() => realLocal); const sessionRead = vi.fn(() => realSession);
  const host = { document, crypto: globalThis.crypto, isSecureContext: false };
  Object.defineProperties(host, { localStorage: { configurable: true, get: localRead }, sessionStorage: { configurable: true, get: sessionRead } });
  return { host: host as unknown as Window, realLocal, realSession, localRead, sessionRead };
}
beforeEach(() => { document.documentElement.removeAttribute('data-preview-state'); });

it('installs independent memory stores without touching real storage or creating a bridge', () => {
  const a = target(); installEnvironment(a.host, revision);
  a.host.localStorage.setItem('existing', 'changed'); a.host.sessionStorage.setItem('only-session', 'yes');
  const b = target(); installEnvironment(b.host, revision);
  expect(a.localRead).not.toHaveBeenCalled(); expect(a.sessionRead).not.toHaveBeenCalled();
  expect(a.realLocal.getItem('existing')).toBe('local'); expect(a.realSession.getItem('existing')).toBe('session');
  expect(a.host.localStorage.getItem('only-session')).toBeNull();
  expect(b.host.localStorage.getItem('existing')).toBeNull();
  expect('hqServices' in a.host).toBe(false); expect('hqDesktop' in a.host).toBe(false);
  expect(document.documentElement.dataset.previewSession).toMatch(/^[a-f0-9]{32}$/);
  expect(document.documentElement.dataset.previewState).toBe('booting');
  expect(document.documentElement.dataset.previewRevision).toBe(revision);
});

it('makes a fresh session on every installation', () => {
  const a = target(); installEnvironment(a.host, revision);
  const first = document.documentElement.dataset.previewSession;
  const b = target(); installEnvironment(b.host, revision);
  expect(document.documentElement.dataset.previewSession).not.toBe(first);
});

it('leaves the App unimported and unmounted when the storage shim fails', async () => {
  const { host } = target(); Object.defineProperty(host, 'sessionStorage', { configurable: false, get() { throw Error('must not read'); } });
  const mount = vi.fn(); await bootstrapPreview(host, revision, mount);
  expect(mount).not.toHaveBeenCalled();
  expect(document.documentElement.dataset.previewState).toBe('failed');
  expect(document.querySelector('[role="alert"]')?.textContent).toContain('Preview could not start:');
});

it('rejects a desktop bridge and unsupported error entry before mounting', async () => {
  for (const kind of ['bridge', 'error']) {
    const { host } = target();
    if (kind === 'bridge') Object.defineProperty(host, 'hqServices', { value: {} });
    else document.querySelector('meta')!.setAttribute('content', 'error');
    const mount = vi.fn(); await bootstrapPreview(host, revision, mount);
    expect(mount).not.toHaveBeenCalled(); expect(document.documentElement.dataset.previewState).toBe('failed');
  }
});

it('only imports the app after storage and session attributes are installed', async () => {
  const { host, localRead } = target();
  await bootstrapPreview(host, revision, async entry => {
    expect(entry).toBe('default'); expect(host.localStorage.length).toBe(0);
    expect(document.documentElement.dataset.previewSchema).toBe('jones-preview-session/v1');
    expect(document.documentElement.dataset.previewStorage).toBe('memory');
  });
  expect(localRead).not.toHaveBeenCalled();
});

describe('randomUUID fallback', () => {
  it('uses getRandomValues and generates RFC 4122 version 4 UUIDs only when missing on an insecure origin', () => {
    const getRandomValues = vi.fn((bytes: Uint8Array) => { bytes.fill(255); return bytes; });
    const crypto = { getRandomValues } as unknown as Crypto;
    installRandomUUID(crypto, false);
    expect(crypto.randomUUID()).toBe('ffffffff-ffff-4fff-bfff-ffffffffffff');
    expect(getRandomValues).toHaveBeenCalledTimes(1);
  });
  it('preserves an existing implementation and fails without secure randomness', () => {
    const randomUUID = vi.fn(); const crypto = { randomUUID } as unknown as Crypto;
    installRandomUUID(crypto, false); expect(crypto.randomUUID).toBe(randomUUID);
    expect(() => installRandomUUID({} as Crypto, false)).toThrow('Secure random');
    expect(() => installRandomUUID({} as Crypto, true)).toThrow('Secure-context');
  });
});
