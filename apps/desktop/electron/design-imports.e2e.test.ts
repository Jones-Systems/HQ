import { EventEmitter } from 'node:events';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import type { DesignServiceParams, DesignServiceRoute, DesignServiceTransport, DesignServiceValues, DesignStorageResult } from '@hq/contracts/services';
import { openDesignStorage } from '../../../modules/design/app/storage/node.ts';
import { openEnabledDesignStorage } from '../../../modules/design/app/storage/enabled-candidate.ts';
import { createBridgeWorkspaceDocuments } from '../../../modules/design/app/compose/bridge-documents.ts';
import { DesignOperationError } from '../../../modules/design/app/compose/errors.ts';
import { createDesignWorkspace } from '../../../modules/design/app/compose/workspace.ts';
import { createWorkspaceThumbnailPort } from '../../../modules/design/app/compose/thumbnail-port.ts';
import { createProjectsStorage } from '../../../modules/design/app/storage/index.ts';
import { createImportsController } from '../../../modules/design/imports/src/controller.ts';
import { applyImport, editImportedRecord, listRecords, planImport, type ImportPlan } from '../../../modules/design/imports/src/importer.ts';
import { projectId as importsProject } from '../../../modules/design/imports/src/contract.ts';
import { ProjectContentRepository } from '../../../modules/design/projects/src/repository.ts';
import { projectId as contentProject } from '../../../modules/design/projects/src/ids.ts';
import { createProductionDesignHost } from './design-host-production';
import { createImportPickWiring, type ImportPickWindow } from './import-pick-wiring';
import { createDesignHost } from './design-host';

const project = { id: 'proj-e2e-imports', name: 'End to end imports' };
const dirs: string[] = [];
const hosts: { close(): Promise<void> }[] = [];
afterEach(async () => {
  for (const host of hosts.splice(0).reverse()) await host.close().catch(() => undefined);
  await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })));
});

/** Signature and a bare IHDR with the given size: a synthetic PNG header the importer's own checks accept. */
function png(width: number, height: number, seed = 0): Uint8Array {
  const bytes = new Uint8Array(41);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  new DataView(bytes.buffer).setUint32(16, width);
  new DataView(bytes.buffer).setUint32(20, height);
  bytes.set([8, 6, 0, 0, 0], 24);
  bytes[40] = seed;
  return bytes;
}
class FakeWindow extends EventEmitter implements ImportPickWindow { isDestroyed() { return false; } }

async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), 'hq-imports-e2e-'));
  dirs.push(dir);
  const files = join(dir, 'chosen');
  await mkdir(files);
  const chosen: string[] = [];
  const write = async (name: string, bytes: Uint8Array | string) => { await writeFile(join(files, name), bytes); return join(files, name); };
  const window = new FakeWindow();
  const dialog = vi.fn(async (_window: unknown, _options: unknown) => ({ canceled: chosen.length === 0, filePaths: [...chosen] }));
  const save = vi.fn();
  /** One "application run": the real host over the real enabled store in `dir`, and a renderer on an IPC-like transport. */
  async function launch() {
    const open = vi.fn(async (profile: string, options: { readonly imports: 'enabled' }) => options.imports === 'enabled'
      ? openEnabledDesignStorage({ root: join(profile, 'design-store') }) : openDesignStorage({ root: join(profile, 'design-store') }));
    const host = createProductionDesignHost({ profileDir: () => dir, save, open: open as never,
      pick: createImportPickWiring({ window: () => window, showOpenDialog: (parent, options) => dialog(parent, options) }) });
    hosts.push(host);
    const routes: DesignServiceRoute[] = [];
    // Params and results cross as structured clones, like the Electron IPC channel.
    const transport: DesignServiceTransport = { async call<R extends DesignServiceRoute>(route: R, params: DesignServiceParams[R]): Promise<DesignStorageResult<DesignServiceValues[R]>> {
      routes.push(route);
      return structuredClone(await host.call(route, structuredClone(params))) as DesignStorageResult<DesignServiceValues[R]>;
    } };
    const documents = createBridgeWorkspaceDocuments(transport);
    const workspace = createDesignWorkspace(documents);
    if (!workspace.bridged) throw new Error('Expected the bridged workspace');
    const env = workspace.importsFor(project, () => { throw new Error('synthetic source is for the in-memory workspace'); });
    const controller = createImportsController(env.deps, importsProject(project.id), env.capabilities);
    const repository = new ProjectContentRepository(createProjectsStorage(documents), { now: () => new Date().toISOString() });
    const content = async () => {
      const loaded = await repository.load(contentProject(project.id));
      if (loaded.status !== 'ok') throw new Error(`content ${loaded.status}`);
      return loaded.content;
    };
    return { host, open, transport, routes, documents, workspace, env, controller, content };
  }
  return { dir, chosen, write, window, dialog, save, launch };
}
type Session = Awaited<ReturnType<Awaited<ReturnType<typeof fixture>>['launch']>>;
const ok = async <T>(promise: Promise<{ ok: boolean; value?: T }>) => { const result = await promise; expect(result.ok).toBe(true); return (result as { value: T }).value; };
const journal = async (s: Session) => (await ok<{ events: unknown[] }>(s.host.call('event.read', { stream: 'design/imports' }) as never)).events;

