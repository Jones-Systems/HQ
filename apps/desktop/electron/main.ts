import { app, BrowserWindow, session } from 'electron';
import { fileURLToPath } from 'node:url';
import { validateDevelopmentUrl, WINDOW_SECURITY } from './security.js';

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
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event) => event.preventDefault());
  window.webContents.on('will-redirect', (event) => event.preventDefault());
  window.webContents.on('will-attach-webview', (event) => event.preventDefault());
  if (developmentUrl) await window.loadURL(developmentUrl);
  else await window.loadFile(fileURLToPath(new URL('../dist/index.html', import.meta.url)));
}

app.whenReady().then(async () => {
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  session.defaultSession.setPermissionCheckHandler(() => false);
  session.defaultSession.setDevicePermissionHandler(() => false);
  session.defaultSession.on('will-download', (event) => event.preventDefault());
  await createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) void createWindow();
  });
}).catch((error: unknown) => {
  console.error('HQ could not start:', error);
  app.exit(1);
});

// UI lifetime has no authority over independently running remote work.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
