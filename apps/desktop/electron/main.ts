import { app, BrowserWindow, session, ipcMain, dialog } from 'electron';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import type { BuildReceipt, InstallationRecord, PreparedCandidate, UpdateStatus } from '@hq/contracts/updates';
import { createUpdateHost } from './updates/host.js';
import { createShellHealthGate, registerUpdateBridge, UPDATE_STATUS } from './update-bridge.js';
import { validateDevelopmentUrl } from './security.js';
import { createMainWindow } from './contents-factory.js';
import { createPreviewHost } from './preview/host.js';
import { createJonesHost } from './jones-code/host.js';
import { createSourceHost } from './sources/host.js';
import { createGenerationSourcesHost } from './sources/generation-host.js';

import { allowedSender, CHANNELS, createServices } from './services.js';
import { openServiceConfig } from './service-config.js';
import { wikiAdminIpcHandler } from './wiki-admin.js';
import { createWikiBridge, openEmittedWiki, wikiIpcHandler } from './wiki-host.js';
import { catalogPersistence, createCatalogHost } from './catalog-host.js';
import { createSaveDialog } from './save-dialog.js';
import { createWorkExport } from './work-export.js';
import { createDesignHost, openEmittedDesignStore } from './design-host.js';

interface BootstrapContext {
  readonly record: InstallationRecord;
  readonly installed: BuildReceipt | null;
  readonly recovery: UpdateStatus['recovery'];
  markMainReady(): Promise<boolean>;
  markRendererReady(): Promise<boolean>;
  schedule(candidate: PreparedCandidate): Promise<void>;
  cancelScheduled(): Promise<void>;
  dispose(): Promise<void>;
}
const bootstrap: BootstrapContext | undefined = app.isPackaged
  ? createRequire(import.meta.url)('../../../tools/updater/bootstrap.cjs').getContext()
  : undefined;
if (app.isPackaged && !bootstrap) throw Error('HQ must start through its installation bootstrap.');
const updateListeners = new Set<(status: UpdateStatus) => void>();
const updateOptions = () => ({
  installed: bootstrap?.installed ?? null,
  record: bootstrap?.record ?? null,
  recovery: bootstrap?.recovery ?? null,
  schedule: async (candidate: PreparedCandidate) => { if (!bootstrap) throw Error('Updates unavailable'); await bootstrap.schedule(candidate); },
  cancelScheduled: async () => { if (!bootstrap) throw Error('Updates unavailable'); await bootstrap.cancelScheduled(); },
});
let updates = createUpdateHost({ ...updateOptions(), record: null });
let unsubscribeUpdates = updates.subscribe(status => { for (const listener of updateListeners) listener(status); });
const updatePort = {
  status: () => updates.status(),
  call: (route: unknown, params: unknown) => updates.call(route, params),
  subscribe: (listener: (status: UpdateStatus) => void) => { updateListeners.add(listener); return () => { updateListeners.delete(listener); }; },
};
const shellHealth = createShellHealthGate(async () => {
  if (!bootstrap) return;
  if (!await bootstrap.markRendererReady()) throw Error('HQ startup health is incomplete.');
  // First adoption changes the installation record from legacy to this build at health.
  unsubscribeUpdates();
  await updates.dispose();
  updates = createUpdateHost(updateOptions());
  unsubscribeUpdates = updates.subscribe(status => { for (const listener of updateListeners) listener(status); });
  updates.start();
  for (const listener of updateListeners) listener(updates.status());
}, Boolean(bootstrap));
let updateBridge: ReturnType<typeof registerUpdateBridge> | undefined;

// Explicit temporary userData is supported only in unpackaged qualification runs.
if (!app.isPackaged && process.env.HQ_USER_DATA_DIR) app.setPath('userData', process.env.HQ_USER_DATA_DIR);
const ownsInstance = app.requestSingleInstanceLock();
if (!ownsInstance) app.quit();
const save = createSaveDialog(async request => {
  const result = await dialog.showSaveDialog({ defaultPath: request.defaultPath, filters: request.filters.map(filter => ({ name: filter.name, extensions: [...filter.extensions] })) });
  return result.canceled ? null : result.filePath ?? null;
});
const design = createDesignHost(() => openEmittedDesignStore(app.getPath('userData')), save);
const wiki = createWikiBridge(() => openEmittedWiki(app.getPath('userData')));
let closing = false;
let closed = false;
app.on('before-quit', (event) => {
  if (!ownsInstance || closed) return;
  event.preventDefault();
  if (closing) return;
  closing = true;
  void (async () => {
    const results = await Promise.allSettled([preview.closeAll(), design.close(), wiki.close()]);
    try { await updates.dispose(); } catch { /* The lease stays held until every domain drain has settled. */ }
    updateBridge?.dispose();
    unsubscribeUpdates();
    updateListeners.clear();
    await bootstrap?.dispose();
    closed = true;
    if (results.some(result => result.status === 'rejected')) app.exit(1);
    else app.quit();
  })().catch(() => { app.exit(1); });
});
const builtUrl = new URL('../dist/index.html', import.meta.url).href;
let mainWindow: BrowserWindow | undefined;
const preview = createPreviewHost({ window: () => mainWindow, putBlob: async (bytes, expectedDigest) => (await design.call('blob.put', { bytes, expectedDigest })).ok });
const developmentUrl = validateDevelopmentUrl(process.env.HQ_DEV_SERVER_URL, app.isPackaged);

