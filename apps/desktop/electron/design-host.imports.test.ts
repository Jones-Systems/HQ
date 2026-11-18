import { expect, it, vi } from 'vitest';
import { createDesignHost, DOCUMENT_ROOTS, IMPORT_DOCUMENT_ROOTS, type DesignStore } from './design-host';

function fake(accepted = true) {
  const workspace = { getDocument: vi.fn().mockResolvedValue(null), putDocument: vi.fn().mockResolvedValue({}), listDocuments: vi.fn().mockResolvedValue([]), putBlob: vi.fn(), getBlob: vi.fn(), hasBlob: vi.fn(), appendEvent: vi.fn(), readEvents: vi.fn().mockResolvedValue({ events: [], status: { state: 'ok' } }) };
  const commit = vi.fn().mockResolvedValue({ ok: true, value: { txnId: 'a'.repeat(64) } });
  return {
    workspace, transactions: { workspace, status: { accepted, state: accepted ? 'enabled' : 'disabled' }, recover: vi.fn().mockResolvedValue({ ok: accepted, ...(accepted ? {} : { reason: 'disabled' }) }), commit, repair: vi.fn(), diagnostics: vi.fn() },
    exportBundle: { status: { state: 'disabled', reason: 'Unqualified' }, preview: vi.fn(), build: vi.fn() },
    cache: { getDocument: vi.fn().mockResolvedValue(null), putDocument: vi.fn() }, close: vi.fn().mockResolvedValue(undefined),
  } satisfies DesignStore;
}
const key = (root: string) => `${root}rec_synthetic`;
const put = (keyValue: string) => ({ op: 'put-document' as const, namespace: 'workspace', key: keyValue, value: { synthetic: true }, expectedRevision: null });

it('lists the imports roots, none of which is a writable document root', () => {
  expect(IMPORT_DOCUMENT_ROOTS).toEqual(['design/imports/records/', 'design/imports/versions/', 'design/imports/manifests/', 'design/imports/conflicts/', 'design/imports/undo/']);
  for (const root of IMPORT_DOCUMENT_ROOTS) expect(DOCUMENT_ROOTS.some(writable => root.startsWith(writable))).toBe(false);
});

it.each(IMPORT_DOCUMENT_ROOTS)('reads %s through doc.get and doc.list', async root => {
  const store = fake(), host = createDesignHost(async () => store);
  const stored = { namespace: 'workspace', key: key(root), revision: 3, value: { synthetic: true } };
  store.workspace.getDocument.mockResolvedValueOnce(stored);
  store.workspace.listDocuments.mockResolvedValueOnce([key(root)]);
  expect(await host.call('doc.get', { key: key(root) })).toEqual({ ok: true, value: stored });
  expect(await host.call('doc.list', { prefix: root })).toEqual({ ok: true, value: [key(root)] });
  expect(store.workspace.getDocument).toHaveBeenCalledWith(key(root));
  expect(store.workspace.listDocuments).toHaveBeenCalledWith(root);
  await host.close();
});

it('reads the whole imports prefix, but only well-formed imports keys', async () => {
  const store = fake(), open = vi.fn().mockResolvedValue(store), host = createDesignHost(open);
  expect(await host.call('doc.list', { prefix: 'design/imports/' })).toEqual({ ok: true, value: [] });
  const refused = ['design/imports/', 'design/imports', 'design/imports/other/x', 'design/imports/records/', 'design/imports/records/../x',
    'design/imports/records/\u0000', 'design/imports/records/' + 'x'.repeat(256), ' design/imports/records/x', 'design/imports/recordsx/y'];
  for (const keyValue of refused) expect(await host.call('doc.get', { key: keyValue })).toEqual({ ok: false, kind: 'invalid' });
  for (const prefix of ['design/imports', 'design/imports/other/', 'design/importsx/', 'design/imports/records/../']) expect(await host.call('doc.list', { prefix })).toEqual({ ok: false, kind: 'invalid' });
  expect(store.workspace.getDocument).not.toHaveBeenCalled();
  await host.close();
});

it.each(IMPORT_DOCUMENT_ROOTS)('refuses doc.put under %s, with and without a revision, before the store opens', async root => {
  const store = fake(), open = vi.fn().mockResolvedValue(store), host = createDesignHost(open);
  for (const extra of [{}, { expectedRevision: null }, { expectedRevision: 1 }]) expect(await host.call('doc.put', { key: key(root), value: {}, ...extra })).toEqual({ ok: false, kind: 'invalid' });
  expect(open).not.toHaveBeenCalled();
  expect(store.workspace.putDocument).not.toHaveBeenCalled();
  await host.close();
});

it('writes imports documents only through the atomic import.commit, together with project content and the imports stream', async () => {
  const store = fake(), host = createDesignHost(async () => store);
  const ops = [
    put(key('design/imports/records/')), put(key('design/imports/versions/')), put(key('design/imports/manifests/')), put(key('design/imports/conflicts/')), put(key('design/imports/undo/')),
    put('design/projects/design.projects/content/synthetic-project'),
    { op: 'append-event' as const, namespace: 'workspace', stream: 'design/imports', payload: { type: 'import.applied' }, expectedSeq: 0 },
  ];
  expect(await host.call('import.commit', { ops })).toEqual({ ok: true, value: { txnId: 'a'.repeat(64) } });
  expect(store.transactions.commit).toHaveBeenCalledTimes(1);
  expect(store.transactions.commit).toHaveBeenCalledWith(ops);
  expect(store.workspace.putDocument).not.toHaveBeenCalled();
  await host.close();
});

it('still refuses import.commit documents outside every allowed root, including malformed imports keys', async () => {
  const store = fake(), open = vi.fn().mockResolvedValue(store), host = createDesignHost(open);
  for (const keyValue of ['design/imports/other/x', 'design/imports/records/', 'design/imports/records/../x', 'design/imports/x', 'design/storage/x', 'design/connector/x', 'design/taste/journal.v1'])
    expect(await host.call('import.commit', { ops: [put(keyValue)] })).toEqual({ ok: false, kind: 'invalid' });
  expect(open).not.toHaveBeenCalled();
  expect(store.transactions.commit).not.toHaveBeenCalled();
  await host.close();
});

it('keeps the imports event stream and stays disabled where the store did not accept imports', async () => {
  const store = fake();
  store.workspace.readEvents.mockResolvedValueOnce({ events: [{ seq: 1, payload: { type: 'import.applied' }, hash: 'private' }], status: { state: 'ok' } });
  const host = createDesignHost(async () => store);
  expect(await host.call('event.read', { stream: 'design/imports' })).toEqual({ ok: true, value: { events: [{ seq: 1, payload: { type: 'import.applied' } }], status: { state: 'ok' } } });
  expect(await host.call('event.read', { stream: 'design/imports/records/x' })).toEqual({ ok: false, kind: 'invalid' });
  await host.close();
  const off = fake(false), disabledHost = createDesignHost(async () => off);
  expect(await disabledHost.call('import.commit', { ops: [put(key('design/imports/records/'))] })).toEqual({ ok: false, kind: 'unavailable', reason: 'disabled' });
  expect(off.transactions.commit).not.toHaveBeenCalled();
  await disabledHost.close();
});
