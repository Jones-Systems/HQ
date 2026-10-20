import { app, type BrowserWindow, type WebContentsView, type Session, type WebContents } from 'electron';
import { randomUUID, createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type { AgentEvent, CaptureRecord, PreviewParams, PreviewResult, PreviewSession, PreviewValues, ResolveRequest } from '@hq/contracts/preview';
import { createIsolatedContents, contentsClass, probeUnregisteredContents } from '../contents-factory.js';
import { record } from '../services.js';
import { PREVIEW_HOST_ENABLED, PREVIEW_PICK_QUALIFIED } from './status.js';
import { requestAllowed, previewTarget } from './policy.js';
import { acceptCapture, type CaptureReading } from './coherence.js';
import { previewParams, validAgentEvent, validResolution } from './validation.js';
import { createQualificationBarrier } from './qualification.js';

type Result = PreviewResult<unknown>;
type Live = { view: WebContentsView; session: Session; target: URL; value: PreviewSession; visible: boolean; mode: 'off' | 'pick' | 'cite'; events: PreviewValues['events']['events'][number][]; sequence: number; draining: boolean; timer: ReturnType<typeof setInterval>; closing: boolean; epoch: number; captureSequence: number; queue: Promise<unknown>; blocked?: string };
const fail = (kind: 'invalid' | 'unavailable' | 'stale' | 'blocked', reason?: string): Result => ({ ok: false, kind, ...(reason ? { reason } : {}) });
const ok = (value: unknown): Result => ({ ok: true, value });
class CaptureTimeout extends Error {}
async function bounded<T>(operation: Promise<T>, milliseconds: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([operation, new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new CaptureTimeout('Capture operation timed out')), Math.max(0, milliseconds));
    })]);
  } finally { clearTimeout(timer); }
}
export function createPreviewHost(options: {
  window: () => BrowserWindow | undefined;
  putBlob: (bytes: Uint8Array, digest: string) => Promise<boolean>;
}) {
  const qualificationEnabled = !app.isPackaged && Boolean(process.env.HQ_USER_DATA_DIR) && process.env.HQ_QUALIFY_PREVIEW === '1';
  const barrier = createQualificationBarrier();
  const enabled = PREVIEW_HOST_ENABLED || qualificationEnabled;
  const pickQualified = PREVIEW_PICK_QUALIFIED || qualificationEnabled;
  let fault = qualificationEnabled ? process.env.HQ_PREVIEW_FAULT : undefined;
  const denials = { permissions: 0, devices: 0, display: 0, popups: 0, downloads: 0, auth: 0, certificates: 0, certificateErrors: 0, navigation: 0 };
  type Trace = { operation: 'load' | 'capture' | 'navigation'; phase: string; sessionId: string; generation: number; at: string; error?: { name: string; message: string; code?: string | number } };
  const traces: Trace[] = [];
  function trace(live: Live, operation: Trace['operation'], phase: string, error?: unknown) {
    if (!qualificationEnabled) return;
    const detail = error instanceof Error ? { name: error.name, message: error.message.replace(/https?:\/\/\S+/g, '[url]').slice(0, 500), ...('code' in error && (typeof error.code === 'string' || typeof error.code === 'number') ? { code: error.code } : {}) } : undefined;
    traces.push({ operation, phase, sessionId: live.value.sessionId, generation: live.value.generation, at: new Date().toISOString(), ...(detail ? { error: detail } : {}) });
    if (traces.length > 64) traces.shift();
  }
  const diagnostics = { blobWrites: 0, clearedSessions: 0, deniedRequests: 0, lastPickOutcome: null as PreviewResult<CaptureRecord> | null };
  const sessions = new Map<string, Live>();
  const previewContents = new WeakSet<WebContents>();
  let lifecycleEpoch = 0, overlayHidden = false;
  const images = new Map<string, { sessionId: string; data: string }>();
  let bundle: Promise<{ source: string; digest: string }> | undefined;
  const pinnedBundle = () => bundle ??= readFile(new URL('../preview-agent/agent.js', import.meta.url), 'utf8').then(source => ({ source, digest: createHash('sha256').update(source).digest('hex') }));
  async function world<T>(live: Live, expression: string): Promise<T> {
    if (live.closing || live.view.webContents.isDestroyed()) throw Error('Preview closed');
    return await bounded(live.view.webContents.executeJavaScriptInIsolatedWorld(1001, [{ code: expression }]), 3000) as T;
  }
  function fence(live: Live) { live.value = { ...live.value, generation: live.value.generation + 1 }; live.events.length = 0; live.epoch++; }
  function current(live: Live): PreviewSession {
    const url = new URL(live.view.webContents.getURL() || live.target.href);
    return { ...live.value, route: url.pathname + url.search, state: url.hash };
  }
  async function install(live: Live) {
    const pinned = await pinnedBundle();
    if (createHash('sha256').update(pinned.source).digest('hex') !== pinned.digest) throw Error('Preview agent changed');
    await world(live, `${pinned.source}\nHQPreviewAgent.installPreviewAgentHost(window); window.__hqPreviewAgentHostV1.agent.setMode(${JSON.stringify(live.mode)},${live.value.generation});`);
  }
  const closingTasks = new Set<Promise<void>>();
  async function closeSession(id: string) {
    const live = sessions.get(id); if (!live) return;
    live.closing = true; clearInterval(live.timer); sessions.delete(id);
    for (const [key, value] of images) if (value.sessionId === id) images.delete(key);
    const window = options.window();
    try { if (!live.view.webContents.isDestroyed()) live.view.webContents.close({ waitForBeforeUnload: false }); }
    finally { if (window && !window.isDestroyed()) window.contentView.removeChildView(live.view); await live.session.clearData(); diagnostics.clearedSessions++; }
  }
  function close(id: string) { const pending = closeSession(id); closingTasks.add(pending); void pending.finally(() => closingTasks.delete(pending)).catch(() => {}); return pending; }
  async function closeAll() {
    lifecycleEpoch++;
    for (const id of sessions.keys()) void close(id);
    await Promise.all([closeNetworkControl(), ...closingTasks]);
  }
  async function read(live: Live, requests: readonly unknown[], captureSequence: number): Promise<CaptureReading> {
    const generation = live.value.generation, url = live.view.webContents.getURL();
    const value = await world<unknown>(live, `(() => {if ((window.__hqPreviewCaptureSequence ?? 0) > ${captureSequence}) throw Error("Expired capture"); window.__hqPreviewCaptureSequence=${captureSequence};const a=window.__hqPreviewAgentHostV1.agent;a.setHighlightHidden(true);const r=a.resolveExact(${JSON.stringify(requests)});return {...r,contentSize:{w:document.documentElement.scrollWidth,h:document.documentElement.scrollHeight}};})()`);
    if (!record(value) || !Number.isSafeInteger(value.mutationCounter) || !record(value.frame) || !record(value.frame.viewport) || !record(value.frame.scroll) || !Array.isArray(value.results) || value.results.length !== requests.length || !record(value.contentSize)) throw Error('Invalid agent reading');
    const numbers = [...Object.values(value.frame.viewport), ...Object.values(value.frame.scroll), ...Object.values(value.contentSize)];
    if (!numbers.every(n => typeof n === 'number' && Number.isFinite(n) && Math.abs(n) < 10000000)) throw Error('Invalid frame');
    if (live.value.generation !== generation || live.view.webContents.getURL() !== url) throw Error('Navigation changed');
    return { ...(value as unknown as CaptureReading), generation, url };
  }
  async function emulate(live: Live, scale = 1) {
    if (live.closing || live.view.webContents.isDestroyed()) throw Error('Preview closed');
    const debuggerPort = live.view.webContents.debugger;
    if (!debuggerPort.isAttached()) debuggerPort.attach('1.3');
    const { w, h, dpr } = live.value.viewport;
    await debuggerPort.sendCommand('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: dpr, mobile: false, scale });
  }
  async function pixels(live: Live, scroll: { x: number; y: number }) {
    const contents = live.view.webContents;
    if (!contents.debugger.isAttached()) contents.debugger.attach('1.3');
    const result = await contents.debugger.sendCommand('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: true, clip: { x: scroll.x, y: scroll.y, width: live.value.viewport.w, height: live.value.viewport.h, scale: 1 } });
    if (!record(result) || typeof result.data !== 'string' || result.data.length > 16 * 1024 * 1024) throw Error('Invalid capture');
    const bytes = Buffer.from(result.data, 'base64');
    if (bytes.length < 24 || bytes.subarray(1, 4).toString() !== 'PNG') throw Error('Invalid PNG');
    return { bytes, width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
  }
  async function capture(live: Live, expectedGeneration: number, event?: AgentEvent): Promise<PreviewResult<CaptureRecord>> {
    if (event && !pickQualified) return { ok: false, kind: 'stale', reason: 'unqualified' };
    if (live.value.status === 'crashed' || live.value.generation !== expectedGeneration) return { ok: false, kind: 'stale', reason: 'navigation' };
    const request = event ? { ...event.target, identity: event.snapshot.identity } : undefined;
    if (request) { delete (request as { rect?: unknown }).rect; delete (request as { rects?: unknown }).rects; }
    // Native promises cannot be cancelled; monotonic world tokens fence late highlight writes.
    const captureSequence = ++live.captureSequence;
    const deadline = Date.now() + 6000;
    const withinCapture = <T>(operation: Promise<T>) => bounded(operation, deadline - Date.now());
    let accepted: Extract<ReturnType<typeof acceptCapture>, { ok: true }>;
    try {
      trace(live, 'capture', 'pre-read:start');
      const pre = await withinCapture(read(live, request ? [request] : [], captureSequence));
      trace(live, 'capture', 'pre-read:end');
      if (qualificationEnabled) await barrier.checkpoint('pre-read', live.value.sessionId);
      trace(live, 'capture', 'pixels-first:start');
      const first = await withinCapture(pixels(live, pre.frame.scroll));
      trace(live, 'capture', 'pixels-first:end');
      if (qualificationEnabled) await barrier.checkpoint('first-capture', live.value.sessionId);
      trace(live, 'capture', 'pixels-second:start');
      const second = await withinCapture(pixels(live, pre.frame.scroll));
      trace(live, 'capture', 'pixels-second:end');
      trace(live, 'capture', 'post-read:start');
      let post = await withinCapture(read(live, request ? [request] : [], captureSequence));
      trace(live, 'capture', 'post-read:end');
      if (qualificationEnabled) { await barrier.checkpoint('post-read', live.value.sessionId); post = await withinCapture(read(live, request ? [request] : [], captureSequence)); }
      const result = acceptCapture(pre, fault === 'dpr' ? { ...first, width: first.width + 1 } : first, fault === 'pixels-unstable' ? { ...second, bytes: new Uint8Array([1]) } : second, fault === 'mutation' ? { ...post, mutationCounter: post.mutationCounter + 1 } : post, { generation: expectedGeneration, viewport: live.value.viewport, ...(event ? { event } : {}) });
      if (!result.ok) return { ok: false, kind: 'stale', reason: result.reason };
      if (live.closing || live.value.generation !== expectedGeneration) return { ok: false, kind: 'stale', reason: 'navigation' };
      accepted = result;
    } catch (error) {
      trace(live, 'capture', 'error', error);
      if (error instanceof CaptureTimeout) return { ok: false, kind: 'unavailable', reason: 'capture-timeout' };
      return live.closing || live.value.generation !== expectedGeneration
        ? { ok: false, kind: 'stale', reason: 'navigation' }
        : { ok: false, kind: 'unavailable', reason: 'capture-failed' };
    } finally {
      trace(live, 'capture', 'finalize:start');
      if (!live.closing && !live.view.webContents.isDestroyed()) {
        try {
          // The half-step expires this attempt without overtaking the next integer token.
          await bounded(world(live, `if ((window.__hqPreviewCaptureSequence ?? 0) <= ${captureSequence}) { window.__hqPreviewCaptureSequence=${captureSequence + 0.5}; window.__hqPreviewAgentHostV1?.agent.setHighlightHidden(false); }`), 1000);
        } catch (error) {
          trace(live, 'capture', 'finalize:error', error);
          if (error instanceof CaptureTimeout) return { ok: false, kind: 'unavailable', reason: 'capture-timeout' };
          return { ok: false, kind: 'unavailable', reason: 'capture-failed' };
        }
      }
      trace(live, 'capture', 'finalize:end');
    }
    if (live.closing || live.value.generation !== expectedGeneration) return { ok: false, kind: 'stale', reason: 'navigation' };
    const captureId = randomUUID(), url = new URL(accepted.reading.url);
    const record: CaptureRecord = { captureId, sessionId: live.value.sessionId, versionId: live.value.versionId, generation: expectedGeneration,
      route: url.pathname + url.search, state: url.hash, viewport: live.value.viewport, scroll: accepted.reading.frame.scroll,
      contentSize: accepted.reading.contentSize, captureDigest: accepted.digest, capturedAt: new Date().toISOString() };
    trace(live, 'capture', 'blob:start');
    if (!await options.putBlob(accepted.bytes, accepted.digest)) return { ok: false, kind: 'unavailable', reason: 'storage' };
    trace(live, 'capture', 'blob:end');
    diagnostics.blobWrites++;
    if (images.size >= 32) images.delete(images.keys().next().value!);
    images.set(captureId, { sessionId: live.value.sessionId, data: `data:image/png;base64,${Buffer.from(accepted.bytes).toString('base64')}` });
    live.value = { ...live.value, contentSize: accepted.reading.contentSize };
    return { ok: true, value: record };
  }
  async function drain(live: Live) {
    if (live.draining || overlayHidden || !live.visible || live.mode === 'off' || live.closing || live.value.status === 'crashed') return;
    live.draining = true;
    try {
      const events = await world<unknown>(live, 'window.__hqPreviewAgentHostV1?.drain() ?? []');
      if (!Array.isArray(events) || events.length > 64) return;
      if (events.length && qualificationEnabled) await barrier.checkpoint('before-drain', live.value.sessionId);
      for (const event of events) {
        if (!validAgentEvent(event)) continue;
        if (overlayHidden) continue;
        if (event.generation !== live.value.generation) { diagnostics.lastPickOutcome = { ok: false, kind: 'stale', reason: 'navigation' }; continue; }
        const operation = live.queue.then(() => capture(live, event.generation, event)); live.queue = operation.catch(() => {});
        const result = await operation; diagnostics.lastPickOutcome = result;
        if (result.ok && !overlayHidden && event.generation === live.value.generation && !live.closing) {
          live.events.push({ sequence: ++live.sequence, generation: event.generation, event, capture: result.value });
          if (live.events.length > 64) live.events.shift();
        }
      }
    } catch { /* Navigation can dispose the isolated world between timer and drain. */ }
    finally { live.draining = false; }
  }
  async function open(params: PreviewParams['open']): Promise<Result> {
    const window = options.window(); if (!window || window.isDestroyed() || sessions.size >= 4) return fail('unavailable', 'view-limit');
    const openingEpoch = lifecycleEpoch;
    await pinnedBundle();
    if (openingEpoch !== lifecycleEpoch) return fail('stale', 'deactivated');
    const target = previewTarget(params.url)!;
    const made = createIsolatedContents('hq-preview'), id = randomUUID();
    const live: Live = { ...made, target, value: { sessionId: id, versionId: params.versionId, generation: 0, route: target.pathname + target.search, state: target.hash, viewport: params.viewport, contentSize: { w: params.viewport.w, h: params.viewport.h }, status: 'open', pickQualified },
      visible: false, mode: 'off', events: [], sequence: 0, draining: false, timer: undefined as never, closing: false, epoch: 0, captureSequence: 0, queue: Promise.resolve() };
    sessions.set(id, live);
    const contents = made.view.webContents, targetSession = made.session;
    previewContents.add(contents);
    let initializing = true;
    targetSession.setPermissionRequestHandler((_wc, _permission, callback) => { denials.permissions++; callback(false); });
    targetSession.setPermissionCheckHandler(() => { denials.permissions++; return false; }); targetSession.setDevicePermissionHandler(() => { denials.devices++; return false; });
    targetSession.setDisplayMediaRequestHandler((_request, callback) => { denials.display++; callback({}); });
    targetSession.on('will-download', event => { denials.downloads++; event.preventDefault(); });
    targetSession.on('select-hid-device', (event, _details, callback) => { denials.devices++; event.preventDefault(); callback(''); });
    targetSession.on('select-usb-device', (event, _details, callback) => { denials.devices++; event.preventDefault(); callback(''); });
    targetSession.on('select-serial-port', (event, _ports, _contents, callback) => { denials.devices++; event.preventDefault(); callback(''); });
    targetSession.webRequest.onBeforeRequest((details, callback) => {
      const allowed = requestAllowed(details.url, target, details.resourceType === 'mainFrame');
      if (!allowed) diagnostics.deniedRequests++;
      if (!allowed && details.resourceType === 'mainFrame') live.blocked = 'navigation';
      callback({ cancel: !allowed });
    });
    contents.setWindowOpenHandler(() => { denials.popups++; return { action: 'deny' }; }); contents.setAudioMuted(true);
    contents.setWebRTCIPHandlingPolicy('disable_non_proxied_udp');
    contents.on('will-navigate', (event, url) => { if (!requestAllowed(url, target, true)) { denials.navigation++; event.preventDefault(); live.blocked = 'navigation'; } });
    contents.on('will-redirect', (event, url) => { if (!requestAllowed(url, target, true)) { denials.navigation++; event.preventDefault(); live.blocked = 'navigation'; } });
    contents.on('will-prevent-unload', event => event.preventDefault());
    contents.on('login', (event, _details, _info, callback) => { denials.auth++; event.preventDefault(); callback(); });
    contents.on('select-bluetooth-device', (event, _devices, callback) => { denials.devices++; event.preventDefault(); callback(''); });
    if (qualificationEnabled) contents.on('did-fail-load', (_event, code, description, _url, mainFrame) => { trace(live, 'navigation', mainFrame ? 'main-frame:failed' : 'subframe:failed', Object.assign(new Error(description), { code })); });
    contents.on('did-start-navigation', (_event, _url, _inPlace, mainFrame) => { if (mainFrame) fence(live); });
    contents.on('did-navigate-in-page', (_event, _url, mainFrame) => { if (mainFrame) void install(live).catch(() => {}); });
    contents.on('dom-ready', () => { if (!initializing) void install(live).catch(() => { live.blocked = 'agent-unavailable'; }); });
    contents.on('render-process-gone', () => { fence(live); live.value = { ...live.value, status: 'crashed' }; });
    made.view.setBounds({ x: 0, y: 0, width: params.viewport.w, height: params.viewport.h }); made.view.setVisible(false);
    window.contentView.addChildView(made.view);
    live.timer = setInterval(() => { void drain(live); }, 100);
    try {
      // Electron 44's direct emulation dereferences the native view without a null guard.
      // Initialize an inert view, then retain CDP metrics across target renderer changes.
      trace(live, 'load', 'bootstrap:start');
      await contents.loadURL('about:blank');
      trace(live, 'load', 'bootstrap:end');
      trace(live, 'load', 'metrics:start');
      await emulate(live);
      trace(live, 'load', 'metrics:end');
      if (openingEpoch !== lifecycleEpoch || live.closing) return fail('stale', 'deactivated');
      initializing = false;
      trace(live, 'load', 'target:start');
      await contents.loadURL(target.href);
      trace(live, 'load', 'target:end');
      trace(live, 'load', 'agent:start');
      await install(live);
      trace(live, 'load', 'agent:end');
      if (openingEpoch !== lifecycleEpoch || live.closing) return fail('stale', 'deactivated');
      return ok(current(live));
    }
    catch (error) { trace(live, 'load', 'error', error); await close(id); return fail('unavailable', 'load'); }
  }
  app.on('certificate-error', (event, contents, _url, _error, _certificate, callback) => { if ([...sessions.values()].some(live => live.view.webContents === contents)) { denials.certificateErrors++; event.preventDefault(); callback(false); } });
  app.on('select-client-certificate', (event, contents, _url, _list, callback) => {
    const kind = contents ? contentsClass(contents) : undefined;
    if (kind === 'hq-main') return;
    if (contents && previewContents.has(contents)) denials.certificates++;
    event.preventDefault(); callback();
  });
  let networkControl: ReturnType<typeof createIsolatedContents> | undefined;
  async function closeNetworkControl() { if (!networkControl) return; const control = networkControl; networkControl = undefined; if (!control.view.webContents.isDestroyed()) control.view.webContents.close({ waitForBeforeUnload: false }); await control.session.clearData(); }
  if (qualificationEnabled) (globalThis as unknown as { __hqPreviewQualification: unknown }).__hqPreviewQualification = {
    trustProbe: probeUnregisteredContents,
    async createNetworkControl(url: string) {
      const target = previewTarget(url);
      if (!target || target.protocol !== 'http:' || !['localhost', '127.0.0.1', '[::1]'].includes(target.hostname) || networkControl) throw Error('Invalid network control');
      networkControl = createIsolatedContents('hq-preview');
      networkControl.session.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
      networkControl.session.setPermissionCheckHandler(() => false); networkControl.view.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
      try { await networkControl.view.webContents.loadURL(target.href); return { webContentsId: networkControl.view.webContents.id, processId: networkControl.view.webContents.getOSProcessId() }; } catch (error) { await closeNetworkControl(); throw error; }
    },
    closeNetworkControl,
    pauseAt: barrier.pauseAt, waitForPause: barrier.waitForPause, resume: barrier.resume,
    fault(value: string | null) { if (value !== null && !['mutation', 'pixels-unstable', 'dpr'].includes(value)) throw Error('Invalid fault'); fault = value ?? undefined; },
    sessions: () => [...sessions.values()].map(live => ({ ...current(live), visible: live.view.getVisible(), intendedVisible: live.visible, overlayHidden, webContentsId: live.view.webContents.id, processId: live.view.webContents.getOSProcessId(), preloadScripts: live.session.getPreloadScripts(), preloads: live.session.getPreloads(), storagePath: live.session.storagePath, persistent: live.session.isPersistent() })),
    stats: () => ({ ...diagnostics, overlayHidden, traces: [...traces], denials: { ...denials }, mainPid: process.pid, rendererPid: options.window()?.webContents.getOSProcessId(), sessions: sessions.size }),
  };
  return {
    closeAll,
    async call(route: unknown, raw: unknown): Promise<Result> {
      if (!previewParams(route, raw)) return fail('invalid');
      if (!enabled) return fail('unavailable', 'disabled');
      const p = raw as Record<string, unknown>;
      try {
        if (route === 'deactivate') { await closeAll(); return ok(null); }
        if (route === 'overlay') {
          overlayHidden = Boolean(p.hidden);
          for (const live of sessions.values()) if (!live.closing && !live.view.webContents.isDestroyed()) live.view.setVisible(live.visible && !overlayHidden);
          return ok(null);
        }
        if (route === 'open') return await open(raw as PreviewParams['open']);
        if (route === 'image') return images.has(String(p.captureId)) ? ok(images.get(String(p.captureId))!.data) : fail('unavailable');
        if (route === 'close') { await close(String(p.sessionId)); return ok(null); }
        const live = sessions.get(String(p.sessionId)); if (!live || live.closing) return fail('unavailable');
        if (route === 'status') { if (live.blocked) { const reason = live.blocked; live.blocked = undefined; return fail('blocked', reason); } return ok(current(live)); }
        if (live.value.status === 'crashed') return fail('unavailable', 'crashed');
        if (route === 'place') {
          const { rect, visible } = raw as PreviewParams['place'];
          const old = live.view.getBounds();
          if (old.width !== Math.round(rect.width) || old.height !== Math.round(rect.height)) { fence(live); await install(live); }
          live.view.setBounds({ x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) });
          await emulate(live, Math.max(0.01, Math.min(rect.width / live.value.viewport.w, rect.height / live.value.viewport.h)));
          live.view.setVisible(visible && !overlayHidden); live.visible = visible; return ok(current(live));
        }
        if (route === 'navigate') {
          const target = new URL(String(p.route), live.target);
          if (target.origin !== live.target.origin) return fail('blocked', 'navigation');
          await live.view.webContents.loadURL(target.href); await install(live); return ok(current(live));
        }
        if (route === 'events') return ok({ after: live.sequence, events: live.events.filter(event => event.sequence > Number(p.after)) });
        const expected = Number(route === 'capture' ? p.expectedGeneration : p.generation);
        if (expected !== live.value.generation) return fail('stale', 'navigation');
        if (route === 'mode') { live.mode = p.mode as Live['mode']; await install(live); return ok(null); }
        if (route === 'resolve') {
          const value = await world(live, `window.__hqPreviewAgentHostV1.agent.resolve(${JSON.stringify(p.requests as ResolveRequest[])})`);
          if (expected !== live.value.generation) return fail('stale', 'navigation');
          if (!validResolution(value, (p.requests as unknown[]).length)) return fail('unavailable', 'invalid-agent-output'); return ok(value);
        }
        const operation = live.queue.then(() => capture(live, expected)); live.queue = operation.catch(() => {}); return await operation;
      } catch { return fail('unavailable'); }
    },
  };
}
