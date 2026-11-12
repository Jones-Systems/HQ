import { DESIGN_HELD_FEATURES as RENDERER_HELD_FEATURES } from '../../../modules/design/app/compose/capabilities.ts';
import { DESIGN_HELD_FEATURES } from './design-host';
import { afterEach, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createDesignHost, DESIGN_VALUE_CAP, DOCUMENT_ROOTS, TASTE_JOURNAL_KEY, type DesignStore } from './design-host';
import { DESIGN_SERVICE_ROUTES } from '@hq/contracts/services';
const dirs: string[] = [];
afterEach(async () => { await Promise.all(dirs.splice(0).map(d => rm(d, { recursive: true, force: true }))); });
function fake() {
  const workspace = { getDocument: vi.fn().mockResolvedValue(null), putDocument: vi.fn().mockResolvedValue({}), listDocuments: vi.fn().mockResolvedValue([]), putBlob: vi.fn(), getBlob: vi.fn(), hasBlob: vi.fn(), appendEvent: vi.fn(), readEvents: vi.fn() };
  return { workspace, transactions: { workspace, status: { accepted: false, state: 'disabled' }, recover: vi.fn().mockResolvedValue({ ok: false, reason: 'disabled' }), commit: vi.fn(), repair: vi.fn(), diagnostics: vi.fn() }, exportBundle: { status: { state: 'disabled', reason: 'Unqualified' }, preview: vi.fn(), build: vi.fn() }, cache: { getDocument: vi.fn().mockResolvedValue(null), putDocument: vi.fn() }, close: vi.fn().mockResolvedValue(undefined) } satisfies DesignStore;
}
it('allowlists the r3 roots and rejects reserved storage, arbitrary connector keys and deletes', async () => {
  const store = fake(), open = vi.fn().mockResolvedValue(store), host = createDesignHost(open);
  expect(DESIGN_SERVICE_ROUTES).toContain('blob.put'); expect(DESIGN_SERVICE_ROUTES).toContain('catalog.snapshot');
  for (const key of ['design/connector/x', 'design/storage/x', 'other/x', 'design/projects/../x', 'design/projects/\u0000', 'design/projects/' + 'x'.repeat(256)]) expect(await host.call('doc.get', { key })).toEqual({ ok: false, kind: 'invalid' });
  expect(await host.call('doc.delete', { key: 'design/projects/x' })).toEqual({ ok: false, kind: 'invalid' });
  expect(await host.call('cache.get', { key: 'other' })).toEqual({ ok: false, kind: 'invalid' }); expect(open).not.toHaveBeenCalled();
  for (const root of DOCUMENT_ROOTS) { expect(await host.call('doc.get', { key: root + 'x' })).toEqual({ ok: true, value: null }); expect(await host.call('doc.list', { prefix: root })).toEqual({ ok: true, value: [] }); }
  expect(await host.call('cache.get', { key: 'design.discovery.catalog' })).toEqual({ ok: true, value: null });
  await host.close(); await host.close(); expect(store.close).toHaveBeenCalledTimes(1);
  expect(await host.call('doc.get', { key: 'design/projects/x' })).toEqual({ ok: false, kind: 'unavailable' });
});
it('reads the exact Taste journal key and forwards create-only and numeric CAS writes', async () => {
  const store = fake(), host = createDesignHost(async () => store);
  expect(TASTE_JOURNAL_KEY).toBe('design/taste/journal.v1');
  expect(await host.call('doc.get', { key: TASTE_JOURNAL_KEY })).toEqual({ ok: true, value: null });
  expect(store.transactions.workspace.getDocument).toHaveBeenCalledWith(TASTE_JOURNAL_KEY);
  for (const expectedRevision of [null, 1]) {
    const document = { value: { entries: [] }, revision: expectedRevision === null ? 1 : 2 };
    store.transactions.workspace.putDocument.mockResolvedValueOnce(document);
    expect(await host.call('doc.put', { key: TASTE_JOURNAL_KEY, value: document.value, expectedRevision })).toEqual({ ok: true, value: document });
    expect(store.transactions.workspace.putDocument).toHaveBeenLastCalledWith(TASTE_JOURNAL_KEY, document.value, { expectedRevision });
    store.transactions.workspace.getDocument.mockResolvedValueOnce(document);
    expect(await host.call('doc.get', { key: TASTE_JOURNAL_KEY })).toEqual({ ok: true, value: document });
  }
  store.transactions.workspace.putDocument.mockRejectedValueOnce(Object.assign(new Error(), { code: 'conflict' }));
  expect(await host.call('doc.put', { key: TASTE_JOURNAL_KEY, value: {}, expectedRevision: 1 })).toEqual({ ok: false, kind: 'conflict' });
  store.transactions.workspace.putDocument.mockRejectedValueOnce(new Error('Lost outcome'));
  expect(await host.call('doc.put', { key: TASTE_JOURNAL_KEY, value: {}, expectedRevision: 2 })).toEqual({ ok: false, kind: 'unknown' });
  expect(store.transactions.workspace.putDocument).toHaveBeenCalledTimes(4);
  await host.close();
});
it('keeps Taste access exact and refuses listing or importing the journal', async () => {
  const store = fake(), open = vi.fn().mockResolvedValue(store), host = createDesignHost(open);
  for (const key of ['design/taste/other', 'design/taste/journal.v1/x', 'design/taste/journal.v2']) {
    expect(await host.call('doc.get', { key })).toEqual({ ok: false, kind: 'invalid' });
    expect(await host.call('doc.put', { key, value: {} })).toEqual({ ok: false, kind: 'invalid' });
  }
  for (const prefix of ['design/taste/', TASTE_JOURNAL_KEY]) expect(await host.call('doc.list', { prefix })).toEqual({ ok: false, kind: 'invalid' });
  expect(await host.call('import.commit', { ops: [{ op: 'put-document', namespace: 'workspace', key: TASTE_JOURNAL_KEY, value: {}, expectedRevision: null }] })).toEqual({ ok: false, kind: 'invalid' });
  expect(open).not.toHaveBeenCalled();
  for (const method of [store.transactions.workspace.getDocument, store.transactions.workspace.putDocument, store.transactions.workspace.listDocuments, store.transactions.commit]) expect(method).not.toHaveBeenCalled();
  await host.close();
});
it('keeps the exact UTF-8 value cap on Taste journal writes and reads', async () => {
  const store = fake(), open = vi.fn().mockResolvedValue(store), host = createDesignHost(open);
  for (const value of ['x'.repeat(DESIGN_VALUE_CAP - 1), 'é'.repeat(DESIGN_VALUE_CAP / 2)]) expect(await host.call('doc.put', { key: TASTE_JOURNAL_KEY, value, expectedRevision: null })).toEqual({ ok: false, kind: 'invalid' });
  expect(open).not.toHaveBeenCalled();
  const value = 'é'.repeat((DESIGN_VALUE_CAP - 2) / 2);
  expect((await host.call('doc.put', { key: TASTE_JOURNAL_KEY, value, expectedRevision: null })).ok).toBe(true);
  expect(store.transactions.workspace.putDocument).toHaveBeenCalledTimes(1);
  store.transactions.workspace.getDocument.mockResolvedValueOnce({ value: 'x'.repeat(DESIGN_VALUE_CAP - 1), revision: 1 });
  expect(await host.call('doc.get', { key: TASTE_JOURNAL_KEY })).toEqual({ ok: false, kind: 'unavailable' });
  await host.close();
});
it('JSON and exact UTF-8 cap validation happens before opening', async () => {
  const store = fake(), open = vi.fn().mockResolvedValue(store), host = createDesignHost(open);
  const cyclic: Record<string, unknown> = {}; cyclic.self = cyclic;
  for (const value of [undefined, NaN, new Date(), cyclic, 'x'.repeat(DESIGN_VALUE_CAP - 1)]) expect(await host.call('doc.put', { key: 'design/projects/x', value })).toEqual({ ok: false, kind: 'invalid' });
  expect(open).not.toHaveBeenCalled();
  expect((await host.call('doc.put', { key: 'design/projects/x', value: 'x'.repeat(DESIGN_VALUE_CAP - 2) })).ok).toBe(true); await host.close();
});
it('unconditional, create-only, and numeric revision are forwarded distinctly', async () => {
  const store = fake(), host = createDesignHost(async () => store);
  await host.call('doc.put', { key: 'design/projects/x', value: {} });
  expect(store.workspace.putDocument).toHaveBeenLastCalledWith('design/projects/x', {}, {});
  for (const expectedRevision of [null, 1]) {
    await host.call('doc.put', { key: 'design/projects/x', value: {}, expectedRevision });
    expect(store.workspace.putDocument).toHaveBeenLastCalledWith('design/projects/x', {}, { expectedRevision });
    store.workspace.putDocument.mockRejectedValueOnce(Object.assign(new Error(), { code: 'conflict' }));
    expect(await host.call('doc.put', { key: 'design/projects/x', value: {}, expectedRevision })).toEqual({ ok: false, kind: 'conflict' });
  }
  await host.close();
});
it('maps read-only, closed, invalid, open/get/list failure and lost put outcomes without retries', async () => {
  const store = fake(), host = createDesignHost(async () => store);
  for (const [code, kind] of [['read-only', 'read-only'], ['closed', 'unavailable'], ['invalid-argument', 'invalid'], ['integrity', 'unknown']]) {
    store.workspace.putDocument.mockRejectedValueOnce(Object.assign(new Error(), { code }));
    expect(await host.call('doc.put', { key: 'design/projects/x', value: {} })).toEqual({ ok: false, kind });
  }
  expect(store.workspace.putDocument).toHaveBeenCalledTimes(4);
  store.workspace.getDocument.mockRejectedValueOnce(new Error()); store.workspace.listDocuments.mockRejectedValueOnce(new Error());
  expect(await host.call('doc.get', { key: 'design/projects/x' })).toEqual({ ok: false, kind: 'unavailable' });
  expect(await host.call('doc.list', { prefix: 'design/projects/' })).toEqual({ ok: false, kind: 'unavailable' });
  await host.close();
  const failed = createDesignHost(async () => { throw Error(); }); expect(await failed.call('doc.get', { key: 'design/projects/x' })).toEqual({ ok: false, kind: 'unavailable' }); await failed.close();
});
it('close waits for an admitted write and is idempotent during an in-flight open', async () => {
  const store = fake(); let resolve!: (s: DesignStore) => void;
  const host = createDesignHost(() => new Promise(r => { resolve = r; }));
  const put = host.call('doc.put', { key: 'design/projects/x', value: {} });
  const closing = host.close(); expect(host.close()).toBe(closing); expect(store.close).not.toHaveBeenCalled();
  await Promise.resolve(); resolve(store); await put; await closing; expect(store.close).toHaveBeenCalledTimes(1);
});
it('real emitted T9 store: unconditional overwrites, null-existing conflict, stale numeric conflict, persistence', async () => {
  await mkdir('.t3/shared-host', { recursive: true });
  const root = await mkdtemp(join(process.cwd(), '.t3/shared-host/real-store-')); dirs.push(root);
  const module = await import(/* @vite-ignore */ pathToFileURL(join(process.cwd(), 'apps/desktop/dist-electron/design-host/modules/design/app/storage/node.js')).href) as { openDesignStorage(options: { root: string; readOnly?: boolean }): Promise<DesignStore> };
  const host = createDesignHost(() => module.openDesignStorage({ root }));
  const key = 'design/components/example';
  expect((await host.call('doc.put', { key, value: { x: 1 } })).ok).toBe(true);
  expect((await host.call('doc.put', { key, value: { x: 2 } })).ok).toBe(true);
  expect(await host.call('doc.put', { key, value: {}, expectedRevision: null })).toEqual({ ok: false, kind: 'conflict' });
  expect(await host.call('doc.put', { key, value: {}, expectedRevision: 1 })).toEqual({ ok: false, kind: 'conflict' });
  expect((await host.call('doc.put', { key, value: { x: 3 }, expectedRevision: 2 })).ok).toBe(true);
  await host.close();
  const readonly = createDesignHost(() => module.openDesignStorage({ root, readOnly: true }));
  expect(await readonly.call('doc.get', { key })).toMatchObject({ ok: true, value: { value: { x: 3 }, revision: 3 } });
  expect(await readonly.call('doc.put', { key, value: {} })).toEqual({ ok: false, kind: 'read-only' }); await readonly.close();
});
it('oversized stored workspace and cache values fail reads without crossing IPC', async () => {
  const store = fake();
  store.workspace.getDocument.mockResolvedValue({ value: 'x'.repeat(DESIGN_VALUE_CAP) });
  store.cache.getDocument.mockResolvedValue({ value: 'x'.repeat(DESIGN_VALUE_CAP) });
  const host = createDesignHost(async () => store);
  expect(await host.call('doc.get', { key: 'design/projects/x' })).toEqual({ ok: false, kind: 'unavailable' });
  expect(await host.call('cache.get', { key: 'design.discovery.catalog' })).toEqual({ ok: false, kind: 'unavailable' });
  await host.close();
});

