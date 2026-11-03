import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { expect, it, vi } from 'vitest';
import type { HqServices } from '@hq/contracts/services';
import { allowedSender } from './services';
it('emitted sandbox preload sends the exact typed r3 calls through closed channels only', async () => {
  const expose = vi.fn(), invoke = vi.fn(async () => ({ ok: false, kind: 'unavailable' }));
  runInNewContext(readFileSync('apps/desktop/dist-electron/preload.cjs', 'utf8'), { exports: {}, process: { versions: { electron: 'fixture' } }, require: (name: string) => { expect(name).toBe('electron'); return { contextBridge: { exposeInMainWorld: expose }, ipcRenderer: { invoke } }; } });
  const services = expose.mock.calls.find(([name]) => name === 'hqServices')![1] as HqServices;
  for (const route of ['catalog.roots', 'catalog.chooseRoot', 'catalog.forget', 'catalog.snapshot', 'import.status', 'storage.diagnostics'] as const) {
    await services.design.call(route, {}); expect(invoke).toHaveBeenLastCalledWith('hq:svc:design', route, {});
  }
  await services.work.call('export', { format: 'markdown' }); expect(invoke).toHaveBeenLastCalledWith('hq:svc:work', 'export', { format: 'markdown' });
  expect(Object.keys(services.design)).toEqual(['call']); expect(Object.keys(services.work)).toEqual(['call']);
  const mainFrame = { url: 'file:///app/index.html' }, contents = { mainFrame };
  expect(allowedSender({ sender: contents, senderFrame: { ...mainFrame } }, contents, mainFrame.url, null)).toBe(false);
  expect(allowedSender({ sender: contents, senderFrame: mainFrame }, contents, mainFrame.url, null)).toBe(true);
});
