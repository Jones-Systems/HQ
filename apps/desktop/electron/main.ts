import { app, BrowserWindow, session, ipcMain, dialog } from 'electron';
import { fileURLToPath } from 'node:url';
import { validateDevelopmentUrl } from './security.js';
import { createMainWindow } from './contents-factory.js';
import { createPreviewHost } from './preview/host.js';
import { createJonesHost } from './jones-code/host.js';
import { createSourceHost } from './sources/host.js';

import { allowedSender, CHANNELS, createServices } from './services.js';
import { openServiceConfig } from './service-config.js';
import { wikiAdminIpcHandler } from './wiki-admin.js';
import { createWikiBridge, openEmittedWiki, wikiIpcHandler } from './wiki-host.js';
import { catalogPersistence, createCatalogHost } from './catalog-host.js';
import { createSaveDialog } from './save-dialog.js';
import { createWorkExport } from './work-export.js';
import { createDesignHost, openEmittedDesignStore } from './design-host.js';

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
  void Promise.all([preview.closeAll(), design.close(), wiki.close()]).then(() => { closed = true; app.quit(); }, () => { app.exit(1); });
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
  const exportWork = createWorkExport(config, save);
  const authorized = (event: Electron.IpcMainInvokeEvent) => mainWindow !== undefined && allowedSender(event, mainWindow.webContents, builtUrl, developmentUrl);
  ipcMain.handle('hq:svc:preview', (event, route: unknown, params: unknown) => authorized(event) ? preview.call(route, params) : { ok: false, kind: 'unavailable' });
  ipcMain.handle('hq:svc:sources', (event, route: unknown, params: unknown) => authorized(event) ? sources.call(route, params) : { ok: false, kind: 'unavailable' });
  ipcMain.handle('hq:svc:wiki-admin', wikiAdminIpcHandler(authorized, wiki, async kind => {
    const result = await dialog.showOpenDialog({ title: kind === 'profile' ? 'Import Wiki source profile' : 'Choose local bare Wiki repository', properties: kind === 'profile' ? ['openFile'] : ['openDirectory'], ...(kind === 'profile' ? { filters: [{ name: 'Source profile', extensions: ['json'] }] } : {}) });
    return result.canceled ? null : result.filePaths[0] ?? null;
  }));
  ipcMain.handle(CHANNELS.wiki, wikiIpcHandler(authorized, wiki));
  ipcMain.handle(CHANNELS.social, (event, route: unknown, params: unknown) => authorized(event) ? services.social(route, params) : { ok: false, kind: 'unavailable' });
  ipcMain.handle(CHANNELS.work, (event, route: unknown, params: unknown) => authorized(event) ? (route === 'export' ? exportWork(params) : services.work(route, params)) : { ok: false, kind: 'unavailable' });
  ipcMain.handle(CHANNELS.design, async (event, route: unknown, params: unknown) => authorized(event) ? (typeof route === 'string' && route.startsWith('jonesCode.') ? jones.call(route, params) : typeof route === 'string' && route.startsWith('catalog.') ? (await design.ready() ? catalog.call(route, params) : { ok: false, kind: 'unavailable' }) : design.call(route, params)) : { ok: false, kind: 'unavailable' });
  ipcMain.handle(CHANNELS.config, (event, route: unknown, params: unknown) => {
    if (!authorized(event)) return { configured: false, policy: 'rejected', transport: null };
    if (route === 'set') return config.set(params);
    if (route === 'status') return config.status(params);
    return { configured: false, policy: 'rejected', transport: null };
  });
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  session.defaultSession.setPermissionCheckHandler(() => false);
  session.defaultSession.setDevicePermissionHandler(() => false);
  session.defaultSession.on('will-download', (event) => event.preventDefault());
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