it('recovery is a barrier before any store operation and uses the transaction workspace', async () => {
  const store = fake(); let release!: () => void;
  store.transactions.recover.mockImplementation(() => new Promise<void>(r => { release = r; }).then(() => ({ ok: true, value: {} })));
  store.workspace = { ...store.workspace, getDocument: vi.fn(() => { throw Error('Raw workspace used'); }) };
  const host = createDesignHost(async () => store);
  const read = host.call('doc.get', { key: 'design/requests/x' });
  await new Promise(resolve => setImmediate(resolve));
  expect(store.transactions.workspace.getDocument).not.toHaveBeenCalled();
  release(); expect(await read).toEqual({ ok: true, value: null });
  expect(store.transactions.recover).toHaveBeenCalledTimes(1);
  await host.close();
});
it('disabled routes never reach mutation, diagnostics, bundle building or the save dialog', async () => {
  const store = fake(), save = vi.fn(), host = createDesignHost(async () => store, save);
  for (const [route, params] of [
    ['import.commit', { ops: [{ op: 'put-document', namespace: 'workspace', key: 'design/projects/a', value: {}, expectedRevision: null }] }],
    ['import.status', {}], ['import.repair', { txnId: 'a'.repeat(64) }], ['storage.diagnostics', {}],
    ['export.preview', { exportedAt: '2026-01-01T00:00:00Z' }], ['export.save', { exportedAt: '2026-01-01T00:00:00Z' }],
  ] as const) expect(await host.call(route, params)).toEqual({ ok: false, kind: 'unavailable', reason: 'disabled' });
  for (const method of [store.transactions.commit, store.transactions.repair, store.transactions.diagnostics, store.exportBundle.build, store.exportBundle.preview, save]) expect(method).not.toHaveBeenCalled();
  await host.close();
});
it('event types are fixed by root, extra authority fields are refused, cache writes use only the catalog key', async () => {
  const store = fake(), host = createDesignHost(async () => store);
  store.transactions.workspace.appendEvent.mockResolvedValue({ seq: 1, payload: { x: 1 }, hash: 'private-metadata' });
  expect(await host.call('event.append', { stream: 'design/requests/r/reviews', payload: { x: 1 }, clientEventId: 'one' })).toEqual({ ok: true, value: { seq: 1, payload: { x: 1 } } });
  expect(store.transactions.workspace.appendEvent).toHaveBeenCalledWith('design/requests/r/reviews', { type: 'requests.event-bytes', payload: { x: 1 }, clientEventId: 'one' });
  for (const params of [{ stream: 'design/storage/x', payload: {} }, { stream: 'design/requests/x', payload: {}, type: 'chosen' }]) expect(await host.call('event.append', params)).toEqual({ ok: false, kind: 'invalid' });
  expect(await host.call('cache.put', { key: 'other', value: {} })).toEqual({ ok: false, kind: 'invalid' });
  store.cache.putDocument.mockResolvedValue({ value: {} });
  expect((await host.call('cache.put', { key: 'design.discovery.catalog', value: { format: 'hq.design.storage.text/v1', text: '{}' } })).ok).toBe(true);
  await host.close();
});
it('blob writes enforce digest and 16 MiB cap before touching storage', async () => {
  const { createHash } = await import('node:crypto');
  const store = fake(), host = createDesignHost(async () => store);
  const bytes = new Uint8Array(16 * 1024 * 1024), expectedDigest = 'sha256:' + createHash('sha256').update(bytes).digest('hex');
  store.transactions.workspace.putBlob.mockResolvedValue({ digest: expectedDigest, bytes: bytes.length });
  expect(await host.call('blob.put', { bytes, expectedDigest })).toEqual({ ok: true, value: { digest: expectedDigest, bytes: bytes.length } });
  for (const params of [{ bytes: new Uint8Array(bytes.length + 1), expectedDigest }, { bytes: new Uint8Array([1]), expectedDigest }, { bytes, expectedDigest, path: 'forbidden' }]) expect(await host.call('blob.put', params)).toEqual({ ok: false, kind: 'invalid' });
  expect(store.transactions.workspace.putBlob).toHaveBeenCalledTimes(1); await host.close();
});
const heldFeatures = [
  { feature: 'generation-sources', status: 'held', reason: 'external-access-held' },
  { feature: 'component-runner', status: 'held', reason: 'native-qualification-pending' },
  { feature: 'jones-code-live-send', status: 'held', reason: 'live-effects-held' },
];
function withStatus(accepted: boolean, exportState: string) {
  const store = fake();
  return { ...store, transactions: { ...store.transactions, status: { accepted, state: accepted ? 'enabled' : 'disabled' } }, exportBundle: { ...store.exportBundle, status: { state: exportState } } };
}
it('design.capabilities is a registered route and reports only the opened store status and what was injected', async () => {
  expect(DESIGN_SERVICE_ROUTES).toContain('design.capabilities');
  const pick = vi.fn(), save = vi.fn();
  for (const [accepted, exportState, withPick, withSave, expected] of [
    [false, 'disabled', false, false, { imports: 'disabled', pick: 'disabled', export: 'disabled' }],
    [true, 'disabled', true, true, { imports: 'enabled', pick: 'enabled', export: 'disabled' }],
    [true, 'enabled', true, true, { imports: 'enabled', pick: 'enabled', export: 'enabled' }],
    [true, 'enabled', false, true, { imports: 'enabled', pick: 'disabled', export: 'enabled' }],
    // Export needs the save dialog as well as the store, so a host without one does not offer it.
    [true, 'enabled', true, false, { imports: 'enabled', pick: 'enabled', export: 'disabled' }],
    [false, 'enabled', false, true, { imports: 'disabled', pick: 'disabled', export: 'enabled' }],
  ] as const) {
    const store = withStatus(accepted, exportState), host = createDesignHost(async () => store, withSave ? save : undefined, withPick ? pick : undefined);
    expect(await host.call('design.capabilities', {})).toEqual({ ok: true, value: { ...expected, held: heldFeatures } });
    await host.close();
  }
  // It touches no storage, picker, bundle builder or save dialog.
  const store = withStatus(true, 'enabled'), host = createDesignHost(async () => store, save, pick);
  await host.call('design.capabilities', {});
  for (const method of [store.workspace.getDocument, store.workspace.putDocument, store.workspace.listDocuments, store.transactions.commit, store.transactions.repair,
    store.transactions.diagnostics, store.exportBundle.preview, store.exportBundle.build, store.cache.getDocument, store.cache.putDocument, pick, save]) expect(method).not.toHaveBeenCalled();
  await host.close();
});
it('design.capabilities opens the store lazily like the other routes, and answers unavailable when the open fails or the host is closed', async () => {
  const open = vi.fn(async () => withStatus(true, 'disabled')), host = createDesignHost(open);
  expect(await host.call('design.capabilities', { extra: true })).toEqual({ ok: false, kind: 'invalid' });
  expect(open).not.toHaveBeenCalled();
  expect(await host.call('design.capabilities', {})).toMatchObject({ ok: true, value: { imports: 'enabled' } });
  expect(await host.call('design.capabilities', {})).toMatchObject({ ok: true });
  expect(open).toHaveBeenCalledTimes(1);
  await host.close();
  expect(await host.call('design.capabilities', {})).toEqual({ ok: false, kind: 'unavailable' });
  const failed = createDesignHost(async () => { throw Error(); });
  expect(await failed.call('design.capabilities', {})).toEqual({ ok: false, kind: 'unavailable' });
  await failed.close();
});
it('design.capabilities returns a fresh held list on every call', async () => {
  const host = createDesignHost(async () => withStatus(false, 'disabled'));
  const first = await host.call('design.capabilities', {}) as { value: { held: { reason: string }[] } };
  first.value.held[0]!.reason = 'tampered';
  expect(await host.call('design.capabilities', {})).toMatchObject({ value: { held: heldFeatures } });
  await host.close();
});

