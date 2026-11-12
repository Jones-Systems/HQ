import { EventEmitter } from 'node:events';
import { mkdtemp, rm, writeFile, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { createProductionDesignHost } from './design-host-production';
import type { DesignStore } from './design-host';
import {
  createImportPickWiring, IMPORT_DIALOG_BUTTON, IMPORT_DIALOG_MESSAGE, IMPORT_DIALOG_TITLE, nodeImportFs,
  type ImportPickDialogOptions, type ImportPickWindow,
} from './import-pick-wiring';

const dirs: string[] = [];
afterEach(async () => { await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true }))); });
async function workdir() { const dir = await mkdtemp(join(tmpdir(), 'hq-import-pick-')); dirs.push(dir); return dir; }
/** Signature and a bare IHDR: a synthetic PNG header, enough for the picker's own check. */
const png = (seed = 0) => { const bytes = new Uint8Array(41); bytes.set([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82]); bytes[40] = seed; return bytes; };

class FakeWindow extends EventEmitter implements ImportPickWindow {
  destroyed = false;
  isDestroyed() { return this.destroyed; }
}
function barrier<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(r => { resolve = r; });
  return { promise, resolve };
}

it('binds the dialog to the parent window with the rights wording, and reads the chosen PNGs from disk', async () => {
  const dir = await workdir();
  const home = join(dir, 'home.png'), settings = join(dir, 'settings.png');
  await writeFile(home, png(1)); await writeFile(settings, png(2));
  const parent = new FakeWindow();
  const showOpenDialog = vi.fn(async (_window: FakeWindow, _options: ImportPickDialogOptions) => ({ canceled: false, filePaths: [home, settings] }));
  const wiring = createImportPickWiring({ window: () => parent, showOpenDialog });
  expect(await wiring.pick()).toEqual({ status: 'picked', files: [
    { name: 'home.png', mediaType: 'image/png', bytes: png(1) }, { name: 'settings.png', mediaType: 'image/png', bytes: png(2) },
  ] });
  expect(showOpenDialog).toHaveBeenCalledTimes(1);
  const [window, options] = showOpenDialog.mock.calls[0]!;
  expect(window).toBe(parent);
  expect(options).toEqual({
    title: 'Choose design files', buttonLabel: 'Import selected files', message: 'Choose files covered by the rights statement you selected in HQ.',
    properties: ['openFile', 'multiSelections'], filters: [{ name: 'PNG images', extensions: ['png'] }],
  });
  expect([IMPORT_DIALOG_TITLE, IMPORT_DIALOG_BUTTON]).toEqual(['Choose design files', 'Import selected files']);
  // The native dialog repeats the explicit UI statement without inventing an ownership claim.
  expect(IMPORT_DIALOG_MESSAGE).toBe('Choose files covered by the rights statement you selected in HQ.');
  expect(IMPORT_DIALOG_MESSAGE).not.toMatch(/right to use|licen[cs]e|permission|public domain/iu);
  // Nothing stays attached to the window once the pick is over.
  expect([parent.listenerCount('close'), parent.listenerCount('closed')]).toEqual([0, 0]);
});

it('the Node fs adapter satisfies the picker: it refuses a symlink and a file that is not a PNG, and never leaks a path', async () => {
  const dir = await workdir();
  const real = join(dir, 'real.png'), link = join(dir, 'link.png'), text = join(dir, 'notes.png');
  await writeFile(real, png(3)); await symlink(real, link); await writeFile(text, 'not a png at all');
  expect(nodeImportFs.open).toBeTypeOf('function');
  for (const [path, reason] of [[link, 'unavailable'], [text, 'invalid-png']] as const) {
    const wiring = createImportPickWiring({ window: () => new FakeWindow(), showOpenDialog: async () => ({ canceled: false, filePaths: [path] }) });
    expect(await wiring.pick()).toEqual({ status: 'rejected', reason });
  }
});

it('answers canceled for a canceled dialog, and unavailable when there is no window to bind to', async () => {
  const dialog = vi.fn(async () => ({ canceled: true, filePaths: [] as string[] }));
  expect(await createImportPickWiring({ window: () => new FakeWindow(), showOpenDialog: dialog }).pick()).toEqual({ status: 'canceled' });
  const gone = new FakeWindow(); gone.destroyed = true;
  for (const window of [undefined, null, gone]) {
    dialog.mockClear();
    expect(await createImportPickWiring({ window: () => window, showOpenDialog: dialog }).pick()).toEqual({ status: 'rejected', reason: 'unavailable' });
    expect(dialog).not.toHaveBeenCalled();
  }
  const failing = createImportPickWiring({ window: () => new FakeWindow(), showOpenDialog: async () => { throw new Error('synthetic-private-path'); } });
  expect(await failing.pick()).toEqual({ status: 'rejected', reason: 'unavailable' });
});

it.each(['close', 'closed'] as const)('settles a pending pick as canceled when the window emits %s, and never reads a late answer', async event => {
  const parent = new FakeWindow(), answer = barrier<{ canceled: boolean; filePaths: string[] }>();
  const open = vi.fn();
  const wiring = createImportPickWiring({ window: () => parent, showOpenDialog: () => answer.promise, fs: { open } });
  const pending = wiring.pick();
  await Promise.resolve();
  parent.emit(event);
  expect(await pending).toEqual({ status: 'canceled' });
  answer.resolve({ canceled: false, filePaths: ['/synthetic/late.png'] });
  await new Promise(resolve => setImmediate(resolve));
  expect(open).not.toHaveBeenCalled();
  expect([parent.listenerCount('close'), parent.listenerCount('closed')]).toEqual([0, 0]);
  // A new pick works afterwards.
  answer.resolve({ canceled: true, filePaths: [] });
  expect(await createImportPickWiring({ window: () => parent, showOpenDialog: async () => ({ canceled: true, filePaths: [] }) }).pick()).toEqual({ status: 'canceled' });
});

