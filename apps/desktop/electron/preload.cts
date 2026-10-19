import { contextBridge } from 'electron';
import type { DesktopPort } from '@hq/contracts';

const desktop: DesktopPort = Object.freeze({
  platform: 'desktop',
  versions: Object.freeze({ electron: process.versions.electron ?? null }),
});
contextBridge.exposeInMainWorld('hqDesktop', desktop);
