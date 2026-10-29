import { expect, it, vi } from 'vitest';
import { createShellHealthGate, registerUpdateBridge, UPDATE_COMMAND } from './update-bridge';
import type { UpdateStatus } from '@hq/contracts/updates';

const status: UpdateStatus = {
  schemaVersion: 1, phase: 'idle', supported: true,
  installed: { version: 'fixture', sourceSha: null, channel: 'preview' },
  preferences: { automaticChecks: true, backgroundDownload: false },
  lastCheckedAt: null, nextCheckAt: null, candidate: null, progress: null, error: null, recovery: null,
};

it('holds profile-backed domain calls until the shell health receipt is durable', async () => {
  let finish!: () => void;
  const write = vi.fn(() => new Promise<void>(resolve => { finish = resolve; }));
  const gate = createShellHealthGate(write, true);
  let opened = false;
  const domain = gate.wait().then(ready => { opened = ready; });
  const first = gate.acknowledge();
  const duplicate = gate.acknowledge();
  await Promise.resolve();
  expect(write).toHaveBeenCalledTimes(1);
  expect(opened).toBe(false);
  finish();
  expect(await first).toBe(true);
  expect(await duplicate).toBe(true);
  await domain;
  expect(opened).toBe(true);
});

it('rejects access on failed or disposed health without hanging waiting requests', async () => {
  const failed = createShellHealthGate(async () => { throw Error('fixture'); }, true);
  expect(await failed.acknowledge()).toBe(false);
  expect(await failed.wait()).toBe(false);
  const stopped = createShellHealthGate(async () => {}, true);
  stopped.dispose();
  expect(await stopped.wait()).toBe(false);
  expect(await stopped.acknowledge()).toBe(false);
});

it('never acknowledges a foreign sender or forwards arbitrary health payloads', async () => {
  const handlers = new Map<string, (event: string, route: unknown, params: unknown) => unknown>();
  const write = vi.fn(async () => {}), call = vi.fn(async () => ({ ok: true as const, status }));
  const unsubscribe = vi.fn(), send = vi.fn();
  let publish!: (state: UpdateStatus) => void;
  const bridge = registerUpdateBridge({
    ipc: { handle: (name, handler) => { handlers.set(name, handler); }, removeHandler: name => { handlers.delete(name); } },
    authorized: event => event === 'main',
    host: { status: () => status, call, subscribe: listener => { publish = listener; return unsubscribe; } },
    health: createShellHealthGate(write, true), send,
  });
  const invoke = handlers.get(UPDATE_COMMAND)!;
  expect(await invoke('iframe', 'shellReady', {})).toEqual({ ok: false, code: 'unavailable' });
  expect(await invoke('main', 'shellReady', { path: '/fixture' })).toEqual({ ok: false, code: 'unavailable' });
  expect(write).not.toHaveBeenCalled();
  expect(await invoke('main', 'shellReady', {})).toEqual({ ok: true });
  expect(await invoke('main', 'status', {})).toEqual(status);
  await invoke('iframe', 'schedule', { candidateId: 'fixture' });
  expect(call).not.toHaveBeenCalled();
  await invoke('main', 'schedule', { candidateId: 'fixture' });
  expect(call).toHaveBeenCalledWith('schedule', { candidateId: 'fixture' });
  publish(status);
  expect(send).toHaveBeenCalledTimes(1);
  bridge.dispose(); bridge.dispose();
  publish(status);
  expect(send).toHaveBeenCalledTimes(1);
  expect(unsubscribe).toHaveBeenCalledTimes(1);
  expect(handlers.size).toBe(0);
  expect(await invoke('main', 'check', {})).toEqual({ ok: false, code: 'unavailable' });
});