async function createWindow(): Promise<void> {
  const window = createMainWindow();
  mainWindow = window;
  window.webContents.on('did-start-loading', () => { void preview.closeAll(); });
  window.webContents.on('render-process-gone', () => { void preview.closeAll(); });
  window.on('close', () => { void preview.closeAll(); });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event) => event.preventDefault());
  window.webContents.on('will-redirect', (event) => event.preventDefault());
  window.webContents.on('will-attach-webview', (event) => event.preventDefault());
  if (developmentUrl) await window.loadURL(developmentUrl);
  else await window.loadFile(fileURLToPath(new URL('../dist/index.html', import.meta.url)));
}

if (ownsInstance) app.whenReady().then(async () => {
  const config = await openServiceConfig(app.getPath('userData'));
  const services = createServices(config);
  const catalog = createCatalogHost(catalogPersistence(app.getPath('userData')), async replacing => {
    const result = await dialog.showOpenDialog({ title: replacing ? 'Replace selected catalog directory' : 'Choose catalog directory', buttonLabel: replacing ? 'Replace directory' : 'Choose directory', properties: ['openDirectory'] });
    return result.canceled ? null : result.filePaths[0] ?? null;
  });
  const jones = createJonesHost(app.getPath('userData'));
  const sources = createSourceHost({ userData: app.getPath('userData'), catalog, jones });
  const generationSources = createGenerationSourcesHost({ userData: app.getPath('userData') });
  const exportWork = createWorkExport(config, save);
  const authorized = (event: Electron.IpcMainInvokeEvent) => mainWindow !== undefined && allowedSender(event, mainWindow.webContents, builtUrl, developmentUrl);
  const handleDomain = (channel: string, listener: (event: Electron.IpcMainInvokeEvent, ...args: unknown[]) => unknown) => {
    ipcMain.handle(channel, async (event, ...args) => {
      if (!authorized(event) || !await shellHealth.wait() || !authorized(event)) return { ok: false, kind: 'unavailable' };
      return listener(event, ...args);
    });
  };
  updateBridge = registerUpdateBridge({ ipc: ipcMain, authorized, host: updatePort, health: shellHealth,
    send: status => {
      if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.webContents.isDestroyed()) mainWindow.webContents.send(UPDATE_STATUS, status);
    },
  });
  handleDomain('hq:svc:preview', (event, route: unknown, params: unknown) => authorized(event) ? preview.call(route, params) : { ok: false, kind: 'unavailable' });
  handleDomain('hq:svc:sources', (event, route: unknown, params: unknown) => authorized(event) ? sources.call(route, params) : { ok: false, kind: 'unavailable' });
  handleDomain('hq:svc:generation-sources', (event, route: unknown, params: unknown) => authorized(event) ? generationSources.call(route, params) : { ok: false, kind: 'unavailable' });
  handleDomain('hq:svc:wiki-admin', wikiAdminIpcHandler(authorized, wiki, async kind => {
    const result = await dialog.showOpenDialog({ title: kind === 'profile' ? 'Import Wiki source profile' : 'Choose local bare Wiki repository', properties: kind === 'profile' ? ['openFile'] : ['openDirectory'], ...(kind === 'profile' ? { filters: [{ name: 'Source profile', extensions: ['json'] }] } : {}) });
    return result.canceled ? null : result.filePaths[0] ?? null;
  }));
  handleDomain(CHANNELS.wiki, wikiIpcHandler(authorized, wiki));
  handleDomain(CHANNELS.social, (event, route: unknown, params: unknown) => authorized(event) ? services.social(route, params) : { ok: false, kind: 'unavailable' });
  handleDomain(CHANNELS.work, (event, route: unknown, params: unknown) => authorized(event) ? (route === 'export' ? exportWork(params) : services.work(route, params)) : { ok: false, kind: 'unavailable' });
  handleDomain(CHANNELS.design, async (event, route: unknown, params: unknown) => authorized(event) ? (typeof route === 'string' && route.startsWith('jonesCode.') ? jones.call(route, params) : typeof route === 'string' && route.startsWith('catalog.') ? (await design.ready() ? catalog.call(route, params) : { ok: false, kind: 'unavailable' }) : design.call(route, params)) : { ok: false, kind: 'unavailable' });
  handleDomain(CHANNELS.config, (event, route: unknown, params: unknown) => {
    if (!authorized(event)) return { configured: false, policy: 'rejected', transport: null };
    if (route === 'set') return config.set(params);
    if (route === 'status') return config.status(params);
    return { configured: false, policy: 'rejected', transport: null };
  });
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  session.defaultSession.setPermissionCheckHandler(() => false);
  session.defaultSession.setDevicePermissionHandler(() => false);
  session.defaultSession.on('will-download', (event) => event.preventDefault());
  await bootstrap?.markMainReady();
  await createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) void createWindow();
  });
}).catch(() => {
  console.error('HQ could not start.');
  app.exit(1);
});

// UI lifetime has no authority over independently running remote work.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