it('choose, plan and apply imports PNGs as project versions with thumbnails; history, undo and conflicts survive restarts', async () => {
  const f = await fixture();
  const homeBytes = png(390, 844, 1), settingsBytes = png(320, 200, 2);
  f.chosen.push(await f.write('home.png', homeBytes), await f.write('settings.png', settingsBytes));
  let s = await f.launch();

  // Choose (native picker, bound to the parent window) and plan: nothing is written yet.
  await s.controller.choose();
  expect(f.dialog).toHaveBeenCalledTimes(1);
  expect(f.dialog.mock.calls[0]![0]).toBe(f.window);
  expect(f.dialog.mock.calls[0]![1]).toMatchObject({ title: 'Choose design files you made', buttonLabel: 'Import as my work' });
  expect(s.controller.getState().status).toBe('planned');
  expect(s.controller.getState().summary?.rows.map(row => [row.key, row.action])).toEqual([['home.png', 'New'], ['settings.png', 'New']]);
  expect(s.routes).not.toContain('import.commit');
  expect(await journal(s)).toEqual([]);
  expect(s.open).toHaveBeenCalledWith(f.dir, { imports: 'enabled' });

  // Apply: one atomic commit; the imported images are project versions with thumbnails.
  await s.controller.apply();
  expect(s.controller.getState().status, s.controller.getState().message ?? '').toBe('applied');
  expect(s.routes.filter(route => route === 'import.commit')).toHaveLength(1);
  expect(s.workspace.contentEvents.revision(project.id)).toBe(1);
  let content = await s.content();
  expect([content.views.length, content.versions.length]).toEqual([2, 2]);
  const records = await listRecords(s.env.deps, importsProject(project.id));
  const thumbnails = createWorkspaceThumbnailPort(s.documents);
  for (const [name, bytes] of [['home.png', homeBytes], ['settings.png', settingsBytes]] as const) {
    const version = content.versions.find(candidate => candidate.id === records.find(record => record.itemKey === name)!.versionId)!;
    expect(version.origin).toBe('imported');
    expect(version.thumbnail).toMatchObject({ mediaType: 'image/png', bytes: bytes.byteLength });
    const loaded = await thumbnails.readThumbnail(version.thumbnail!, new AbortController().signal);
    expect([loaded.mediaType, [...loaded.bytes]]).toEqual(['image/png', [...bytes]]);
  }
  const importId = s.controller.getState().history[0]!.importId;
  expect(await journal(s)).toHaveLength(1);

  // Restart: history, the records and the versions are all still there.
  await s.host.close();
  s = await f.launch();
  await s.controller.refresh();
  expect(s.controller.getState().history.map(entry => [entry.importId, entry.undone])).toEqual([[importId, false]]);
  expect(await journal(s)).toHaveLength(1);
  expect((await s.content()).versions.map(version => version.id)).toEqual(content.versions.map(version => version.id));

  // Re-importing identical files changes nothing: no commit, nothing written.
  const before = JSON.stringify(await ok(s.host.call('doc.get', { key: `design/projects/${(await s.documents.listDocuments('design/projects/'))[0]!.slice('design/projects/'.length)}` })));
  await s.controller.choose();
  expect(s.controller.getState().summary?.canApply).toBe(false);
  expect(s.controller.getState().summary?.headline).toMatch(/^Already imported/u);
  await s.controller.apply();
  expect(s.routes).not.toContain('import.commit');
  expect(await journal(s)).toHaveLength(1);
  expect(JSON.stringify(await ok(s.host.call('doc.get', { key: `design/projects/${(await s.documents.listDocuments('design/projects/'))[0]!.slice('design/projects/'.length)}` })))).toBe(before);
  expect(s.workspace.contentEvents.revision(project.id)).toBe(0);

  // A changed file under the same name is an update, and an owner-edited record turns it into a conflict.
  for (const record of await listRecords(s.env.deps, importsProject(project.id))) await editImportedRecord(s.env.deps, record.recordId, { title: `Mine ${record.itemKey}` });
  f.chosen.length = 0;
  f.chosen.push(await f.write('home.png', png(390, 844, 9)), await f.write('settings.png', png(320, 200, 8)));
  await s.controller.choose();
  expect(s.controller.getState().summary?.rows.map(row => row.action)).toEqual(['Conflict — your edits kept', 'Conflict — your edits kept']);
  await s.controller.apply();
  expect((await s.content()).versions).toHaveLength(2);

  // Restart again: both open conflicts persist, and the original import can still be undone.
  await s.host.close();
  s = await f.launch();
  await s.controller.refresh();
  expect(s.controller.getState().conflicts.map(conflict => conflict.itemKey).sort()).toEqual(['home.png', 'settings.png']);
  const [home, settings] = ['home.png', 'settings.png'].map(name => s.controller.getState().conflicts.find(conflict => conflict.itemKey === name)!);
  await s.controller.resolve(home!.recordId, 'take-incoming');
  await s.controller.resolve(settings!.recordId, 'keep-current');
  content = await s.content();
  expect(content.versions).toHaveLength(3);
  const taken = (await listRecords(s.env.deps, importsProject(project.id))).find(record => record.itemKey === 'home.png')!;
  expect(content.versions.at(-1)).toMatchObject({ id: taken.versionId, ordinal: 2, origin: 'imported' });

  // Undo leaves every version in place.
  const original = s.controller.getState().history.find(entry => entry.importId === importId)!;
  await s.controller.undo(original.importId);
  expect(s.controller.getState().history.find(entry => entry.importId === importId)!.undone).toBe(true);
  expect((await s.content()).versions).toHaveLength(3);
  await s.host.close();
  s = await f.launch();
  await s.controller.refresh();
  expect(s.controller.getState().history.find(entry => entry.importId === importId)!.undone).toBe(true);
  expect(f.save).not.toHaveBeenCalled();
});

