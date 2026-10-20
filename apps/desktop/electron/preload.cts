import { contextBridge, ipcRenderer } from 'electron';
import type { DesktopPort } from '@hq/contracts';

const desktop: DesktopPort = Object.freeze({
  platform: 'desktop',
  versions: Object.freeze({ electron: process.versions.electron ?? null }),
});
contextBridge.exposeInMainWorld('hqDesktop', desktop);

// The realm is shared by trusted modules; these objects are not hard domain isolation.
const services: import('@hq/contracts/services').HqServices = Object.freeze({
  social: Object.freeze<import('@hq/contracts/services').SocialServiceTransport>({ call: (route, params) => ipcRenderer.invoke('hq:svc:social', route, params) }),
  work: Object.freeze<import('@hq/contracts/services').WorkServiceTransport>({ call: (route, params) => ipcRenderer.invoke('hq:svc:work', route, params) }),
  design: Object.freeze<import('@hq/contracts/services').DesignServiceTransport>({ call: (route, params) => ipcRenderer.invoke('hq:svc:design', route, params) }),
  config: Object.freeze<import('@hq/contracts/services').ServiceConfigTransport>({
    set: (input) => ipcRenderer.invoke('hq:svc:config', 'set', input),
    status: (domain) => ipcRenderer.invoke('hq:svc:config', 'status', domain),
  }),
});
contextBridge.exposeInMainWorld('hqServices', services);
