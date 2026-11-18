import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { expect, it, vi } from 'vitest';
import type { UpdatesPort } from '@hq/contracts/updates';

it('exposes fixed update channels, hides IPC events and removes subscriptions', async () => {
  const expose = vi.fn(), invoke = vi.fn(async () => ({ ok: true })), on = vi.fn(), removeListener = vi.fn();
  runInNewContext(readFileSync('apps/desktop/dist-electron/preload.cjs', 'utf8'), {
    exports: {}, process: { versions: {} }, require: (name: string) => {
      expect(name).toBe('electron');
      return { contextBridge: { exposeInMainWorld: expose }, ipcRenderer: { invoke, on, removeListener } };
    },
  });
  const updates = expose.mock.calls.find(([name]) => name === 'hqUpdates')![1] as UpdatesPort;
  expect(Object.isFrozen(updates)).toBe(true);
  await updates.schedule('candidate');
  expect(invoke).toHaveBeenLastCalledWith('hq:updates:command', 'schedule', { candidateId: 'candidate' });
  await updates.cancelScheduled();
  expect(invoke).toHaveBeenLastCalledWith('hq:updates:command', 'cancelScheduled', {});
  await updates.shellReady();
  expect(invoke).toHaveBeenLastCalledWith('hq:updates:command', 'shellReady', {});
  const listener = vi.fn();
  const dispose = updates.subscribe(listener);
  const receive = on.mock.calls[0][1];
  receive({ sender: 'never-exposed' }, { phase: 'fixture' });
  expect(listener).toHaveBeenCalledExactlyOnceWith({ phase: 'fixture' });
  dispose();
  expect(removeListener).toHaveBeenCalledWith('hq:updates:status', receive);
});
