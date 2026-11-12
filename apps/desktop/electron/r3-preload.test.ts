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
  // The device document for Work: its own closed channel, exposed directly after `work`, with the same single member.
  await services.workLocal!.call('load', {}); expect(invoke).toHaveBeenLastCalledWith('hq:svc:work-local', 'load', {});
  const save = { binding: 'binding-token', expectedRevision: 0, value: { queue: [] } };
  await services.workLocal!.call('save', save); expect(invoke).toHaveBeenLastCalledWith('hq:svc:work-local', 'save', save);
  expect(Object.keys(services.workLocal!)).toEqual(['call']);
  const exposed = Object.keys(services); expect(exposed.slice(exposed.indexOf('work'), exposed.indexOf('work') + 2)).toEqual(['work', 'workLocal']);
  expect(Object.keys(services.generationSources!)).toEqual(['call']);
  await services.generationSources!.call('snapshot', {});
  expect(invoke).toHaveBeenLastCalledWith('hq:svc:generation-sources', 'snapshot', {});
  await services.generationSources!.call('serving', { sourceId: 'synthetic-source' });
  expect(invoke).toHaveBeenLastCalledWith('hq:svc:generation-sources', 'serving', { sourceId: 'synthetic-source' });
  const mainFrame = { url: 'file:///app/index.html' }, contents = { mainFrame };
  expect(allowedSender({ sender: contents, senderFrame: { ...mainFrame } }, contents, mainFrame.url, null)).toBe(false);
  expect(allowedSender({ sender: contents, senderFrame: mainFrame }, contents, mainFrame.url, null)).toBe(true);
});
