import { afterEach, expect, it, vi } from 'vitest';
import type { BrowserWindow } from 'electron';
const fake = vi.hoisted(() => ({ readFile: vi.fn(), create: vi.fn() }));
vi.mock('electron', () => ({ app: { isPackaged: false, on: vi.fn() } }));
vi.mock('node:fs/promises', () => ({ readFile: fake.readFile }));
vi.mock('../contents-factory.js', () => ({ createIsolatedContents: fake.create, probeUnregisteredContents: vi.fn() }));
import { createPreviewHost } from './host';
import { previewParams } from './validation';
const hosts: ReturnType<typeof createPreviewHost>[] = [];
afterEach(async () => { await Promise.all(hosts.splice(0).map(host => host.closeAll())); vi.unstubAllEnvs(); vi.clearAllMocks(); });
function fixture() {
  vi.stubEnv('HQ_USER_DATA_DIR', 'synthetic-owned-profile'); vi.stubEnv('HQ_QUALIFY_PREVIEW', '1');
  let destroyed = false, url = 'about:blank', attached = false, bounds = { x: 0, y: 0, width: 0, height: 0 };
  const contents = { on: vi.fn(), isDestroyed: () => destroyed, close: vi.fn(() => { destroyed = true; }), getURL: () => url,
    loadURL: vi.fn(async (value: string) => { url = value; }), executeJavaScriptInIsolatedWorld: vi.fn(async () => undefined),
    setWindowOpenHandler: vi.fn(), setAudioMuted: vi.fn(), setWebRTCIPHandlingPolicy: vi.fn(),
    debugger: { isAttached: () => attached, attach: () => { attached = true; }, sendCommand: vi.fn(async () => ({})) } };
  const session = { clearData: vi.fn(async () => {}), on: vi.fn(), webRequest: { onBeforeRequest: vi.fn() }, setPermissionRequestHandler: vi.fn(), setPermissionCheckHandler: vi.fn(), setDevicePermissionHandler: vi.fn(), setDisplayMediaRequestHandler: vi.fn() };
  const view = { webContents: contents, getBounds: () => bounds, setBounds: vi.fn(value => { bounds = value; }), setVisible: vi.fn() };
  fake.readFile.mockResolvedValue('synthetic agent bundle'); fake.create.mockReturnValue({ view, session });
  const window = { isDestroyed: () => false, contentView: { addChildView: vi.fn(), removeChildView: vi.fn() } } as unknown as BrowserWindow;
  const host = createPreviewHost({ window: () => window, putBlob: vi.fn(async () => true) }); hosts.push(host);
  return { host, contents, session, view };
}
const openParams = { versionId: 'synthetic-version', url: 'https://example.com/', viewport: { w: 390, h: 844, dpr: 3 }, label: 'Synthetic' };
it('rejects an in-flight open deactivated before native allocation', async () => {
  const { host } = fixture(); let resolve!: (source: string) => void;
  fake.readFile.mockReturnValue(new Promise<string>(done => { resolve = done; }));
  const opening = host.call('open', openParams);
  expect(await host.call('deactivate', {})).toEqual({ ok: true, value: null });
  resolve('synthetic bundle');
  expect(await opening).toEqual({ ok: false, kind: 'stale', reason: 'deactivated' });
  expect(fake.create).not.toHaveBeenCalled();
});
it('deactivates directly opened native sessions without a renderer tracking set', async () => {
  const { host, contents, session } = fixture();
  expect(await host.call('open', openParams)).toMatchObject({ ok: true });
  expect(await host.call('deactivate', {})).toEqual({ ok: true, value: null });
  expect(contents.close).toHaveBeenCalledOnce(); expect(session.clearData).toHaveBeenCalledOnce();
});
it('keeps late placement hidden under Settings and restores intended visibility', async () => {
  const { host, view } = fixture();
  const opened = await host.call('open', openParams) as { ok: true; value: { sessionId: string } };
  await host.call('overlay', { hidden: true });
  await host.call('place', { sessionId: opened.value.sessionId, rect: { x: 0, y: 0, width: 390, height: 844 }, visible: true });
  expect(view.setVisible).toHaveBeenLastCalledWith(false);
  await host.call('overlay', { hidden: false }); expect(view.setVisible).toHaveBeenLastCalledWith(true);
  await host.call('place', { sessionId: opened.value.sessionId, rect: { x: 0, y: 0, width: 390, height: 844 }, visible: false });
  await host.call('overlay', { hidden: true }); await host.call('overlay', { hidden: false }); expect(view.setVisible).toHaveBeenLastCalledWith(false);
});
it('accepts only the closed lifecycle route payloads', () => {
  expect(previewParams('deactivate', {})).toBe(true); expect(previewParams('overlay', { hidden: true })).toBe(true);
  expect(previewParams('deactivate', { sessionId: 'arbitrary' })).toBe(false);
  expect(previewParams('overlay', { hidden: 1 })).toBe(false); expect(previewParams('overlay', { hidden: false, url: 'https://example.com/' })).toBe(false);
});
