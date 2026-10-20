import { app, BrowserWindow, session, ipcMain } from 'electron';
import { fileURLToPath } from 'node:url';
import { validateDevelopmentUrl, WINDOW_SECURITY } from './security.js';

import { allowedSender, CHANNELS, createServices } from './services.js';
import { openServiceConfig } from './service-config.js';
import { createWikiBridge, openEmittedWiki, wikiIpcHandler } from './wiki-host.js';
import { createDesignHost, openEmittedDesignStore } from './design-host.js';

// Explicit temporary userData is supported only in unpackaged qualification runs.
if (!app.isPackaged && process.env.HQ_USER_DATA_DIR) app.setPath('userData', process.env.HQ_USER_DATA_DIR);
const ownsInstance = app.requestSingleInstanceLock();
if (!ownsInstance) app.quit();
const design = createDesignHost(() => openEmittedDesignStore(app.getPath('userData')));
const wiki = createWikiBridge(() => openEmittedWiki(app.getPath('userData')));
let closing = false;
let closed = false;
app.on('before-quit', (event) => {
  if (!ownsInstance || closed) return;
  event.preventDefault();
  if (closing) return;
  closing = true;
  void Promise.all([design.close(), wiki.close()]).then(() => { closed = true; app.quit(); }, () => { app.exit(1); });
});
const builtUrl = new URL('../dist/index.html', import.meta.url).href;
let mainWindow: BrowserWindow | undefined;
const developmentUrl = validateDevelopmentUrl(process.env.HQ_DEV_SERVER_URL, app.isPackaged);

async function createWindow(): Promise<void> {
  const window = new BrowserWindow({
    title: 'HQ', width: 1280, height: 820, minWidth: 760, minHeight: 560,
    backgroundColor: '#17191d',
    webPreferences: {
      ...WINDOW_SECURITY,
      preload: fileURLToPath(new URL('./preload.cjs', import.meta.url)),
    },
  });
  mainWindow = window;
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
  const authorized = (event: Electron.IpcMainInvokeEvent) => mainWindow !== undefined && allowedSender(event, mainWindow.webContents, builtUrl, developmentUrl);
  ipcMain.handle(CHANNELS.wiki, wikiIpcHandler(authorized, wiki));
  ipcMain.handle(CHANNELS.social, (event, route: unknown, params: unknown) => authorized(event) ? services.social(route, params) : { ok: false, kind: 'unavailable' });
  ipcMain.handle(CHANNELS.work, (event, route: unknown, params: unknown) => authorized(event) ? services.work(route, params) : { ok: false, kind: 'unavailable' });
  ipcMain.handle(CHANNELS.design, (event, route: unknown, params: unknown) => authorized(event) ? design.call(route, params) : { ok: false, kind: 'unavailable' });
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
