import { contextBridge, ipcRenderer } from 'electron';
import type { DesktopPort } from '@hq/contracts';

const desktop: DesktopPort = Object.freeze({
  platform: 'desktop',
  versions: Object.freeze({ electron: process.versions.electron ?? null }),
});
contextBridge.exposeInMainWorld('hqDesktop', desktop);

// The realm is shared by trusted modules; these objects are not hard domain isolation.
const services: import('@hq/contracts/services').HqServices = Object.freeze({
  jonesCode: Object.freeze<import('@hq/contracts/jones-code').JonesTransport>({ call: (route, params) => ipcRenderer.invoke('hq:svc:design', route, params) }),
  sources: Object.freeze<import('@hq/contracts/catalog').SourceTransport>({ call: (route, params) => ipcRenderer.invoke('hq:svc:sources', route, params) }),
  preview: Object.freeze<import('@hq/contracts/preview').PreviewTransport>({ call: (route, params) => ipcRenderer.invoke('hq:svc:preview', route, params) }),
  wikiAdmin: Object.freeze<import('@hq/contracts/wiki-admin').WikiAdminTransport>({ call: (route, params) => ipcRenderer.invoke('hq:svc:wiki-admin', route, params) }),
  wiki: Object.freeze<import('@hq/contracts/wiki').WikiServiceTransport>({
    listSources: () => ipcRenderer.invoke('hq:svc:wiki', 'listSources', []),
    search: request => ipcRenderer.invoke('hq:svc:wiki', 'search', [request]),
    getPage: request => ipcRenderer.invoke('hq:svc:wiki', 'getPage', [request]),
    resolveAlias: request => ipcRenderer.invoke('hq:svc:wiki', 'resolveAlias', [request]),
    getBacklinks: request => ipcRenderer.invoke('hq:svc:wiki', 'getBacklinks', [request]),
    listTopics: request => ipcRenderer.invoke('hq:svc:wiki', 'listTopics', [request]),
    indexStatus: () => ipcRenderer.invoke('hq:svc:wiki', 'indexStatus', []),
  }),
  social: Object.freeze<import('@hq/contracts/services').SocialServiceTransport>({ call: (route, params) => ipcRenderer.invoke('hq:svc:social', route, params) }),
  work: Object.freeze<import('@hq/contracts/services').WorkServiceTransport>({ call: (route, params) => ipcRenderer.invoke('hq:svc:work', route, params) }),
  design: Object.freeze<import('@hq/contracts/services').DesignServiceTransport>({ call: (route, params) => ipcRenderer.invoke('hq:svc:design', route, params) }),
  config: Object.freeze<import('@hq/contracts/services').ServiceConfigTransport>({
    set: (input) => ipcRenderer.invoke('hq:svc:config', 'set', input),
    status: (domain) => ipcRenderer.invoke('hq:svc:config', 'status', domain),
  }),
});
contextBridge.exposeInMainWorld('hqServices', services);