it('keeps the host and renderer held-feature vocabulary identical', () => {
  expect(RENDERER_HELD_FEATURES).toEqual(DESIGN_HELD_FEATURES);
});
it('separates pre-save export failures from unknown save effects and cancellation', async () => {
  const store = fake(); store.exportBundle.status.state = 'enabled';
  const save = vi.fn().mockResolvedValue({ saved: false }), host = createDesignHost(async () => store, save);
  const params = { exportedAt: '2026-01-01T00:00:00Z' };
  for (const [error, kind] of [[Object.assign(new Error(), { name: 'ExportProjectionError' }), 'invalid'], [new Error(), 'unavailable']] as const) {
    store.exportBundle.preview.mockRejectedValueOnce(error); store.exportBundle.build.mockRejectedValueOnce(error);
    expect(await host.call('export.preview', params)).toEqual({ ok: false, kind });
    expect(await host.call('export.save', params)).toEqual({ ok: false, kind });
  }
  expect(save).not.toHaveBeenCalled();
  store.exportBundle.build.mockResolvedValue({ ok: true, value: { bytes: new Uint8Array([1]) } });
  expect(await host.call('export.save', params)).toEqual({ ok: true, value: { saved: false } });
  save.mockResolvedValueOnce({ saved: true });
  expect(await host.call('export.save', params)).toEqual({ ok: true, value: { saved: true } });
  save.mockRejectedValueOnce(new Error('lost'));
  expect(await host.call('export.save', params)).toEqual({ ok: false, kind: 'unknown' });
  expect(save).toHaveBeenCalledTimes(3); await host.close();
});
