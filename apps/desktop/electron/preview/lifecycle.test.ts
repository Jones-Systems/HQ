import { afterEach, expect, it, vi } from 'vitest';
import { runInNewContext } from 'node:vm';
import { app } from 'electron';
import type { BrowserWindow } from 'electron';
const fake = vi.hoisted(() => ({ readFile: vi.fn(), create: vi.fn(), classify: vi.fn() }));
vi.mock('electron', () => ({ app: { isPackaged: false, on: vi.fn() } }));
vi.mock('node:fs/promises', () => ({ readFile: fake.readFile }));
vi.mock('../contents-factory.js', () => ({ createIsolatedContents: fake.create, contentsClass: fake.classify, probeUnregisteredContents: vi.fn() }));
import { createPreviewHost } from './host';
import { previewParams } from './validation';
const hosts: ReturnType<typeof createPreviewHost>[] = [];
afterEach(async () => { await Promise.all(hosts.splice(0).map(host => host.closeAll())); vi.useRealTimers(); vi.unstubAllEnvs(); vi.clearAllMocks(); });
function fixture() {
  vi.stubEnv('HQ_USER_DATA_DIR', 'synthetic-owned-profile'); vi.stubEnv('HQ_QUALIFY_PREVIEW', '1');
  let destroyed = false, url = 'about:blank', attached = false, bounds = { x: 0, y: 0, width: 0, height: 0 };
  const contents = { on: vi.fn(), isDestroyed: () => destroyed, close: vi.fn(() => { destroyed = true; }), getURL: () => url,
    loadURL: vi.fn(async (value: string) => { url = value; }), executeJavaScriptInIsolatedWorld: vi.fn(async (_world: number, _scripts: { code: string }[]): Promise<unknown> => undefined),
    setWindowOpenHandler: vi.fn(), setAudioMuted: vi.fn(), setWebRTCIPHandlingPolicy: vi.fn(),
    debugger: { isAttached: () => attached, attach: () => { attached = true; }, sendCommand: vi.fn(async (_method: string, _params?: { captureBeyondViewport?: boolean }): Promise<unknown> => ({})) } };
  const session = { clearData: vi.fn(async () => {}), on: vi.fn(), webRequest: { onBeforeRequest: vi.fn() }, setPermissionRequestHandler: vi.fn(), setPermissionCheckHandler: vi.fn(), setDevicePermissionHandler: vi.fn(), setDisplayMediaRequestHandler: vi.fn() };
  const view = { webContents: contents, getBounds: () => bounds, setBounds: vi.fn(value => { bounds = value; }), setVisible: vi.fn() };
  fake.readFile.mockResolvedValue('synthetic agent bundle'); fake.create.mockReturnValue({ view, session });
  const window = { webContents: { getOSProcessId: () => 123 }, isDestroyed: () => false, contentView: { addChildView: vi.fn(), removeChildView: vi.fn() } } as unknown as BrowserWindow;
  const putBlob = vi.fn(async () => true);
  const host = createPreviewHost({ window: () => window, putBlob }); hosts.push(host);
  return { host, contents, session, view, putBlob };
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

function captureFixture(contents: ReturnType<typeof fixture>['contents']) {
  const bytes = Buffer.alloc(24); bytes.write('PNG', 1); bytes.writeUInt32BE(1170, 16); bytes.writeUInt32BE(2532, 20);
  const pixels = { data: bytes.toString('base64') };
  contents.executeJavaScriptInIsolatedWorld.mockImplementation(async (_world, scripts) => scripts[0].code.includes('resolveExact') ? {
    mutationCounter: 0, frame: { viewport: openParams.viewport, scroll: { x: 0, y: 0 } }, results: [], contentSize: { w: 390, h: 844 },
  } : undefined);
  contents.debugger.sendCommand.mockResolvedValue(pixels);
  return pixels;
}
it.each([false, true])('preserves responsive capture stability while refusing genuine mutation=%s', async genuineMutation => {
  const { host, contents, putBlob } = fixture();
  const opened = await host.call('open', openParams) as { ok: true; value: { sessionId: string; generation: number } };
  const pixels = captureFixture(contents);
  let mutationCounter = 0;
  contents.executeJavaScriptInIsolatedWorld.mockImplementation(async (_world, scripts) => scripts[0].code.includes('resolveExact') ? {
    mutationCounter, frame: { viewport: openParams.viewport, scroll: { x: 0, y: 100 } }, results: [], contentSize: { w: 390, h: 1800 },
  } : undefined);
  contents.debugger.sendCommand.mockImplementation(async (method, params) => {
    // Beyond-viewport capture can resize responsive content whose handlers write attributes.
    if (method === 'Page.captureScreenshot' && (params?.captureBeyondViewport || genuineMutation)) mutationCounter++;
    return pixels;
  });
  const result = await host.call('capture', { sessionId: opened.value.sessionId, expectedGeneration: opened.value.generation });
  if (genuineMutation) {
    expect(result).toEqual({ ok: false, kind: 'stale', reason: 'mutation' });
    expect(putBlob).not.toHaveBeenCalled();
  } else {
    expect(result).toMatchObject({ ok: true, value: { scroll: { x: 0, y: 100 } } });
    expect(putBlob).toHaveBeenCalledOnce();
    expect(contents.debugger.sendCommand).toHaveBeenLastCalledWith('Page.captureScreenshot', {
      format: 'png', fromSurface: true, captureBeyondViewport: false,
      clip: { x: 0, y: 100, width: 390, height: 844, scale: 1 },
    });
  }
});
it('times out a stuck screenshot, releases the queue, and ignores its late result', async () => {
  vi.useFakeTimers();
  const { host, contents, putBlob } = fixture();
  const opened = await host.call('open', openParams) as { ok: true; value: { sessionId: string; generation: number } };
  const pixels = captureFixture(contents);
  let finishLate!: (value: unknown) => void;
  contents.debugger.sendCommand.mockImplementationOnce(() => new Promise(resolve => { finishLate = resolve; }));
  const params = { sessionId: opened.value.sessionId, expectedGeneration: opened.value.generation };
  const firstResult = vi.fn(); void host.call('capture', params).then(firstResult);
  await vi.advanceTimersByTimeAsync(9000);
  expect(firstResult).toHaveBeenCalledWith({ ok: false, kind: 'unavailable', reason: 'capture-timeout' });
  expect(putBlob).not.toHaveBeenCalled();
  expect(await host.call('capture', params)).toMatchObject({ ok: true });
  expect(putBlob).toHaveBeenCalledOnce();
  finishLate(pixels); await vi.advanceTimersByTimeAsync(0);
  expect(putBlob).toHaveBeenCalledOnce();
});
it.each(['reading', 'reset'])('bounds a never-resolving %s world operation without storing a capture', async stage => {
  vi.useFakeTimers();
  const { host, contents, putBlob } = fixture();
  const opened = await host.call('open', openParams) as { ok: true; value: { sessionId: string; generation: number } };
  captureFixture(contents);
  const ordinary = contents.executeJavaScriptInIsolatedWorld.getMockImplementation()!;
  contents.executeJavaScriptInIsolatedWorld.mockImplementation((world, scripts) => scripts[0].code.includes(stage === 'reading' ? 'resolveExact' : 'setHighlightHidden(false)') ? new Promise(() => {}) : ordinary(world, scripts));
  const result = vi.fn(); void host.call('capture', { sessionId: opened.value.sessionId, expectedGeneration: opened.value.generation }).then(result);
  await vi.advanceTimersByTimeAsync(9000);
  expect(result).toHaveBeenCalledWith({ ok: false, kind: 'unavailable', reason: 'capture-timeout' });
  expect(putBlob).not.toHaveBeenCalled();
});
it.each(['closing-preview', 'unregistered', 'control', 'component', 'null', 'hq-main'])('client certificate selection denies %s without relying on the live-session map', async kind => {
  const { host, contents } = fixture();
  const opened = await host.call('open', openParams) as { ok: true; value: { sessionId: string } };
  if (kind === 'closing-preview') await host.call('close', { sessionId: opened.value.sessionId });
  fake.classify.mockReturnValue(kind === 'hq-main' ? 'hq-main' : kind === 'component' ? 'hq-component' : ['closing-preview', 'control'].includes(kind) ? 'hq-preview' : undefined);
  const handler = vi.mocked(app.on).mock.calls.find(call => call[0] === 'select-client-certificate')![1] as (...args: unknown[]) => void;
  const preventDefault = vi.fn(), callback = vi.fn();
  handler({ preventDefault }, kind === 'null' ? null : kind === 'closing-preview' ? contents : {}, 'https://example.com/', [{ synthetic: true }], callback);
  if (kind === 'hq-main') { expect(preventDefault).not.toHaveBeenCalled(); expect(callback).not.toHaveBeenCalled(); }
  else { expect(preventDefault).toHaveBeenCalledOnce(); expect(callback.mock.calls).toEqual([[]]); }
});

it('fences a late isolated-world reading and allows an already queued capture to recover', async () => {
  vi.useFakeTimers();
  const { host, contents, putBlob } = fixture();
  const opened = await host.call('open', openParams) as { ok: true; value: { sessionId: string; generation: number } };
  captureFixture(contents);
  let hidden = false;
  const sandbox = { window: { __hqPreviewAgentHostV1: { agent: {
    setHighlightHidden(value: boolean) { hidden = value; },
    resolveExact() { return { mutationCounter: 0, frame: { viewport: openParams.viewport, scroll: { x: 0, y: 0 } }, results: [] }; },
  } } }, document: { documentElement: { scrollWidth: 390, scrollHeight: 844 } } };
  let releaseLate!: () => void;
  let first = true;
  contents.executeJavaScriptInIsolatedWorld.mockImplementation(async (_world, scripts) => {
    if (first) { first = false; await new Promise<void>(resolve => { releaseLate = resolve; }); }
    return structuredClone(runInNewContext(scripts[0].code, sandbox));
  });
  const params = { sessionId: opened.value.sessionId, expectedGeneration: opened.value.generation };
  const stalled = host.call('capture', params), queued = host.call('capture', params);
  await vi.advanceTimersByTimeAsync(9000);
  expect(await stalled).toEqual({ ok: false, kind: 'unavailable', reason: 'capture-timeout' });
  const recovered = await queued; expect(recovered, JSON.stringify(recovered)).toMatchObject({ ok: true }); expect(putBlob).toHaveBeenCalledOnce(); expect(hidden).toBe(false);
  releaseLate(); await vi.advanceTimersByTimeAsync(0);
  expect(hidden).toBe(false); expect(putBlob).toHaveBeenCalledOnce();
});
it('reports ordinary capture errors as unavailable without claiming navigation changed', async () => {
  const { host, contents, putBlob } = fixture();
  const opened = await host.call('open', openParams) as { ok: true; value: { sessionId: string; generation: number } };
  captureFixture(contents); contents.debugger.sendCommand.mockRejectedValueOnce(new Error('Synthetic compositor failure'));
  expect(await host.call('capture', { sessionId: opened.value.sessionId, expectedGeneration: opened.value.generation })).toEqual({ ok: false, kind: 'unavailable', reason: 'capture-failed' });
  expect(putBlob).not.toHaveBeenCalled();
});

it('counts certificate denials for owned preview contents after close, excluding other classes', async () => {
  const { host, contents } = fixture();
  const opened = await host.call('open', openParams) as { ok: true; value: { sessionId: string } };
  await host.call('close', { sessionId: opened.value.sessionId });
  const handler = vi.mocked(app.on).mock.calls.find(call => call[0] === 'select-client-certificate')![1] as (...args: unknown[]) => void;
  fake.classify.mockReturnValue('hq-preview');
  for (const target of [contents, {}, null]) handler({ preventDefault: vi.fn() }, target, 'https://example.com/', [], vi.fn());
  const hook = (globalThis as unknown as { __hqPreviewQualification: { stats(): { denials: { certificates: number } } } }).__hqPreviewQualification;
  expect(hook.stats().denials.certificates).toBe(1);
});