it('cancelPending settles the open pick once, is idempotent, and allows one dialog at a time', async () => {
  const parent = new FakeWindow(), answer = barrier<{ canceled: boolean; filePaths: string[] }>();
  const dialog = vi.fn(() => answer.promise);
  const wiring = createImportPickWiring({ window: () => parent, showOpenDialog: dialog });
  wiring.cancelPending();
  const first = wiring.pick();
  await Promise.resolve();
  expect(await wiring.pick()).toEqual({ status: 'canceled' });
  expect(dialog).toHaveBeenCalledTimes(1);
  wiring.cancelPending(); wiring.cancelPending();
  expect(await first).toEqual({ status: 'canceled' });
  expect(await createImportPickWiring({ window: () => parent, showOpenDialog: async () => ({ canceled: true, filePaths: [] }) }).pick()).toEqual({ status: 'canceled' });
});

function storeStub() {
  const workspace = { getDocument: vi.fn(), putDocument: vi.fn(), listDocuments: vi.fn(), putBlob: vi.fn(), getBlob: vi.fn(), hasBlob: vi.fn(), appendEvent: vi.fn(), readEvents: vi.fn() };
  return { workspace, transactions: { workspace, status: { accepted: true, state: 'enabled' }, recover: vi.fn().mockResolvedValue({ ok: true }), commit: vi.fn(), repair: vi.fn(), diagnostics: vi.fn() },
    exportBundle: { status: { state: 'disabled' }, preview: vi.fn(), build: vi.fn() }, cache: { getDocument: vi.fn(), putDocument: vi.fn() }, close: vi.fn().mockResolvedValue(undefined) } satisfies DesignStore;
}

it('production host: opens the store with imports enabled, injects the picker, and keeps export disabled', async () => {
  const store = storeStub(), save = vi.fn();
  const open = vi.fn(async (_dir: string, _options: { readonly imports: 'enabled' }) => store);
  const dialog = vi.fn(async () => ({ canceled: true, filePaths: [] as string[] }));
  const host = createProductionDesignHost({ profileDir: () => '/synthetic/profile', save, open, pick: createImportPickWiring({ window: () => new FakeWindow(), showOpenDialog: dialog }) });
  try {
    // Picking never opens storage; the host answers from the injected picker, not as disabled.
    expect(await host.call('import.pick', {})).toEqual({ ok: true, value: { status: 'canceled' } });
    expect(dialog).toHaveBeenCalledTimes(1);
    expect(open).not.toHaveBeenCalled();
    expect(await host.ready()).toBe(true);
    expect(open).toHaveBeenCalledTimes(1);
    expect(open).toHaveBeenCalledWith('/synthetic/profile', { imports: 'enabled' });
    expect(await host.call('import.status', {})).toEqual({ ok: true, value: { accepted: true, state: 'enabled' } });
    // The store opened for the application never offers export, so the save dialog is never reached.
    for (const route of ['export.preview', 'export.save']) expect(await host.call(route, { exportedAt: '2026-01-01T00:00:00Z' })).toEqual({ ok: false, kind: 'unavailable', reason: 'disabled' });
    expect(save).not.toHaveBeenCalled();
    expect(store.exportBundle.build).not.toHaveBeenCalled();
  } finally { await host.close(); }
});

it('production host: closing settles a pending pick, so an open dialog cannot hold shutdown', async () => {
  const store = storeStub(), answer = barrier<{ canceled: boolean; filePaths: string[] }>();
  const wiring = createImportPickWiring({ window: () => new FakeWindow(), showOpenDialog: () => answer.promise });
  const host = createProductionDesignHost({ profileDir: () => '/synthetic/profile', save: vi.fn(), open: async () => store, pick: wiring });
  const picking = host.call('import.pick', {});
  await Promise.resolve();
  const closing = host.close();
  // The dialog never answers; close must still finish.
  expect(await Promise.race([closing.then(() => 'closed'), new Promise(resolve => setTimeout(() => resolve('hung'), 2000))])).toBe('closed');
  expect(await picking).toEqual({ ok: true, value: { status: 'canceled' } });
  expect(await host.call('import.pick', {})).toEqual({ ok: false, kind: 'unavailable' });
  answer.resolve({ canceled: true, filePaths: [] });
});

it('production host: closing the window settles a pending pick through the host', async () => {
  const parent = new FakeWindow(), answer = barrier<{ canceled: boolean; filePaths: string[] }>();
  const host = createProductionDesignHost({ profileDir: () => '/synthetic/profile', save: vi.fn(), open: async () => storeStub(),
    pick: createImportPickWiring({ window: () => parent, showOpenDialog: () => answer.promise }) });
  const picking = host.call('import.pick', {});
  await Promise.resolve();
  parent.emit('closed');
  expect(await picking).toEqual({ ok: true, value: { status: 'canceled' } });
  await host.close();
  answer.resolve({ canceled: true, filePaths: [] });
});