it('rejects with typed failures from the real host and picker: stale plan, bad file, nothing chosen, disabled imports', async () => {
  const f = await fixture();
  f.chosen.push(await f.write('home.png', png(10, 10, 1)));
  const s = await f.launch();
  await s.controller.choose();
  const stale = await planImport(s.env.deps, { projectId: importsProject(project.id), source: (await s.env.capabilities.pickSource!())! }) as ImportPlan;
  await s.controller.apply();
  await expect(applyImport(s.env.deps, stale)).rejects.toSatisfy((error: unknown) => error instanceof DesignOperationError
    && error.kind === 'conflict' && error.operation === 'imports.apply' && error.outcome === 'no-effect');
  // A file that is not a PNG is refused by the picker with its reason.
  f.chosen.length = 0;
  f.chosen.push(await f.write('notes.png', 'not a png at all'));
  await expect(s.env.capabilities.pickSource!()).rejects.toMatchObject({ kind: 'invalid', reason: 'invalid-png', operation: 'imports.pick' });
  // Canceling picks nothing.
  f.chosen.length = 0;
  expect(await s.env.capabilities.pickSource!()).toBeNull();
  // A host without a picker, and a store that did not enable imports, are definite disabled failures.
  const bare = createDesignHost(async () => openDesignStorage({ root: join(f.dir, 'disabled-store') })); hosts.push(bare);
  const transport: DesignServiceTransport = { async call(route, params) { return structuredClone(await bare.call(route, structuredClone(params))) as never; } };
  const documents = createBridgeWorkspaceDocuments(transport);
  const env = createDesignWorkspace(documents).importsFor(project, () => { throw new Error('unused'); });
  await expect(env.capabilities.pickSource!()).rejects.toMatchObject({ kind: 'disabled', reason: 'disabled', outcome: 'no-effect', operation: 'imports.pick' });
  const plan = stale; // Any plan: the store is not accepting imports at all.
  await expect(applyImport(env.deps, { ...plan, noop: false })).rejects.toMatchObject({ kind: 'disabled', outcome: 'no-effect', operation: 'imports.apply' });
});

it('on the real host imports documents are read through doc.get and doc.list, never written by doc.put, and export stays off', async () => {
  const f = await fixture();
  f.chosen.push(await f.write('home.png', png(12, 12, 4)));
  const s = await f.launch();
  await s.controller.choose();
  await s.controller.apply();
  const keys = await ok<string[]>(s.host.call('doc.list', { prefix: 'design/imports/records/' }) as never);
  expect(keys).toHaveLength(1);
  expect(await s.host.call('doc.get', { key: keys[0]! })).toMatchObject({ ok: true, value: { key: keys[0], revision: 1 } });
  expect((await s.host.call('doc.list', { prefix: 'design/imports/' })).ok).toBe(true);
  expect(await s.host.call('doc.put', { key: keys[0]!, value: { tampered: true } })).toEqual({ ok: false, kind: 'invalid' });
  expect(await s.host.call('doc.put', { key: 'design/imports/records/new', value: {}, expectedRevision: null })).toEqual({ ok: false, kind: 'invalid' });
  expect(await s.host.call('doc.get', { key: keys[0]! })).toMatchObject({ ok: true, value: { revision: 1 } });
  for (const route of ['export.preview', 'export.save']) expect(await s.host.call(route, { exportedAt: '2026-01-01T00:00:00Z' })).toEqual({ ok: false, kind: 'unavailable', reason: 'disabled' });
  expect(f.save).not.toHaveBeenCalled();
  expect(existsSync(join(f.dir, 'design-store'))).toBe(true);
  expect(await s.host.call('import.status', {})).toEqual({ ok: true, value: { accepted: true, state: 'enabled' } });
});
