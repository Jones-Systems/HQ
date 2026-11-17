import { afterEach, expect, it, vi } from 'vitest';
import { runInNewContext } from 'node:vm';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Node } from '@oxc-project/types';
import { parseAst } from 'rolldown/parseAst';
import { app } from 'electron';
import type { BrowserWindow } from 'electron';
const fake = vi.hoisted(() => ({ readFile: vi.fn(), create: vi.fn(), classify: vi.fn(), displayFactor: 1 }));
vi.mock('electron', () => ({ app: { isPackaged: false, getVersion: vi.fn(() => '0.1.0-synthetic'), on: vi.fn() }, screen: { getDisplayMatching: () => ({ scaleFactor: fake.displayFactor }) } }));
vi.mock('node:fs/promises', () => ({ readFile: fake.readFile }));
vi.mock('../contents-factory.js', () => ({ createIsolatedContents: fake.create, contentsClass: fake.classify, probeUnregisteredContents: vi.fn() }));
import { createPreviewHost } from './host';
import { previewParams } from './validation';
const hosts: ReturnType<typeof createPreviewHost>[] = [];
afterEach(async () => { await Promise.all(hosts.splice(0).map(host => host.closeAll())); fake.displayFactor = 1; vi.useRealTimers(); vi.unstubAllEnvs(); vi.clearAllMocks(); });
function fixture(zoomFactor?: number, options: { persistReceipt?: (receipt: Readonly<Record<string, unknown>>) => Promise<boolean> } = {}, captureMode?: 'viewport' | 'full') {
  vi.stubEnv('HQ_USER_DATA_DIR', 'synthetic-owned-profile'); vi.stubEnv('HQ_QUALIFY_PREVIEW', '1');
  let destroyed = false, url = 'about:blank', attached = false, bounds = { x: 0, y: 0, width: 0, height: 0 };
  const contents = { on: vi.fn(), isDestroyed: () => destroyed, isCrashed: vi.fn(() => false), close: vi.fn(() => { destroyed = true; }), getURL: () => url,
    loadURL: vi.fn(async (value: string) => { url = value; }), executeJavaScriptInIsolatedWorld: vi.fn(async (_world: number, _scripts: { code: string }[]): Promise<unknown> => undefined),
    setWindowOpenHandler: vi.fn(), setAudioMuted: vi.fn(), setWebRTCIPHandlingPolicy: vi.fn(),
    debugger: { isAttached: () => attached, attach: () => { attached = true; }, sendCommand: vi.fn(async (_method: string, _params?: { captureBeyondViewport?: boolean }): Promise<unknown> => ({})) } };
  const session = { clearData: vi.fn(async () => {}), on: vi.fn(), webRequest: { onBeforeRequest: vi.fn() }, setPermissionRequestHandler: vi.fn(), setPermissionCheckHandler: vi.fn(), setDevicePermissionHandler: vi.fn(), setDisplayMediaRequestHandler: vi.fn() };
  const view = { webContents: contents, getBounds: () => bounds, setBounds: vi.fn(value => { bounds = value; }), setVisible: vi.fn(), setBorderRadius: vi.fn() };
  fake.readFile.mockResolvedValue('synthetic agent bundle'); fake.create.mockReturnValue({ view, session });
  const window = { webContents: { getOSProcessId: () => 123, ...(zoomFactor === undefined ? {} : { getZoomFactor: () => zoomFactor }) }, isDestroyed: () => false, getBounds: () => ({ x: 0, y: 0, width: 1600, height: 1000 }), contentView: { addChildView: vi.fn(), removeChildView: vi.fn() } } as unknown as BrowserWindow;
  const putBlob = vi.fn(async () => true);
  const hostOptions = { window: () => window, putBlob, ...options };
  const host = captureMode === undefined ? createPreviewHost(hostOptions) : createPreviewHost(hostOptions, captureMode); hosts.push(host);
  return { host, contents, session, view, putBlob, window };
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
const desktopOpen = { ...openParams, viewport: { w: 1024, h: 720, dpr: 1 } };
const metrics = (contents: ReturnType<typeof fixture>['contents']) => contents.debugger.sendCommand.mock.calls
  .filter(([method]) => method === 'Emulation.setDeviceMetricsOverride').map(([, params]) => params as unknown as Record<string, unknown>);
const widgetSizes = (contents: ReturnType<typeof fixture>['contents']) => contents.debugger.sendCommand.mock.calls
  .filter(([method]) => method === 'Emulation.setVisibleSize').map(([, params]) => params as unknown as { width: number; height: number });
it('installs the native frame clip before the view joins the window', async () => {
  const { host, view, window } = fixture();
  await host.call('open', desktopOpen);
  // CSS cannot clip a native view; without this a widget larger than the view painted over HQ.
  expect(view.setBorderRadius).toHaveBeenCalledWith(1);
  const added = vi.mocked(window.contentView.addChildView).mock.invocationCallOrder[0]!;
  expect(view.setBorderRadius.mock.invocationCallOrder[0]).toBeLessThan(added);
});
it('places native bounds on the fitted page and keeps the emulated widget size equal to the frame', async () => {
  const { host, view, contents } = fixture();
  const opened = await host.call('open', desktopOpen) as { ok: true; value: { sessionId: string; generation: number } };
  const placed = await host.call('place', { sessionId: opened.value.sessionId, rect: { x: 120, y: 179, width: 1006, height: 420 }, visible: true }) as { ok: true; value: { generation: number } };
  // Before the repair the view took the whole 1006×420 placeholder and painted background beside a 597px page.
  expect(view.setBounds).toHaveBeenLastCalledWith({ x: 325, y: 179, width: 597, height: 420 });
  const applied = metrics(contents);
  expect(applied.length).toBeGreaterThanOrEqual(2);
  // A stored emulation size would resize each new main-frame widget to 1024×720 after link navigation.
  for (const params of applied) expect(params).toMatchObject({ width: 1024, height: 720, deviceScaleFactor: 1, dontSetVisibleSize: true });
  // The stored widget size is the frame, so a new main-frame widget also fills the frame and no more.
  expect(widgetSizes(contents).at(-1)).toEqual({ width: 597, height: 420 });
  expect(applied.at(-1)!.scale).toBeCloseTo(597 / 1024, 6);
  expect(placed.value.generation).toBe(opened.value.generation + 1);
  const again = await host.call('place', { sessionId: opened.value.sessionId, rect: { x: 0, y: 64, width: 597, height: 420 }, visible: true }) as { ok: true; value: { generation: number } };
  expect(again.value.generation).toBe(placed.value.generation);
  expect(view.setBounds).toHaveBeenLastCalledWith({ x: 0, y: 64, width: 597, height: 420 });
  const resized = await host.call('place', { sessionId: opened.value.sessionId, rect: { x: 0, y: 64, width: 1024, height: 720 }, visible: true }) as { ok: true; value: { generation: number } };
  expect(resized.value.generation).toBe(placed.value.generation + 1);
  expect(metrics(contents).at(-1)!.scale).toBe(1);
  expect(widgetSizes(contents)).toEqual([{ width: 597, height: 420 }, { width: 597, height: 420 }, { width: 1024, height: 720 }]);
});
it('refuses to size the widget once the renderer has gone, before the crash event arrives', async () => {
  const { host, contents } = fixture();
  const opened = await host.call('open', desktopOpen) as { ok: true; value: { sessionId: string } };
  contents.isCrashed.mockReturnValue(true);
  // Chromium dereferences the widget without a null guard, so the send must not happen.
  expect(await host.call('place', { sessionId: opened.value.sessionId, rect: { x: 0, y: 0, width: 942, height: 662 }, visible: true })).toEqual({ ok: false, kind: 'unavailable' });
  expect(widgetSizes(contents)).toEqual([]);
});
it('converts placeholder CSS pixels by the main renderer zoom before placing the native view', async () => {
  const { host, view } = fixture(0.8);
  const opened = await host.call('open', desktopOpen) as { ok: true; value: { sessionId: string } };
  await host.call('place', { sessionId: opened.value.sessionId, rect: { x: 100, y: 50, width: 1024, height: 720 }, visible: true });
  expect(view.setBounds).toHaveBeenLastCalledWith({ x: 80, y: 40, width: 819, height: 576 });
});
it('applies only the newest of overlapping placements', async () => {
  const { host, view, contents } = fixture();
  const opened = await host.call('open', { ...openParams, viewport: { w: 390, h: 844, dpr: 1 } }) as { ok: true; value: { sessionId: string } };
  const sessionId = opened.value.sessionId;
  // Native Resume: the pre-fit placeholder is reported, then the fitted frame, while the first install is still pending.
  let release!: () => void;
  contents.executeJavaScriptInIsolatedWorld.mockImplementationOnce(() => new Promise(resolve => { release = () => resolve(undefined); }));
  const stale = host.call('place', { sessionId, rect: { x: 432, y: 232, width: 942, height: 2039 }, visible: false });
  await host.call('place', { sessionId, rect: { x: 708, y: 232, width: 390, height: 844 }, visible: true });
  release(); await stale;
  expect(view.setBounds).toHaveBeenLastCalledWith({ x: 708, y: 232, width: 390, height: 844 });
  expect(view.setVisible).toHaveBeenLastCalledWith(true);
  expect(metrics(contents).at(-1)!.scale).toBe(1);
});
it('reports a mark whose coherent capture failed once instead of dropping it silently', async () => {
  const { host, contents } = fixture();
  const opened = await host.call('open', desktopOpen) as { ok: true; value: { sessionId: string } };
  const sessionId = opened.value.sessionId;
  await host.call('place', { sessionId, rect: { x: 0, y: 0, width: 942, height: 662 }, visible: true });
  const { generation } = (await host.call('status', { sessionId }) as { ok: true; value: { generation: number } }).value;
  expect(await host.call('mode', { sessionId, generation, mode: 'pick' })).toEqual({ ok: true, value: null });
  const rect = { x: 10, y: 10, width: 100, height: 20 };
  const event = { type: 'element-picked', target: { kind: 'element', path: 'body > h1', rect }, frame: { viewport: { w: 1024, h: 720, dpr: 1 }, scroll: { x: 0, y: 0 } }, generation, snapshot: { identity: 'h1', text: 'Heading', rects: [rect] } };
  let drained = false;
  // The agent queue yields one pick; the capture's agent reading is unusable, so the capture fails.
  contents.executeJavaScriptInIsolatedWorld.mockImplementation(async (_world, scripts) => {
    if (scripts[0]!.code.includes('.drain()') && !drained) { drained = true; return [event]; }
    return scripts[0]!.code.includes('.drain()') ? [] : undefined;
  });
  await vi.waitFor(async () => expect(await host.call('status', { sessionId })).toEqual({ ok: false, kind: 'stale', reason: 'mark-capture-failed' }));
  expect(await host.call('status', { sessionId })).toMatchObject({ ok: true });
  expect(await host.call('events', { sessionId, after: 0 })).toMatchObject({ ok: true, value: { events: [] } });
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
    expect(contents.debugger.sendCommand.mock.calls.filter(([method]) => method === 'Page.captureScreenshot').at(-1)).toEqual(['Page.captureScreenshot', {
      format: 'png', fromSurface: true, captureBeyondViewport: false,
      clip: { x: 0, y: 100, width: 390, height: 844, scale: 1 },
    }]);
  }
});
// Native evidence (Chromium 152): a screenshot of a widget not already at the shot size rescales it, re-rasters
// and restores it, and two such rasters of a static image-heavy page were not byte-identical. The widget takes
// the view's size when the view is placed, or the emulated visible size.
function rasterModel(contents: ReturnType<typeof fixture>['contents'], view: ReturnType<typeof fixture>['view'], viewport: { w: number; h: number; dpr: number }) {
  let scale = 1, raster = 0, widget = { width: view.getBounds().width, height: view.getBounds().height };
  const place = view.setBounds.getMockImplementation()!;
  view.setBounds.mockImplementation(value => { place(value); widget = { width: value.width, height: value.height }; });
  const atShotSize = () => widget.width === viewport.w * viewport.dpr && widget.height === viewport.h * viewport.dpr && scale === viewport.dpr;
  contents.executeJavaScriptInIsolatedWorld.mockImplementation(async (_world, scripts) => scripts[0].code.includes('resolveExact') ? {
    mutationCounter: 0, frame: { viewport, scroll: { x: 0, y: 0 } }, results: [], contentSize: { w: viewport.w, h: viewport.h },
  } : undefined);
  contents.debugger.sendCommand.mockImplementation(async (method, params) => {
    if (method === 'Emulation.setVisibleSize') { widget = params as unknown as typeof widget; return {}; }
    if (method === 'Emulation.setDeviceMetricsOverride') { scale = (params as unknown as { scale: number }).scale; if (atShotSize()) raster++; return {}; }
    if (method !== 'Page.captureScreenshot') return {};
    const bytes = Buffer.alloc(28); bytes.write('PNG', 1); bytes.writeUInt32BE(viewport.w * viewport.dpr, 16); bytes.writeUInt32BE(viewport.h * viewport.dpr, 20);
    bytes.writeUInt32BE(atShotSize() ? raster : ++raster, 24);
    return { data: bytes.toString('base64') };
  });
}
const qualification = () => (globalThis as unknown as { __hqPreviewQualification: { pauseAt(stage: string | null): void; waitForPause(): Promise<unknown>; resume(): void } }).__hqPreviewQualification;
async function scaledSession(rect = { x: 40, y: 60, width: 942, height: 662 }) {
  const native = fixture();
  const opened = await native.host.call('open', desktopOpen) as { ok: true; value: { sessionId: string } };
  const sessionId = opened.value.sessionId;
  await native.host.call('place', { sessionId, rect, visible: true });
  rasterModel(native.contents, native.view, desktopOpen.viewport);
  const { generation } = (await native.host.call('status', { sessionId }) as { ok: true; value: { generation: number } }).value;
  return { ...native, sessionId, generation, fittedScale: Math.min(942 / 1024, 662 / 720) };
}
it('reads both screenshots of a scaled frame from one raster held inside the frame, then restores the widget', async () => {
  const { host, view, contents, putBlob, sessionId, generation, fittedScale } = await scaledSession();
  const placed = view.setBounds.mock.calls.length, sized = widgetSizes(contents).length;
  // Before the repair each screenshot rescaled the widget itself, so the pair compared two rasters: pixels-unstable.
  expect(await host.call('capture', { sessionId, expectedGeneration: generation })).toMatchObject({ ok: true, value: { generation } });
  expect(putBlob).toHaveBeenCalledOnce();
  // Only the widget took the shot size; the view, and so its clip and hit area, never left the frame.
  expect(view.setBounds.mock.calls.length).toBe(placed);
  expect(view.getBounds()).toEqual({ x: 40, y: 60, width: 942, height: 662 });
  expect(widgetSizes(contents).slice(sized)).toEqual([{ width: 1024, height: 720 }, { width: 942, height: 662 }]);
  expect(metrics(contents).at(-1)!.scale).toBeCloseTo(fittedScale, 6);
  for (const params of metrics(contents)) expect(params).toMatchObject({ width: 1024, height: 720, deviceScaleFactor: 1, dontSetVisibleSize: true });
  expect(await host.call('status', { sessionId })).toMatchObject({ ok: true, value: { generation } });
});
it('leaves an unscaled frame untouched while capturing', async () => {
  const { host, view, contents, sessionId, generation } = await scaledSession({ x: 0, y: 64, width: 1024, height: 720 });
  const placed = view.setBounds.mock.calls.length, emulated = metrics(contents).length, sized = widgetSizes(contents).length;
  expect(await host.call('capture', { sessionId, expectedGeneration: generation })).toMatchObject({ ok: true });
  expect(view.setBounds.mock.calls.length).toBe(placed); expect(metrics(contents).length).toBe(emulated); expect(widgetSizes(contents).length).toBe(sized);
});
it('lets a same-size placement during a held capture move the view without fencing, and keeps the newest placement', async () => {
  const { host, view, contents, putBlob, sessionId, generation } = await scaledSession();
  qualification().pauseAt('first-capture');
  const pending = host.call('capture', { sessionId, expectedGeneration: generation });
  try {
    await qualification().waitForPause();
    expect(view.getBounds()).toEqual({ x: 40, y: 60, width: 942, height: 662 });
    expect(widgetSizes(contents).at(-1)).toEqual({ width: 1024, height: 720 });
    expect(await host.call('place', { sessionId, rect: { x: 40, y: 200, width: 942, height: 662 }, visible: true })).toMatchObject({ ok: true, value: { generation } });
  } finally { qualification().resume(); qualification().pauseAt(null); }
  // The move ended the hold before the second screenshot, so the pair is refused rather than stored.
  expect(await pending).toEqual({ ok: false, kind: 'stale', reason: 'pixels-unstable' });
  expect(putBlob).not.toHaveBeenCalled();
  expect(view.setBounds).toHaveBeenLastCalledWith({ x: 40, y: 200, width: 942, height: 662 });
  expect(widgetSizes(contents).at(-1)).toEqual({ width: 942, height: 662 });
});
it('restores the frame-sized widget when a held screenshot fails', async () => {
  const { host, view, contents, putBlob, sessionId, generation, fittedScale } = await scaledSession();
  const ordinary = contents.debugger.sendCommand.getMockImplementation()!;
  let shots = 0;
  contents.debugger.sendCommand.mockImplementation((method, params) => method === 'Page.captureScreenshot' && ++shots === 2 ? Promise.reject(new Error('Synthetic compositor failure')) : ordinary(method, params));
  expect(await host.call('capture', { sessionId, expectedGeneration: generation })).toEqual({ ok: false, kind: 'unavailable', reason: 'capture-failed' });
  expect(putBlob).not.toHaveBeenCalled();
  expect(view.getBounds()).toEqual({ x: 40, y: 60, width: 942, height: 662 });
  expect(widgetSizes(contents).at(-1)).toEqual({ width: 942, height: 662 });
  expect(metrics(contents).at(-1)!.scale).toBeCloseTo(fittedScale, 6);
});
it('restores the frame-sized widget when a held screenshot times out, and again when it completes late', async () => {
  vi.useFakeTimers();
  const { host, view, contents, putBlob, sessionId, generation, fittedScale } = await scaledSession();
  const ordinary = contents.debugger.sendCommand.getMockImplementation()!;
  let shots = 0, finishLate!: () => void;
  contents.debugger.sendCommand.mockImplementation((method, params) => method === 'Page.captureScreenshot' && ++shots === 2
    ? new Promise(resolve => { finishLate = () => resolve(ordinary(method, params)); }) : ordinary(method, params));
  const result = vi.fn(); void host.call('capture', { sessionId, expectedGeneration: generation }).then(result);
  await vi.advanceTimersByTimeAsync(9000);
  expect(result).toHaveBeenCalledWith({ ok: false, kind: 'unavailable', reason: 'capture-timeout' });
  expect(putBlob).not.toHaveBeenCalled();
  expect(view.getBounds()).toEqual({ x: 40, y: 60, width: 942, height: 662 });
  expect(widgetSizes(contents).at(-1)).toEqual({ width: 942, height: 662 });
  expect(metrics(contents).at(-1)!.scale).toBeCloseTo(fittedScale, 6);
  // On completion Chromium restores the size and metrics the screenshot started with: the held shot's.
  const sized = widgetSizes(contents).length, emulated = metrics(contents).length;
  finishLate(); await vi.advanceTimersByTimeAsync(0);
  expect(widgetSizes(contents).slice(sized)).toEqual([{ width: 942, height: 662 }]);
  expect(metrics(contents).slice(emulated).map(params => params.scale)).toEqual([fittedScale]);
  expect(putBlob).not.toHaveBeenCalled();
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

async function receiptSession(options: Parameters<typeof fixture>[1] = {}) {
  vi.useFakeTimers();
  const native = fixture(undefined, options);
  const opened = await native.host.call('open', openParams) as { ok: true; value: { sessionId: string; generation: number } };
  const pixels = captureFixture(native.contents);
  return { ...native, pixels, params: { sessionId: opened.value.sessionId, expectedGeneration: opened.value.generation } };
}
const receiptStats = () => (globalThis as unknown as { __hqPreviewQualification: { stats(): { blobWrites: number; receiptOrphans: number } } }).__hqPreviewQualification.stats();
function navigateDuringPersistence(contents: ReturnType<typeof fixture>['contents']) {
  const handler = contents.on.mock.calls.find(([event]) => event === 'did-start-navigation')![1] as (...args: unknown[]) => void;
  handler({}, 'https://example.com/next', false, true);
}

it('preserves the absent-port capture result and blob-before-acknowledgment ordering without reading app version', async () => {
  const { host, params, putBlob, pixels } = await receiptSession();
  const order: string[] = [];
  let entered!: () => void, finish!: (value: boolean) => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  putBlob.mockImplementation(() => { order.push('blob'); entered(); return new Promise(resolve => { finish = resolve; }); });
  const pending = host.call('capture', params).then(result => { order.push('ack'); return result; });
  await started;
  expect(order).toEqual(['blob']); expect(app.getVersion).not.toHaveBeenCalled();
  finish(true);
  const result = await pending;
  expect(result).toEqual({ ok: true, value: {
    captureId: expect.any(String), sessionId: params.sessionId, versionId: openParams.versionId, generation: params.expectedGeneration,
    route: '/', state: '', viewport: openParams.viewport, scroll: { x: 0, y: 0 }, contentSize: { w: 390, h: 844 },
    captureDigest: expect.stringMatching(/^sha256:[0-9a-f]{64}$/u), capturedAt: expect.any(String),
  } });
  expect(order).toEqual(['blob', 'ack']); expect(putBlob).toHaveBeenCalledOnce(); expect(app.getVersion).not.toHaveBeenCalled();
  const captureId = (result as { ok: true; value: { captureId: string } }).value.captureId;
  expect(await host.call('image', { captureId })).toEqual({ ok: true, value: `data:image/png;base64,${pixels.data}` });
  expect(receiptStats()).toMatchObject({ blobWrites: 1, receiptOrphans: 0 });
});

it('awaits blob then receipt before acknowledging or caching the accepted viewport capture', async () => {
  const order: string[] = [];
  let entered!: () => void, finish!: (value: boolean) => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  const persistReceipt = vi.fn(async (_receipt: Readonly<Record<string, unknown>>) => {
    order.push('receipt'); entered(); return await new Promise<boolean>(resolve => { finish = resolve; });
  });
  const { host, params, putBlob, pixels } = await receiptSession({ persistReceipt });
  vi.setSystemTime(new Date('2026-11-13T12:00:00.000Z'));
  putBlob.mockImplementation(async () => { order.push('blob'); vi.setSystemTime(new Date('2026-11-13T12:00:01.000Z')); return true; });
  const pending = host.call('capture', params).then(result => { order.push('ack'); return result; });
  await started;
  const receipt = persistReceipt.mock.calls[0][0];
  expect(order).toEqual(['blob', 'receipt']); expect(app.getVersion).toHaveBeenCalledOnce();
  expect(receipt).toMatchObject({
    producer: { appVersion: '0.1.0-synthetic', packaged: false, mode: 'qualification' },
    host: { sessionId: params.sessionId, hostVersionId: openParams.versionId, generation: params.expectedGeneration },
    image: { byteLength: Buffer.from(pixels.data, 'base64').length, pixelWidth: 1170, pixelHeight: 2532 },
    imageRectCss: { x: 0, y: 0, width: 390, height: 844 },
    time: { capturedAt: '2026-11-13T12:00:00.000Z', basis: 'host-clock-after-coherence-before-persist', acquisition: null },
    persistedAt: '2026-11-13T12:00:01.000Z', fixture: { state: 'unknown', attestedBy: null },
  });
  expect(await host.call('image', { captureId: receipt.captureId })).toEqual({ ok: false, kind: 'unavailable' });
  finish(true);
  expect(await pending).toMatchObject({ ok: true, value: { captureId: receipt.captureId } });
  expect(order).toEqual(['blob', 'receipt', 'ack']); expect(putBlob).toHaveBeenCalledOnce(); expect(persistReceipt).toHaveBeenCalledOnce();
  expect(await host.call('image', { captureId: receipt.captureId })).toEqual({ ok: true, value: `data:image/png;base64,${pixels.data}` });
  expect(receiptStats()).toMatchObject({ blobWrites: 1, receiptOrphans: 0 });
});

it('does not build or persist a receipt when the blob is refused', async () => {
  const persistReceipt = vi.fn(async (_receipt: Readonly<Record<string, unknown>>) => true);
  const { host, params, putBlob } = await receiptSession({ persistReceipt });
  putBlob.mockResolvedValue(false);
  expect(await host.call('capture', params)).toEqual({ ok: false, kind: 'unavailable', reason: 'storage' });
  expect(putBlob).toHaveBeenCalledOnce(); expect(persistReceipt).not.toHaveBeenCalled(); expect(app.getVersion).not.toHaveBeenCalled();
  expect(receiptStats()).toMatchObject({ blobWrites: 0, receiptOrphans: 0 });
});

it.each(['false', 'throw'])('reports receipt %s as storage failure with one explicit blob orphan and no saved capture', async failure => {
  const persistReceipt = vi.fn(async (_receipt: Readonly<Record<string, unknown>>) => {
    if (failure === 'throw') throw new Error('Synthetic receipt refusal');
    return false;
  });
  const { host, params, putBlob } = await receiptSession({ persistReceipt });
  expect(await host.call('capture', params)).toEqual({ ok: false, kind: 'unavailable', reason: 'storage' });
  const receipt = persistReceipt.mock.calls[0][0];
  expect(await host.call('image', { captureId: receipt.captureId })).toEqual({ ok: false, kind: 'unavailable' });
  expect(await host.call('events', { sessionId: params.sessionId, after: 0 })).toEqual({ ok: true, value: { after: 0, events: [] } });
  expect(await host.call('status', { sessionId: params.sessionId })).toMatchObject({ ok: true });
  expect(putBlob).toHaveBeenCalledOnce(); expect(persistReceipt).toHaveBeenCalledOnce();
  expect(receiptStats()).toMatchObject({ blobWrites: 1, receiptOrphans: 1 });
});

it.each(['navigation', 'closing'])('keeps absent-port behavior when %s happens during the existing blob write', async fence => {
  const { host, contents, params, putBlob } = await receiptSession();
  let entered!: () => void, finish!: (value: boolean) => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  putBlob.mockImplementation(() => { entered(); return new Promise(resolve => { finish = resolve; }); });
  const pending = host.call('capture', params); await started;
  if (fence === 'navigation') navigateDuringPersistence(contents);
  else await host.call('close', { sessionId: params.sessionId });
  finish(true);
  expect(await pending).toMatchObject({ ok: true, value: { generation: params.expectedGeneration } });
  expect(putBlob).toHaveBeenCalledOnce(); expect(app.getVersion).not.toHaveBeenCalled();
});

it.each(['navigation', 'closing'])('does not call the injected receipt port after %s during blob persistence', async fence => {
  const persistReceipt = vi.fn(async (_receipt: Readonly<Record<string, unknown>>) => true);
  const { host, contents, params, putBlob } = await receiptSession({ persistReceipt });
  let entered!: () => void, finish!: (value: boolean) => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  putBlob.mockImplementation(() => { entered(); return new Promise(resolve => { finish = resolve; }); });
  const pending = host.call('capture', params); await started;
  if (fence === 'navigation') navigateDuringPersistence(contents);
  else await host.call('close', { sessionId: params.sessionId });
  finish(true);
  expect(await pending).toEqual({ ok: false, kind: 'stale', reason: 'navigation' });
  expect(putBlob).toHaveBeenCalledOnce(); expect(persistReceipt).not.toHaveBeenCalled(); expect(app.getVersion).not.toHaveBeenCalled();
  expect(receiptStats()).toMatchObject({ blobWrites: 1, receiptOrphans: 1 });
});

it.each(['navigation', 'closing'])('writes neither blob nor receipt after %s before coherence finishes', async fence => {
  const persistReceipt = vi.fn(async (_receipt: Readonly<Record<string, unknown>>) => true);
  const { host, contents, params, putBlob } = await receiptSession({ persistReceipt });
  qualification().pauseAt('post-read');
  const pending = host.call('capture', params);
  try {
    await qualification().waitForPause();
    if (fence === 'navigation') navigateDuringPersistence(contents);
    else await host.call('close', { sessionId: params.sessionId });
  } finally { qualification().resume(); qualification().pauseAt(null); }
  expect(await pending).toEqual({ ok: false, kind: 'stale', reason: 'navigation' });
  expect(putBlob).not.toHaveBeenCalled(); expect(persistReceipt).not.toHaveBeenCalled(); expect(app.getVersion).not.toHaveBeenCalled();
  expect(receiptStats()).toMatchObject({ blobWrites: 0, receiptOrphans: 0 });
});

it.each(['navigation', 'closing'])('does not acknowledge a capture after %s while its receipt is already in flight', async fence => {
  let entered!: () => void, finish!: (value: boolean) => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  const persistReceipt = vi.fn((_receipt: Readonly<Record<string, unknown>>) => { entered(); return new Promise<boolean>(resolve => { finish = resolve; }); });
  const { host, contents, params, putBlob } = await receiptSession({ persistReceipt });
  const pending = host.call('capture', params); await started;
  if (fence === 'navigation') navigateDuringPersistence(contents);
  else await host.call('close', { sessionId: params.sessionId });
  finish(true);
  expect(await pending).toEqual({ ok: false, kind: 'stale', reason: 'navigation' });
  expect(await host.call('image', { captureId: persistReceipt.mock.calls[0][0].captureId })).toEqual({ ok: false, kind: 'unavailable' });
  expect(putBlob).toHaveBeenCalledOnce(); expect(persistReceipt).toHaveBeenCalledOnce();
  expect(receiptStats()).toMatchObject({ blobWrites: 1, receiptOrphans: 0 });
});

// These fixtures execute the host's isolated-world expressions; they model no native rendering or attestation.
function eventTarget() {
  const listeners = new Map<string, Set<() => void>>();
  return {
    addEventListener(event: string, listener: () => void) { if (!listeners.has(event)) listeners.set(event, new Set()); listeners.get(event)!.add(listener); },
    removeEventListener(event: string, listener: () => void) { listeners.get(event)?.delete(listener); },
    dispatch(event: string) { for (const listener of listeners.get(event) ?? []) listener(); },
    count() { return [...listeners.values()].reduce((count, values) => count + values.size, 0); },
  };
}
type FakeProbe = { token: number; remove(): void; [key: string]: unknown };
function fullPageModel(native: ReturnType<typeof fixture>, viewport: typeof openParams.viewport, extent = { w: viewport.w, h: viewport.h * 2 }) {
  const windowEvents = eventTarget(), visualViewport = eventTarget(), commands: string[] = [];
  const state = { viewport: { ...viewport }, scroll: { x: 0, y: 0 }, extent, mutationCounter: 0,
    results: [] as { found: boolean; identity?: string; text?: string; rects?: unknown[] }[], events: [] as unknown[],
    animations: [] as { playState: string }[], fonts: { status: 'loaded' }, images: [{ complete: true }], hidden: false };
  const window = { ...windowEvents, visualViewport, __hqPreviewCaptureSequence: 0, __hqPreviewFullProbe: undefined as FakeProbe | undefined,
    __hqPreviewAgentHostV1: { drain: () => state.events.splice(0), agent: {
      setHighlightHidden(value: boolean) { state.hidden = value; },
      resolveExact() { return { mutationCounter: state.mutationCounter, frame: { viewport: state.viewport, scroll: state.scroll }, results: state.results }; },
    } } };
  const sandbox = { window, document: { documentElement: { get scrollWidth() { return state.extent.w; }, get scrollHeight() { return state.extent.h; } },
    getAnimations: () => state.animations, fonts: state.fonts, images: state.images } };
  let reads = 0, shots = 0, scale = 1, widget = { width: native.view.getBounds().width, height: native.view.getBounds().height };
  let cachedKey = '', cachedData = '';
  const model = { state, window, visualViewport, commands, beforeRead: (_index: number) => {}, beforeShot: (_index: number) => {},
    mapReading: (value: unknown, _index: number): unknown => value, byteLength: 28, widthDelta: 0, unstable: false,
    get reads() { return reads; }, get shots() { return shots; }, get widget() { return widget; }, get scale() { return scale; },
    listenerCount: () => windowEvents.count() + visualViewport.count() };
  native.contents.executeJavaScriptInIsolatedWorld.mockImplementation(async (world, scripts) => {
    expect(world).toBe(1001);
    const code = scripts[0].code, reading = code.includes('resolveExact');
    const index = reads;
    if (reading) { commands.push(`R${reads++}`); model.beforeRead(index); }
    else commands.push(code.includes('p.remove()') ? 'remove' : 'reset');
    const value: unknown = structuredClone(runInNewContext(code, sandbox));
    return reading ? model.mapReading(value, index) : value;
  });
  native.contents.debugger.sendCommand.mockImplementation(async (method, raw) => {
    const params = raw as unknown as { width: number; height: number; scale: number; clip: { width: number; height: number } };
    if (method === 'Emulation.setVisibleSize') { commands.push('size'); widget = { width: params.width, height: params.height }; return {}; }
    if (method === 'Emulation.setDeviceMetricsOverride') { commands.push('metrics'); scale = params.scale; return {}; }
    if (method !== 'Page.captureScreenshot') return {};
    commands.push(`shot${++shots}`); model.beforeShot(shots);
    const width = params.clip.width * viewport.dpr + model.widthDelta, height = params.clip.height * viewport.dpr;
    const identity = model.unstable ? shots : 0, key = `${width}/${height}/${model.byteLength}/${identity}`;
    if (cachedKey !== key) {
      const bytes = Buffer.alloc(model.byteLength); bytes.write('PNG', 1); bytes.writeUInt32BE(width, 16); bytes.writeUInt32BE(height, 20); bytes.writeUInt32BE(identity, 24);
      cachedKey = key; cachedData = bytes.toString('base64');
    }
    return { data: cachedData };
  });
  return model;
}
async function fullSession(options: { viewport?: typeof openParams.viewport; displayFactor?: number; persistReceipt?: NonNullable<Parameters<typeof fixture>[1]>['persistReceipt'] } = {}) {
  vi.useFakeTimers();
  fake.displayFactor = options.displayFactor ?? 1;
  const native = fixture(undefined, { persistReceipt: options.persistReceipt }, 'full');
  const viewport = options.viewport ?? { w: 390, h: 844, dpr: 1 };
  const opened = await native.host.call('open', { ...openParams, viewport }) as { ok: true; value: { sessionId: string; generation: number } };
  const page = fullPageModel(native, viewport);
  const params = { sessionId: opened.value.sessionId, expectedGeneration: opened.value.generation };
  return { ...native, viewport, page, params };
}

it('keeps omitted mode and explicit viewport byte-identical even when the fake qualifies the host', async () => {
  const observed: unknown[] = [];
  for (const mode of [undefined, 'viewport'] as const) {
    const native = fixture(undefined, {}, mode);
    const opened = await native.host.call('open', openParams) as { ok: true; value: { sessionId: string; generation: number } };
    captureFixture(native.contents);
    const result = await native.host.call('capture', { sessionId: opened.value.sessionId, expectedGeneration: opened.value.generation });
    expect(result).toMatchObject({ ok: true });
    const shots = native.contents.debugger.sendCommand.mock.calls.filter(([method]) => method === 'Page.captureScreenshot');
    expect(shots).toHaveLength(2);
    expect(shots[0][1]).toEqual({ format: 'png', fromSurface: true, captureBeyondViewport: false, clip: { x: 0, y: 0, width: 390, height: 844, scale: 1 } });
    expect(native.contents.executeJavaScriptInIsolatedWorld.mock.calls.some(([, scripts]) => scripts[0].code.includes('__hqPreviewFullProbe'))).toBe(false);
    observed.push(shots);
  }
  expect(observed[0]).toEqual(observed[1]);
});

it.each([1, 2, 3].flatMap(dpr => [1, 2, 1.25].map(displayFactor => ({ dpr, displayFactor }))))('uses unchanged viewport metrics and full held geometry at $dpr DPR / $displayFactor display factor', async ({ dpr, displayFactor }) => {
  const { host, contents, view, putBlob, page, params, viewport } = await fullSession({ viewport: { w: 390, h: 844, dpr }, displayFactor });
  const placed = view.setBounds.mock.calls.length;
  expect(await host.call('capture', params)).toMatchObject({ ok: true, value: { viewport, scroll: { x: 0, y: 0 }, contentSize: { w: 390, h: 1688 } } });
  expect(page.commands).toEqual(['R0', 'size', 'metrics', 'R1', 'shot1', 'shot2', 'R2', 'size', 'metrics', 'R3', 'remove', 'reset']);
  expect(page.reads).toBe(4); expect(page.shots).toBe(2); expect(putBlob).toHaveBeenCalledOnce();
  expect(view.setBounds.mock.calls.length).toBe(placed);
  expect(widgetSizes(contents).slice(-2)).toEqual([{ width: Math.round(390 * dpr / displayFactor), height: Math.round(1688 * dpr / displayFactor) }, { width: 390, height: 844 }]);
  expect(metrics(contents).slice(-2).map(value => value.scale)).toEqual([dpr / displayFactor, 1]);
  for (const value of metrics(contents)) expect(value).toMatchObject({ width: 390, height: 844, deviceScaleFactor: dpr, mobile: false, dontSetVisibleSize: true });
  for (const [, value] of contents.debugger.sendCommand.mock.calls.filter(([method]) => method === 'Page.captureScreenshot')) {
    expect(value).toEqual({ format: 'png', fromSurface: true, captureBeyondViewport: true, clip: { x: 0, y: 0, width: 390, height: 1688, scale: 1 } });
  }
  expect(page.window.__hqPreviewFullProbe).toBeUndefined(); expect(page.listenerCount()).toBe(0); expect(page.state.hidden).toBe(false);
  expect(page.window.__hqPreviewCaptureSequence).toBe(1.5);
});

it.each([
  { reason: 'scroll-origin', change: (page: ReturnType<typeof fullPageModel>) => { page.state.scroll.y = 1; } },
  { reason: 'horizontal-extent', change: (page: ReturnType<typeof fullPageModel>) => { page.state.extent.w++; } },
  { reason: 'extent-oversize', change: (page: ReturnType<typeof fullPageModel>) => { page.state.extent.h = 16385; } },
  { reason: 'extent-oversize', change: (page: ReturnType<typeof fullPageModel>) => { page.state.extent.h = 1688.5; } },
  { reason: 'extent-changed', change: (page: ReturnType<typeof fullPageModel>) => { page.state.extent.h = 843; } },
  { reason: 'dpr', change: (page: ReturnType<typeof fullPageModel>) => { page.state.viewport.dpr = 4; } },
])('refuses the $reason plan before any hold, screenshot or durable write', async ({ reason, change }) => {
  const persistReceipt = vi.fn(async () => true);
  const { host, page, params, putBlob, contents } = await fullSession({ persistReceipt });
  change(page);
  const sized = widgetSizes(contents).length;
  expect(await host.call('capture', params)).toEqual({ ok: false, kind: 'stale', reason });
  expect(widgetSizes(contents)).toHaveLength(sized); expect(page.shots).toBe(0); expect(page.reads).toBe(1);
  expect(putBlob).not.toHaveBeenCalled(); expect(persistReceipt).not.toHaveBeenCalled();
  expect(page.listenerCount()).toBe(0); expect(page.state.hidden).toBe(false);
});

it('enforces the full device-area bound independently of its edge bound', async () => {
  const { host, page, params, putBlob } = await fullSession({ viewport: { w: 4096, h: 844, dpr: 1 } });
  page.state.extent.h = 8193;
  expect(await host.call('capture', params)).toEqual({ ok: false, kind: 'stale', reason: 'extent-oversize' });
  expect(page.shots).toBe(0); expect(putBlob).not.toHaveBeenCalled(); expect(page.listenerCount()).toBe(0);
});

it.each(['window-resize', 'visual-resize', 'window-scroll', 'visual-scroll'] as const)('observes actual %s listeners through restoration and refuses transient events', async event => {
  const persistReceipt = vi.fn(async () => true);
  const { host, page, params, putBlob } = await fullSession({ persistReceipt });
  page.beforeRead = index => {
    if (index !== 3) return;
    const target = event.startsWith('window') ? page.window : page.visualViewport;
    target.dispatch(event.endsWith('resize') ? 'resize' : 'scroll');
  };
  expect(await host.call('capture', params)).toEqual({ ok: false, kind: 'stale', reason: event.endsWith('resize') ? 'layout-resized' : 'scroll' });
  expect(page.reads).toBe(4); expect(page.shots).toBe(2); expect(page.listenerCount()).toBe(0);
  expect(putBlob).not.toHaveBeenCalled(); expect(persistReceipt).not.toHaveBeenCalled();
});

it.each([0, 2])('reads animations, fonts and images from the actual probe at R%s before storage', async index => {
  for (const reason of ['animating', 'fonts-pending', 'media-pending'] as const) {
    const persistReceipt = vi.fn(async () => true);
    const { host, page, params, putBlob } = await fullSession({ persistReceipt });
    page.beforeRead = reading => {
      page.state.animations.length = 0; page.state.fonts.status = 'loaded'; page.state.images[0].complete = true;
      if (reading !== index) return;
      if (reason === 'animating') page.state.animations.push({ playState: 'running' });
      if (reason === 'fonts-pending') page.state.fonts.status = 'loading';
      if (reason === 'media-pending') page.state.images[0].complete = false;
    };
    expect(await host.call('capture', params)).toEqual({ ok: false, kind: 'stale', reason });
    expect(putBlob).not.toHaveBeenCalled(); expect(persistReceipt).not.toHaveBeenCalled(); expect(page.listenerCount()).toBe(0);
  }
});

it('uses R3 readiness only for its retained event counters', async () => {
  const { host, page, params } = await fullSession();
  page.beforeRead = index => { if (index === 3) { page.state.fonts.status = 'loading'; page.state.images[0].complete = false; page.state.animations.push({ playState: 'running' }); } };
  expect(await host.call('capture', params)).toMatchObject({ ok: true });
});

it.each([1, 2, 3])('includes R%s in extent, viewport, mutation and scroll coherence', async index => {
  for (const reason of ['extent-changed', 'dpr', 'mutation', 'scroll'] as const) {
    const { host, page, params, putBlob } = await fullSession();
    page.beforeRead = reading => {
      if (reading !== index) return;
      if (reason === 'extent-changed') page.state.extent.h++;
      if (reason === 'dpr') page.state.viewport.h++;
      if (reason === 'mutation') page.state.mutationCounter++;
      if (reason === 'scroll') page.state.scroll.y++;
    };
    expect(await host.call('capture', params)).toEqual({ ok: false, kind: 'stale', reason });
    expect(putBlob).not.toHaveBeenCalled(); expect(page.listenerCount()).toBe(0);
  }
});

it.each([1, 2, 3])('refuses changed exact mark results at R%s through the full-mode drain', async index => {
  vi.useFakeTimers();
  const native = fixture(undefined, {}, 'full'), viewport = { w: 390, h: 844, dpr: 1 };
  const opened = await native.host.call('open', { ...openParams, viewport }) as { ok: true; value: { sessionId: string; generation: number } };
  const { sessionId, generation } = opened.value;
  await native.host.call('place', { sessionId, rect: { x: 0, y: 0, width: 390, height: 844 }, visible: true });
  await native.host.call('mode', { sessionId, generation, mode: 'pick' });
  const page = fullPageModel(native, viewport), rect = { x: 10, y: 10, width: 100, height: 20 };
  page.state.results.push({ found: true, identity: 'h1', text: 'Heading', rects: [rect] });
  page.state.events.push({ type: 'element-picked', target: { kind: 'element', path: 'body > h1', rect }, generation,
    frame: { viewport, scroll: { x: 0, y: 0 } }, snapshot: { identity: 'h1', text: 'Heading', rects: [rect] } });
  page.beforeRead = reading => { if (reading === index) page.state.results[0].identity = 'changed-heading'; };
  await vi.advanceTimersByTimeAsync(100);
  expect(await native.host.call('status', { sessionId })).toEqual({ ok: false, kind: 'stale', reason: 'mark-target-changed' });
  expect(native.putBlob).not.toHaveBeenCalled(); expect(page.reads).toBe(4); expect(page.listenerCount()).toBe(0);
});

it.each(['missing', 'negative', 'fractional', 'infinite', 'fonts', 'images', 'extra'] as const)('fails closed on %s stability output from an executed probe', async invalid => {
  const { host, page, params, putBlob } = await fullSession();
  page.mapReading = (value, index) => {
    if (index !== 2) return value;
    const output = value as { stability?: Record<string, unknown> };
    if (invalid === 'missing') delete output.stability;
    else if (invalid === 'fonts') output.stability!.fontsStatus = 'unknown';
    else if (invalid === 'images') output.stability!.imagesComplete = 1;
    else if (invalid === 'extra') output.stability!.extra = 0;
    else output.stability!.windowResizeEvents = invalid === 'negative' ? -1 : invalid === 'fractional' ? 0.5 : Infinity;
    return output;
  };
  expect(await host.call('capture', params)).toEqual({ ok: false, kind: 'unavailable', reason: 'capture-failed' });
  expect(putBlob).not.toHaveBeenCalled(); expect(page.listenerCount()).toBe(0);
});

it('refuses a missing owned probe rather than substituting stable counters', async () => {
  const { host, page, params, putBlob } = await fullSession();
  page.beforeRead = index => { if (index === 1) page.window.__hqPreviewFullProbe!.remove(); };
  expect(await host.call('capture', params)).toEqual({ ok: false, kind: 'unavailable', reason: 'capture-failed' });
  expect(page.shots).toBe(0); expect(putBlob).not.toHaveBeenCalled(); expect(page.listenerCount()).toBe(0);
});

it.each([0, 2, 3])('validates every stability field at S%s rather than trusting a claimed stable record', async index => {
  for (const key of ['windowResizeEvents', 'visualViewportResizeEvents', 'windowScrollEvents', 'visualViewportScrollEvents', 'runningAnimations', 'fontsStatus', 'imagesComplete']) {
    const { host, page, params, putBlob } = await fullSession();
    page.mapReading = (value, reading) => {
      if (reading === index) (value as { stability: Record<string, unknown> }).stability[key] = undefined;
      return value;
    };
    expect(await host.call('capture', params), key).toEqual({ ok: false, kind: 'unavailable', reason: 'capture-failed' });
    expect(putBlob).not.toHaveBeenCalled(); expect(page.listenerCount()).toBe(0);
  }
});

it('detects hold-time events even when viewport geometry later returns to its original values', async () => {
  const { host, contents, page, params, putBlob } = await fullSession();
  const ordinary = contents.debugger.sendCommand.getMockImplementation()!;
  contents.debugger.sendCommand.mockImplementation(async (method, params) => {
    const value = await ordinary(method, params);
    if (method === 'Emulation.setDeviceMetricsOverride' && page.reads === 1) page.visualViewport.dispatch('resize');
    return value;
  });
  expect(await host.call('capture', params)).toEqual({ ok: false, kind: 'stale', reason: 'layout-resized' });
  expect(page.state.viewport).toEqual({ w: 390, h: 844, dpr: 1 }); expect(putBlob).not.toHaveBeenCalled(); expect(page.listenerCount()).toBe(0);
});

it.each(['dpr', 'pixels-unstable', 'bytes-oversize'] as const)('refuses full pixels as %s with no persistence or retry', async reason => {
  const { host, page, params, putBlob } = await fullSession();
  if (reason === 'dpr') page.widthDelta = 1;
  if (reason === 'pixels-unstable') page.unstable = true;
  if (reason === 'bytes-oversize') page.byteLength = 12 * 1024 * 1024 + 1;
  expect(await host.call('capture', params)).toEqual({ ok: false, kind: 'stale', reason });
  expect(page.shots).toBe(reason === 'bytes-oversize' ? 1 : 2); expect(putBlob).not.toHaveBeenCalled(); expect(page.listenerCount()).toBe(0);
});

it('requires exact full dimensions from the second screenshot as well as the first', async () => {
  const { host, page, params, putBlob } = await fullSession();
  page.beforeShot = index => { if (index === 2) page.widthDelta = 1; };
  expect(await host.call('capture', params)).toEqual({ ok: false, kind: 'stale', reason: 'dpr' });
  expect(page.shots).toBe(2); expect(putBlob).not.toHaveBeenCalled(); expect(page.listenerCount()).toBe(0);
});

it('accepts the exact PNG/base64 size limits and records truthful full geometry before acknowledgment', async () => {
  const order: string[] = [];
  let entered!: () => void, finish!: (saved: boolean) => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  const persistReceipt = vi.fn((_receipt: Readonly<Record<string, unknown>>) => { order.push('receipt'); entered(); return new Promise<boolean>(resolve => { finish = resolve; }); });
  const { host, page, params, putBlob, viewport } = await fullSession({ persistReceipt, viewport: { w: 390, h: 844, dpr: 3 } });
  page.byteLength = 12 * 1024 * 1024;
  putBlob.mockImplementation(async () => { order.push('blob'); return true; });
  const pending = host.call('capture', params).then(result => { order.push('ack'); return result; });
  await started;
  const receipt = persistReceipt.mock.calls[0][0];
  expect(order).toEqual(['blob', 'receipt']); expect(page.reads).toBe(4); expect(page.shots).toBe(2);
  expect(receipt).toMatchObject({ viewport, pageExtentCss: { width: 390, height: 1688 }, imageRectCss: { x: 0, y: 0, width: 390, height: 1688 },
    image: { byteLength: 12 * 1024 * 1024, pixelWidth: 1170, pixelHeight: 5064 }, fixture: { state: 'unknown', attestedBy: null }, time: { acquisition: null } });
  expect(await host.call('image', { captureId: receipt.captureId })).toEqual({ ok: false, kind: 'unavailable' });
  finish(true);
  expect(await pending).toMatchObject({ ok: true, value: { captureId: receipt.captureId } });
  expect(order).toEqual(['blob', 'receipt', 'ack']); expect(putBlob).toHaveBeenCalledOnce(); expect(persistReceipt).toHaveBeenCalledOnce();
  expect(await host.call('image', { captureId: receipt.captureId })).toMatchObject({ ok: true });
  expect(receiptStats()).toMatchObject({ blobWrites: 1, receiptOrphans: 0 });
});

it.each(['false', 'throw'] as const)('keeps full receipt %s outcomes as one orphan without acknowledgment or replay', async failure => {
  const persistReceipt = vi.fn(async (_receipt: Readonly<Record<string, unknown>>) => { if (failure === 'throw') throw Error('Synthetic unknown write'); return false; });
  const { host, params, putBlob } = await fullSession({ persistReceipt });
  expect(await host.call('capture', params)).toEqual({ ok: false, kind: 'unavailable', reason: 'storage' });
  expect(putBlob).toHaveBeenCalledOnce(); expect(persistReceipt).toHaveBeenCalledOnce();
  expect(await host.call('image', { captureId: persistReceipt.mock.calls[0][0].captureId })).toEqual({ ok: false, kind: 'unavailable' });
  expect(receiptStats()).toMatchObject({ blobWrites: 1, receiptOrphans: 1 });
});

it.each(['navigation', 'closing'] as const)('fences %s after every full acquisition await before another acquisition operation', async fence => {
  // Includes each metrics send inside restoration, all four reads, and both screenshots.
  for (const stage of ['R0', 'size1', 'metrics1', 'R1', 'shot1', 'shot2', 'R2', 'size2', 'metrics2', 'R3', 'remove', 'reset']) {
    const persistReceipt = vi.fn(async () => true);
    const native = await fullSession({ persistReceipt });
    const { host, contents, params, putBlob, page } = native;
    const invalidate = async () => { if (fence === 'navigation') navigateDuringPersistence(contents); else await host.call('close', { sessionId: params.sessionId }); };
    let touched = false, sizes = 0, emulations = 0;
    const world = contents.executeJavaScriptInIsolatedWorld.getMockImplementation()!;
    contents.executeJavaScriptInIsolatedWorld.mockImplementation(async (id, scripts) => {
      const code = scripts[0].code;
      const label = code.includes('resolveExact') ? `R${page.reads}` : code.includes('p.remove()') ? 'remove' : 'reset';
      const value = await world(id, scripts);
      if (!touched && label === stage) { touched = true; await invalidate(); }
      return value;
    });
    const command = contents.debugger.sendCommand.getMockImplementation()!;
    contents.debugger.sendCommand.mockImplementation(async (method, params) => {
      const label = method === 'Emulation.setVisibleSize' ? `size${++sizes}` : method === 'Emulation.setDeviceMetricsOverride' ? `metrics${++emulations}` : `shot${page.shots + 1}`;
      const value = await command(method, params);
      if (!touched && label === stage) { touched = true; await invalidate(); }
      return value;
    });
    expect(await host.call('capture', params), `${fence} at ${stage}`).toEqual({ ok: false, kind: 'stale', reason: 'navigation' });
    expect(touched, stage).toBe(true); expect(putBlob).not.toHaveBeenCalled(); expect(persistReceipt).not.toHaveBeenCalled();
    if (fence === 'navigation') expect(page.listenerCount()).toBe(0);
    if (stage === 'size1') expect(page.shots).toBe(0);
    if (stage === 'shot1') expect(page.shots).toBe(1);
    if (stage === 'size2') expect(page.reads).toBe(3);
  }
});

it.each(['blob', 'receipt'] as const)('keeps full persistence ordering and navigation orphan accounting at %s', async stage => {
  let entered!: () => void, finish!: (saved: boolean) => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  const persistReceipt = vi.fn(async (_receipt: Readonly<Record<string, unknown>>) => {
    if (stage === 'receipt') { entered(); return await new Promise<boolean>(resolve => { finish = resolve; }); }
    return true;
  });
  const { host, contents, params, putBlob } = await fullSession({ persistReceipt });
  if (stage === 'blob') putBlob.mockImplementation(() => { entered(); return new Promise<boolean>(resolve => { finish = resolve; }); });
  const pending = host.call('capture', params); await started;
  navigateDuringPersistence(contents); finish(true);
  expect(await pending).toEqual({ ok: false, kind: 'stale', reason: 'navigation' });
  expect(putBlob).toHaveBeenCalledOnce(); expect(persistReceipt).toHaveBeenCalledTimes(stage === 'blob' ? 0 : 1);
  expect(receiptStats()).toMatchObject({ blobWrites: 1, receiptOrphans: stage === 'blob' ? 1 : 0 });
});

it('restores and removes the probe after a full screenshot exception without automatic retry', async () => {
  const { host, contents, params, page, putBlob } = await fullSession();
  const ordinary = contents.debugger.sendCommand.getMockImplementation()!;
  contents.debugger.sendCommand.mockImplementation((method, params) => method === 'Page.captureScreenshot' && page.shots === 1 ? Promise.reject(Error('Synthetic screenshot failure')) : ordinary(method, params));
  expect(await host.call('capture', params)).toEqual({ ok: false, kind: 'unavailable', reason: 'capture-failed' });
  expect(page.shots).toBe(1); expect(page.widget).toEqual({ width: 390, height: 844 }); expect(page.scale).toBe(1);
  expect(page.listenerCount()).toBe(0); expect(page.state.hidden).toBe(false); expect(putBlob).not.toHaveBeenCalled();
});

it('bounds full acquisition by ten seconds across individually bounded reads and screenshots', async () => {
  const { host, contents, params, page, putBlob } = await fullSession();
  const world = contents.executeJavaScriptInIsolatedWorld.getMockImplementation()!, command = contents.debugger.sendCommand.getMockImplementation()!;
  contents.executeJavaScriptInIsolatedWorld.mockImplementation(async (id, scripts) => {
    if (scripts[0].code.includes('resolveExact')) await new Promise(resolve => setTimeout(resolve, 2400));
    return await world(id, scripts);
  });
  contents.debugger.sendCommand.mockImplementation(async (method, params) => {
    if (method === 'Page.captureScreenshot') await new Promise(resolve => setTimeout(resolve, 500));
    return await command(method, params);
  });
  const start = Date.now(), settled = vi.fn();
  void host.call('capture', params).then(result => settled({ result, elapsed: Date.now() - start }));
  await vi.advanceTimersByTimeAsync(10000);
  expect(settled).toHaveBeenCalledWith({ result: { ok: false, kind: 'unavailable', reason: 'capture-timeout' }, elapsed: 10000 });
  expect(page.shots).toBe(2); expect(putBlob).not.toHaveBeenCalled(); expect(page.listenerCount()).toBe(0);
  await vi.advanceTimersByTimeAsync(1000);
  expect(page.listenerCount()).toBe(0); expect(putBlob).not.toHaveBeenCalled();
});

it('expires a late full R0 expression, releases the queue, and cannot reinstall its listeners', async () => {
  const { host, contents, params, page, putBlob } = await fullSession();
  let release!: () => void, first = true;
  const ordinary = contents.executeJavaScriptInIsolatedWorld.getMockImplementation()!;
  contents.executeJavaScriptInIsolatedWorld.mockImplementation(async (id, scripts) => {
    if (first && scripts[0].code.includes('resolveExact')) { first = false; await new Promise<void>(resolve => { release = resolve; }); }
    return await ordinary(id, scripts);
  });
  const stalled = host.call('capture', params), queued = host.call('capture', params);
  await vi.advanceTimersByTimeAsync(3000);
  expect(await stalled).toEqual({ ok: false, kind: 'unavailable', reason: 'capture-timeout' });
  expect(await queued).toMatchObject({ ok: true }); expect(putBlob).toHaveBeenCalledOnce();
  release(); await vi.advanceTimersByTimeAsync(0);
  expect(page.window.__hqPreviewCaptureSequence).toBe(2.5); expect(page.window.__hqPreviewFullProbe).toBeUndefined();
  expect(page.listenerCount()).toBe(0); expect(page.state.hidden).toBe(false); expect(putBlob).toHaveBeenCalledOnce();
});

it('bounds a delayed probe removal and prevents its late callback from removing a new attempt', async () => {
  const { host, contents, params, page, putBlob } = await fullSession();
  let release!: () => void, first = true;
  const ordinary = contents.executeJavaScriptInIsolatedWorld.getMockImplementation()!;
  contents.executeJavaScriptInIsolatedWorld.mockImplementation(async (id, scripts) => {
    if (first && scripts[0].code.includes('p.remove()')) { first = false; await new Promise<void>(resolve => { release = resolve; }); }
    return await ordinary(id, scripts);
  });
  const stalled = host.call('capture', params);
  await vi.advanceTimersByTimeAsync(1000);
  expect(await stalled).toEqual({ ok: false, kind: 'unavailable', reason: 'capture-timeout' });
  expect(putBlob).not.toHaveBeenCalled();
  qualification().pauseAt('first-capture');
  const queued = host.call('capture', params);
  try {
    await qualification().waitForPause();
    const current = page.window.__hqPreviewFullProbe;
    expect(current?.token).toBe(2); expect(page.listenerCount()).toBe(4);
    release(); await vi.advanceTimersByTimeAsync(0);
    expect(page.window.__hqPreviewFullProbe).toBe(current); expect(page.listenerCount()).toBe(4); expect(page.state.hidden).toBe(true);
    page.visualViewport.dispatch('resize'); expect(current?.visualViewportResizeEvents).toBe(1);
  } finally { qualification().resume(); qualification().pauseAt(null); }
  expect(await queued).toEqual({ ok: false, kind: 'stale', reason: 'layout-resized' });
  expect(page.listenerCount()).toBe(0); expect(putBlob).not.toHaveBeenCalled();
});

it('keeps a retained old probe remover limited to its own four listeners', async () => {
  const { host, page, params } = await fullSession();
  let old: FakeProbe | undefined;
  page.beforeShot = () => { old ??= page.window.__hqPreviewFullProbe; };
  expect(await host.call('capture', params)).toMatchObject({ ok: true });
  qualification().pauseAt('first-capture');
  const pending = host.call('capture', params);
  try {
    await qualification().waitForPause();
    const current = page.window.__hqPreviewFullProbe;
    expect(current?.token).toBe(2); expect(old?.token).toBe(1);
    old!.remove();
    expect(page.window.__hqPreviewFullProbe).toBe(current); expect(page.listenerCount()).toBe(4);
    page.window.dispatch('scroll'); expect(current?.windowScrollEvents).toBe(1);
  } finally { qualification().resume(); qualification().pauseAt(null); }
  expect(await pending).toEqual({ ok: false, kind: 'stale', reason: 'scroll' }); expect(page.listenerCount()).toBe(0);
});

it('restores a timed-out full shot again on late completion and ignores its pixels', async () => {
  const { host, contents, params, page, putBlob } = await fullSession();
  let release!: () => void, second = false;
  const ordinary = contents.debugger.sendCommand.getMockImplementation()!;
  contents.debugger.sendCommand.mockImplementation((method, params) => {
    if (method === 'Page.captureScreenshot' && page.shots === 1 && !second) {
      second = true; return new Promise(resolve => { release = () => { resolve(ordinary(method, params)); }; });
    }
    return ordinary(method, params);
  });
  const stalled = host.call('capture', params);
  await vi.advanceTimersByTimeAsync(10000);
  expect(await stalled).toEqual({ ok: false, kind: 'unavailable', reason: 'capture-timeout' });
  expect(page.widget).toEqual({ width: 390, height: 844 }); expect(page.listenerCount()).toBe(0);
  const sized = widgetSizes(contents).length;
  release(); await vi.advanceTimersByTimeAsync(0);
  expect(widgetSizes(contents).slice(sized)).toEqual([{ width: 390, height: 844 }]);
  expect(page.scale).toBe(1); expect(putBlob).not.toHaveBeenCalled();
  expect(await host.call('capture', params)).toMatchObject({ ok: true }); expect(putBlob).toHaveBeenCalledOnce();
});

it('does not let an old full screenshot restorer take a newer hold', async () => {
  const { host, contents, params, page, putBlob } = await fullSession();
  let release!: () => void, second = false;
  const ordinary = contents.debugger.sendCommand.getMockImplementation()!;
  contents.debugger.sendCommand.mockImplementation((method, params) => {
    if (method === 'Page.captureScreenshot' && page.shots === 1 && !second) {
      second = true; return new Promise(resolve => { release = () => resolve(ordinary(method, params)); });
    }
    return ordinary(method, params);
  });
  const stalled = host.call('capture', params);
  await vi.advanceTimersByTimeAsync(10000);
  expect(await stalled).toEqual({ ok: false, kind: 'unavailable', reason: 'capture-timeout' });
  qualification().pauseAt('first-capture');
  const queued = host.call('capture', params);
  try {
    await qualification().waitForPause();
    const sized = widgetSizes(contents).length, current = page.window.__hqPreviewFullProbe;
    release(); await vi.advanceTimersByTimeAsync(0);
    expect(widgetSizes(contents)).toHaveLength(sized); expect(page.window.__hqPreviewFullProbe).toBe(current);
    expect(page.widget).toEqual({ width: 390, height: 1688 }); expect(page.listenerCount()).toBe(4);
  } finally { qualification().resume(); qualification().pauseAt(null); }
  expect(await queued).toMatchObject({ ok: true }); expect(putBlob).toHaveBeenCalledOnce(); expect(page.listenerCount()).toBe(0);
});

it('bounds full finally restoration to one second and fences a late restorer between its two sends', async () => {
  const { host, contents, params, page, putBlob } = await fullSession();
  let release!: () => void, sizes = 0;
  const ordinary = contents.debugger.sendCommand.getMockImplementation()!;
  contents.debugger.sendCommand.mockImplementation((method, params) => {
    if (method === 'Page.captureScreenshot') return Promise.reject(Error('Synthetic failure before finally'));
    if (method === 'Emulation.setVisibleSize' && ++sizes === 2) return new Promise(resolve => { release = () => resolve(ordinary(method, params)); });
    return ordinary(method, params);
  });
  const stalled = host.call('capture', params);
  await vi.advanceTimersByTimeAsync(1000);
  expect(await stalled).toEqual({ ok: false, kind: 'unavailable', reason: 'capture-failed' });
  expect(page.listenerCount()).toBe(0); expect(putBlob).not.toHaveBeenCalled();
  const emulated = metrics(contents).length;
  release(); await vi.advanceTimersByTimeAsync(0);
  expect(metrics(contents)).toHaveLength(emulated); expect(page.listenerCount()).toBe(0);
});

async function captureId(host: ReturnType<typeof createPreviewHost>, params: { sessionId: string; expectedGeneration: number }) {
  const result = await host.call('capture', params) as { ok: true; value: { captureId: string } };
  expect(result).toMatchObject({ ok: true }); return result.value.captureId;
}
it('evicts the actual oldest cached image at 32 entries without refreshing FIFO on reads', async () => {
  const { host, params } = await fullSession();
  const ids: string[] = [];
  for (let index = 0; index < 32; index++) ids.push(await captureId(host, params));
  expect(await host.call('image', { captureId: ids[0] })).toMatchObject({ ok: true });
  ids.push(await captureId(host, params));
  expect(await host.call('image', { captureId: ids[0] })).toEqual({ ok: false, kind: 'unavailable' });
  for (const id of ids.slice(1)) expect(await host.call('image', { captureId: id })).toMatchObject({ ok: true });
});

it('counts encoded prefixes toward 64 MiB and subtracts every byte eviction and session deletion', async () => {
  const first = await fullSession(); first.page.byteLength = 6 * 1024 * 1024;
  const firstId = await captureId(first.host, first.params);
  // A second fake native allocation is opened by the same host, so both sessions share its cache budget.
  const spare = fixture();
  const opened = await first.host.call('open', { ...openParams, viewport: first.viewport }) as { ok: true; value: { sessionId: string; generation: number } };
  const page = fullPageModel(spare, first.viewport); page.byteLength = 6 * 1024 * 1024;
  const params = { sessionId: opened.value.sessionId, expectedGeneration: opened.value.generation };
  await first.host.call('close', { sessionId: first.params.sessionId });
  expect(await first.host.call('image', { captureId: firstId })).toEqual({ ok: false, kind: 'unavailable' });
  first.putBlob.mockClear();
  const ids: string[] = [];
  for (let index = 0; index < 9; index++) {
    ids.push(await captureId(first.host, params)); first.putBlob.mockClear();
    if (index === 6) for (const id of ids) expect(await first.host.call('image', { captureId: id })).toMatchObject({ ok: true });
  }
  // Each base64 body is exactly 8 MiB. Eight prefixes exceed the budget, so exactly seven remain.
  for (const id of ids.slice(0, 2)) expect(await first.host.call('image', { captureId: id })).toEqual({ ok: false, kind: 'unavailable' });
  for (const id of ids.slice(2)) expect(await first.host.call('image', { captureId: id })).toMatchObject({ ok: true });
  await first.host.call('close', { sessionId: params.sessionId });
  for (const id of ids) expect(await first.host.call('image', { captureId: id })).toEqual({ ok: false, kind: 'unavailable' });
});

const sourceRoot = fileURLToPath(new URL('../../../../', import.meta.url));
const hostSource = join(sourceRoot, 'apps/desktop/electron/preview/host.ts');
const excludedSources = new Set(['node_modules', '.git', 'dist', 'dist-electron', 'dist-design-host', 'dist-wiki-host', 'coverage', '.cache']);
function supplierSources(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    if (entry.isSymbolicLink() || excludedSources.has(entry.name)) return [];
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return supplierSources(path);
    return entry.isFile() && /\.[cm]?[jt]sx?$/u.test(entry.name) && !/\.(?:test|spec)\.[cm]?[jt]sx?$/u.test(entry.name) ? [path] : [];
  });
}
function astNode(value: unknown): value is Node { return value !== null && typeof value === 'object' && 'type' in value && typeof value.type === 'string'; }
function visitSupplier(node: Node, visitor: (node: Node) => void) {
  visitor(node);
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) { for (const child of value) if (astNode(child)) visitSupplier(child, visitor); }
    else if (astNode(value)) visitSupplier(value, visitor);
  }
}
function astName(node: Node): string | undefined { return node.type === 'Identifier' ? node.name : node.type === 'Literal' && typeof node.value === 'string' ? node.value : undefined; }
// Deliberately a closed syntactic seam: only named imports and direct calls are supported.
// Binding escapes, namespace/re-export/dynamic suppliers and unsupported uses fail; this is not general dataflow analysis.
function constructorSuppliers(source: string, path: string) {
  const violations: string[] = [], permitted = new Set<Node>(), names = new Set(['createPreviewHost']);
  let calls = 0;
  const lang = /\.d\.[cm]?ts$/u.test(path) ? 'dts' : /\.[cm]?tsx?$/u.test(path) ? (path.endsWith('x') ? 'tsx' : 'ts') : 'jsx';
  const tree = parseAst(source, { lang, sourceType: 'unambiguous' }, path);
  const isHost = (specifier: Node) => specifier.type === 'Literal' && typeof specifier.value === 'string'
    && specifier.value.startsWith('.') && resolve(dirname(path), specifier.value.replace(/\.[cm]?[jt]sx?$/u, '')) === hostSource.slice(0, -3);
  visitSupplier(tree, node => {
    if (node.type === 'ImportDeclaration') {
      for (const specifier of node.specifiers) {
        if (specifier.type === 'ImportSpecifier' && astName(specifier.imported) === 'createPreviewHost') {
          names.add(specifier.local.name); permitted.add(specifier.imported); permitted.add(specifier.local);
          if (node.importKind === 'type' || specifier.importKind === 'type') violations.push('type supplier');
        } else if (isHost(node.source)) violations.push('unsupported host import');
      }
      if (isHost(node.source) && node.specifiers.length === 0) violations.push('side-effect host import');
    }
    if ((node.type === 'ExportNamedDeclaration' || node.type === 'ExportAllDeclaration') && node.source && isHost(node.source)) violations.push('re-export supplier');
    if (node.type === 'ImportExpression' && isHost(node.source)) violations.push('dynamic supplier');
    if (node.type === 'CallExpression' && node.callee.type === 'Identifier' && node.callee.name === 'require' && node.arguments[0] && isHost(node.arguments[0])) violations.push('require supplier');
  });
  visitSupplier(tree, node => {
    if (node.type === 'FunctionDeclaration' && node.id?.name === 'createPreviewHost' && path === hostSource) permitted.add(node.id);
    if (node.type === 'CallExpression' && node.callee.type === 'Identifier' && names.has(node.callee.name)) {
      permitted.add(node.callee); calls++;
      if (node.optional || node.arguments.length !== 1 || node.arguments.some(argument => argument.type === 'SpreadElement')) violations.push('constructor mode supplied or spread');
    }
  });
  visitSupplier(tree, node => {
    if (node.type === 'Identifier' && names.has(node.name) && !permitted.has(node)) violations.push(`unsupported factory use: ${node.name}`);
    if (node.type === 'MemberExpression' && astName(node.property) === 'createPreviewHost') violations.push('indirect member supplier');
    if (node.type === 'ExportSpecifier' && (names.has(astName(node.local) ?? '') || names.has(astName(node.exported) ?? ''))) violations.push('exported binding');
  });
  return { violations, calls };
}

