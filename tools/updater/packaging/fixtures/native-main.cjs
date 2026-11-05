'use strict';

const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const context = require('../tools/updater/bootstrap.cjs').getContext();

async function main() {
  assert.equal(context?.record.synthetic, true);
  assert.equal(app.commandLine.hasSwitch('use-mock-keychain'), true);
  assert.equal(context.record.bundleId, 'org.jones-systems.hq.updater-test');
  assert.equal(app.getName(), 'HQ Updater Test');
  assert.equal(app.getPath('userData'), context.record.userData);
  assert.equal(app.getPath('sessionData'), context.record.sessionData);
  assert.equal(process.versions.electron, context.installed.electronVersion);
  const controlFile = path.join(context.record.stateRoot, 'smoke-control.json');
  let control = { mode: 'healthy' };
  try { control = JSON.parse(await fs.readFile(controlFile, 'utf8')); await fs.unlink(controlFile); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (control.mode === 'fail-health') {
    await fs.writeFile(path.join(context.record.userData, 'post-open-synthetic-write.txt'), 'preserve after failed health');
    app.exit(23);
    return;
  }
  app.disableHardwareAcceleration();
  await app.whenReady();
  assert.equal(await context.markMainReady(), false);
  const window = new BrowserWindow({ show: false, webPreferences: { preload: path.join(__dirname, 'native-preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false } });
  let acknowledge;
  const mounted = new Promise(resolve => { acknowledge = resolve; });
  ipcMain.handle('hq-synthetic-shell-mounted', async event => {
    assert.equal(event.sender, window.webContents);
    assert.equal(event.senderFrame, window.webContents.mainFrame);
    const healthy = await context.markRendererReady();
    assert.equal(healthy, true);
    acknowledge();
  });
  await window.loadFile(path.join(__dirname, 'native-shell.html'));
  await mounted;
  if (control.mode === 'schedule') await context.schedule(control.candidate);
  await fs.writeFile(path.join(context.record.userData, 'synthetic-preserved.txt'), 'same profile across updates');
  await fs.writeFile(path.join(context.record.stateRoot, `smoke-${context.installed.buildSequence}.json`), JSON.stringify({ installed: context.installed, appName: app.getName(), userData: app.getPath('userData'), sessionData: app.getPath('sessionData'), mode: control.mode, healthy: true }));
  await new Promise(resolve => setTimeout(resolve, 750));
  ipcMain.removeHandler('hq-synthetic-shell-mounted');
  window.destroy();
  await context.dispose();
  app.exit(0);
}

const watchdog = setTimeout(() => app.exit(24), 25000);
watchdog.unref();
main().catch(async error => {
  if (context?.record.synthetic) await fs.writeFile(path.join(context.record.stateRoot, 'smoke-failure.json'), JSON.stringify({ name: error.name, message: error.message })).catch(() => {});
  app.exit(2);
});