it('guards the constructor supplier seam with named-alias, binding-escape and indirect-supplier negative fixtures', () => {
  const path = join(sourceRoot, 'apps/desktop/electron/supplier-fixture.ts');
  for (const source of [
    'import { createPreviewHost } from "./preview/host.js"; createPreviewHost(options);',
    'import { createPreviewHost as make } from "./preview/host.js"; make(options);',
  ]) expect(constructorSuppliers(source, path)).toEqual({ violations: [], calls: 1 });
  expect(constructorSuppliers('const documentation = "createPreviewHost(options, full)"; // createPreviewHost(...args)', path)).toEqual({ violations: [], calls: 0 });
  for (const source of [
    'createPreviewHost(options, "full");',
    'createPreviewHost(...args);',
    'createPreviewHost();',
    'import { createPreviewHost as make } from "./preview/host.js"; make(options, "full");',
    'import { createPreviewHost as make } from "./preview/host.js"; const alias = make; alias(options, "full");',
    'const alias = createPreviewHost; alias(options);',
    'register(createPreviewHost);',
    'const holder = { factory: createPreviewHost }; holder.factory(options, "full");',
    'createPreviewHost.call(null, options, "full");',
    'createPreviewHost.bind(null, options, "full");',
    'Reflect.apply(createPreviewHost, null, [options, "full"]);',
    'createPreviewHost = replacement;',
    'import * as preview from "./preview/host.js"; preview.createPreviewHost(options, "full");',
    'import factory from "./preview/host.js"; factory(options);',
    'const { createPreviewHost: make } = require("./preview/host.js"); make(options);',
    'const supplier = await import("./preview/host.js"); supplier["createPreviewHost"](options);',
    'export { createPreviewHost as make } from "./preview/host.js";',
    'export * from "./preview/host.js";',
    'import { createPreviewHost as make } from "./preview/host.js"; export { make };',
  ]) expect(constructorSuppliers(source, path).violations.length, source).toBeGreaterThan(0);
});

it('keeps the actual production factory supplier at one argument with no argument-list spread or escape', () => {
  const violations: string[] = [], suppliers: string[] = [];
  for (const path of ['apps', 'modules', 'packages'].flatMap(root => supplierSources(join(sourceRoot, root)))) {
    const result = constructorSuppliers(readFileSync(path, 'utf8'), path);
    violations.push(...result.violations.map(reason => `${relative(sourceRoot, path)}: ${reason}`));
    if (result.calls) suppliers.push(relative(sourceRoot, path));
  }
  expect(violations).toEqual([]);
  expect(suppliers).toEqual(['apps/desktop/electron/main.ts']);
});
