import { readFileSync } from 'node:fs';
import type { Node } from '@oxc-project/types';
import type { JsonValue, StoredDocument } from '@hq/contracts/services';
import { parseAst } from 'rolldown/parseAst';
import { expect, it, vi } from 'vitest';
import { CAPTURE_RECEIPTS_ENABLED, createCaptureReceiptPersister } from './capture-receipts.js';
import { createDesignHost, DESIGN_VALUE_CAP, type DesignStore } from './design-host.js';
import { createProductionDesignHost } from './design-host-production.js';

const receiptKey = 'hq/captures/receipts/synthetic-capture';
function receipt() {
  return {
    schema: 'hq.design.capture-evidence/v1', captureId: 'synthetic-capture',
    producer: { id: 'hq.electron-preview', contract: 1, mode: 'production', appVersion: '0.0.0-synthetic', packaged: false },
    host: { sessionId: 'synthetic-session', hostVersionId: 'synthetic-host', generation: 1 },
    page: { origin: 'https://example.com', route: '/synthetic', state: '' },
    viewport: { w: 320, h: 240, dpr: 2 }, scroll: { x: 0, y: 0 },
    pageExtentCss: { width: 640, height: 960 }, imageRectCss: { x: 0, y: 0, width: 320, height: 240 },
    image: { mediaType: 'image/png', digest: `sha256:${'a'.repeat(64)}`, byteLength: 123, pixelWidth: 640, pixelHeight: 480 },
    time: { capturedAt: '2026-11-13T12:00:00Z', basis: 'host-clock-after-coherence-before-persist', acquisition: null },
    persistedAt: '2026-11-13T12:00:01Z', fixture: { state: 'unknown', attestedBy: null },
  };
}
function document(key: string, value: JsonValue): StoredDocument {
  return { namespace: 'workspace', key, revision: 1, valueDigest: `sha256:${'b'.repeat(64)}`, updatedAt: '2026-11-13T12:00:01Z', value };
}
function fakeStore() {
  const documents = new Map<string, StoredDocument>();
  const workspace = {
    getDocument: vi.fn(async (key: string) => documents.get(key) ?? null),
    putDocument: vi.fn(async (key: string, value: JsonValue, options?: { readonly expectedRevision?: number | null }) => {
      if (options?.expectedRevision === null && documents.has(key)) throw Object.assign(new Error('Exists'), { code: 'conflict' });
      const stored = document(key, value); documents.set(key, stored); return stored;
    }),
    listDocuments: vi.fn(async (prefix = '') => [...documents.keys()].filter(key => key.startsWith(prefix))),
    putBlob: vi.fn(async () => { throw new Error('Unexpected blob write'); }),
    getBlob: vi.fn(async () => null), hasBlob: vi.fn(async () => false),
    appendEvent: vi.fn(async () => { throw new Error('Unexpected event write'); }),
    readEvents: vi.fn(async () => { throw new Error('Unexpected event read'); }),
  };
  const raw = {
    getDocument: vi.fn(async () => { throw new Error('Raw workspace read'); }),
    putDocument: vi.fn(async () => { throw new Error('Raw workspace write'); }),
    listDocuments: vi.fn(async () => { throw new Error('Raw workspace list'); }),
  };
  const store = {
    workspace: raw,
    transactions: {
      workspace, status: { accepted: true, state: 'enabled' }, recover: vi.fn(async () => ({ ok: true })),
      commit: vi.fn(async () => ({ ok: true as const, value: {} })),
      repair: vi.fn(async () => ({ ok: true as const, value: {} })),
      diagnostics: vi.fn(async () => ({ ok: true as const, value: { state: 'enabled' } })),
    },
    exportBundle: {
      status: { state: 'enabled' },
      preview: vi.fn(async (exportedAt: string) => ({ ok: true as const, value: {
        exportedAt, documents: [...documents.values()].filter(value => value.key.startsWith('design/')), captures: [],
      } })),
      build: vi.fn(async () => { throw new Error('Unexpected export build'); }),
    },
    cache: { getDocument: vi.fn(async () => null), putDocument: vi.fn(async () => { throw new Error('Unexpected cache write'); }) },
    close: vi.fn(async () => {}),
  } satisfies DesignStore;
  return { store, documents };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
function walk(node: Node, visit: (node: Node) => void) {
  visit(node);
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) {
      for (const child of value) if (child && typeof child === 'object' && 'type' in child) walk(child as Node, visit);
    } else if (value && typeof value === 'object' && 'type' in value) walk(value as Node, visit);
  }
}

it('pins literal false and confines both constructors to the unselected main conditional branch by AST', () => {
  const glue = parseAst(readFileSync(new URL('./capture-receipts.ts', import.meta.url), 'utf8'), { lang: 'ts' });
  const flags: Node[] = [];
  walk(glue, node => {
    if (node.type === 'VariableDeclarator' && node.id.type === 'Identifier' && node.id.name === 'CAPTURE_RECEIPTS_ENABLED') flags.push(node);
  });
  expect(flags).toHaveLength(1);
  expect(flags[0]).toMatchObject({ init: { type: 'TSAsExpression', expression: { type: 'Literal', value: false },
    typeAnnotation: { type: 'TSTypeReference', typeName: { type: 'Identifier', name: 'const' } } } });
  const main = parseAst(readFileSync(new URL('./main.ts', import.meta.url), 'utf8'), { lang: 'ts' });
  const options: Node[] = [];
  walk(main, node => {
    if (node.type === 'CallExpression' && node.callee.type === 'Identifier' && node.callee.name === 'createPreviewHost') options.push(node.arguments[0]);
  });
  expect(options).toHaveLength(1);
  const object = options[0];
  expect(object.type).toBe('ObjectExpression');
  if (object.type !== 'ObjectExpression') throw new Error('Expected literal preview options');
  expect(object.properties).toHaveLength(3);
  const spread = object.properties[2];
  if (spread.type !== 'SpreadElement') throw new Error('Expected conditional receipt spread');
  const conditional = spread.argument.type === 'ParenthesizedExpression' ? spread.argument.expression : spread.argument;
  expect(conditional).toMatchObject({ type: 'ConditionalExpression', test: { type: 'Identifier', name: 'CAPTURE_RECEIPTS_ENABLED' },
    alternate: { type: 'ObjectExpression', properties: [] } });
  if (conditional.type !== 'ConditionalExpression') throw new Error('Expected conditional receipt composition');
  const constructions: string[] = [];
  walk(conditional.consequent, node => {
    if (node.type !== 'CallExpression') return;
    if (node.callee.type === 'Identifier') constructions.push(node.callee.name);
    if (node.callee.type === 'MemberExpression' && node.callee.property.type === 'Identifier') constructions.push(node.callee.property.name);
  });
  expect(constructions).toEqual(['createCaptureReceiptPersister', 'receiptBacking']);
  expect(CAPTURE_RECEIPTS_ENABLED).toBe(false);
});

it('keeps disabled composition lazy through the production forwarding seam', async () => {
  const { store } = fakeStore(), open = vi.fn(async () => store), profileDir = vi.fn(() => 'synthetic-profile');
  const design = createProductionDesignHost({ open, profileDir, save: vi.fn(), pick: { pick: vi.fn(), cancelPending: vi.fn() } });
  const backing = vi.spyOn(design, 'receiptBacking'), factory = vi.fn(createCaptureReceiptPersister);
  const options = { ...(CAPTURE_RECEIPTS_ENABLED ? { persistReceipt: factory(design.receiptBacking()) } : {}) };
  expect(options).not.toHaveProperty('persistReceipt');
  for (const method of [backing, factory, open, profileDir]) expect(method).not.toHaveBeenCalled();
  const injected = createCaptureReceiptPersister(design.receiptBacking());
  expect(open).not.toHaveBeenCalled();
  expect(await injected(receipt())).toBe(true);
  expect(open).toHaveBeenCalledExactlyOnceWith('synthetic-profile', { imports: 'enabled' });
  await design.close();
});

it('composes unknown/null evidence into exactly one authoritative create-only fake put', async () => {
  const { store, documents } = fakeStore(), open = vi.fn(async () => store), host = createDesignHost(open);
  const persist = createCaptureReceiptPersister(host.receiptBacking()), source = receipt();
  expect(open).not.toHaveBeenCalled();
  expect(await persist(source)).toBe(true);
  expect(store.transactions.workspace.putDocument).toHaveBeenCalledExactlyOnceWith(receiptKey, source, { expectedRevision: null });
  expect(documents.get(receiptKey)?.value).toEqual(source);
  expect(documents.get(receiptKey)?.value).not.toBe(source);
  for (const method of [store.workspace.putDocument, store.transactions.workspace.getDocument, store.transactions.workspace.listDocuments]) expect(method).not.toHaveBeenCalled();
  await host.close();
});

it('refuses invalid or attested fixtures before opening and returns false for conflicts and throws without retry', async () => {
  const { store } = fakeStore(), open = vi.fn(async () => store), host = createDesignHost(open);
  const persist = createCaptureReceiptPersister(host.receiptBacking()), source = receipt();
  for (const value of [{}, { ...source, captureId: '../bad' }, ...['known-present', 'known-absent'].map(state => ({ ...source, fixture: { state, attestedBy: 'hq.electron-preview/contract-1' } }))]) {
    expect(await persist(value)).toBe(false);
  }
  expect(open).not.toHaveBeenCalled();
  expect(await persist(source)).toBe(true);
  expect(await persist(source)).toBe(false);
  expect(store.transactions.workspace.putDocument).toHaveBeenCalledTimes(2);
  store.transactions.workspace.putDocument.mockRejectedValueOnce(new Error('Lost acknowledgement'));
  expect(await persist({ ...source, captureId: 'synthetic-second' })).toBe(false);
  expect(store.transactions.workspace.putDocument).toHaveBeenCalledTimes(3);
  await host.close();
  expect(await persist(source)).toBe(false);
  expect(store.transactions.workspace.putDocument).toHaveBeenCalledTimes(3);
  const throws = { putDocument: vi.fn(() => { throw new Error('Synchronous failure'); }) };
  expect(await createCaptureReceiptPersister(throws)(source)).toBe(false);
  expect(throws.putDocument).toHaveBeenCalledTimes(1);
  const unknown = { putDocument: vi.fn(async () => undefined) };
  expect(await createCaptureReceiptPersister(unknown)(source)).toBe(false);
  expect(unknown.putDocument).toHaveBeenCalledTimes(1);
});

it('refuses nonreceipt keys, nonnull revisions and invalid or oversized JSON before lazy open', async () => {
  const { store } = fakeStore(), open = vi.fn(async () => store), host = createDesignHost(open), backing = host.receiptBacking();
  for (const key of ['design/projects/x', 'hq/captures/receipts/', 'hq/captures/receipts/A', 'hq/captures/receipts/a/b', 'hq/captures/receipts/../a', `${receiptKey}\n`, `hq/captures/receipts/${'a'.repeat(65)}`]) {
    await expect(backing.putDocument(key, {}, { expectedRevision: null })).rejects.toMatchObject({ code: 'invalid-argument' });
  }
  for (const options of [{}, { expectedRevision: 0 }, { expectedRevision: 1 }, { expectedRevision: undefined }, { expectedRevision: null, extra: true }, null]) {
    await expect(backing.putDocument(receiptKey, {}, options as { expectedRevision: null })).rejects.toMatchObject({ code: 'invalid-argument' });
  }
  const cyclic: Record<string, unknown> = {}; cyclic.self = cyclic;
  for (const value of [undefined, NaN, new Date(0), cyclic, 'é'.repeat(DESIGN_VALUE_CAP / 2)]) {
    await expect(backing.putDocument(receiptKey, value, { expectedRevision: null })).rejects.toMatchObject({ code: 'invalid-argument' });
  }
  expect(open).not.toHaveBeenCalled();
  const value = 'é'.repeat((DESIGN_VALUE_CAP - 2) / 2);
  await expect(backing.putDocument(receiptKey, value, { expectedRevision: null })).resolves.toMatchObject({ key: receiptKey, revision: 1, value });
  expect(store.transactions.workspace.putDocument).toHaveBeenCalledTimes(1);
  await host.close();
});

it('keeps receipt routes and keys unreachable through call without opening or effects', async () => {
  const { store } = fakeStore(), open = vi.fn(async () => store), host = createDesignHost(open);
  for (const [route, params] of [
    ['receiptBacking', {}], ['hq/captures/receipts/put', { key: receiptKey, value: {} }], ['hq.captures.receipts.put', {}],
    ['doc.put', { key: receiptKey, value: {}, expectedRevision: null }], ['doc.get', { key: receiptKey }], ['doc.list', { prefix: 'hq/captures/receipts/' }],
    ['import.commit', { ops: [{ op: 'put-document', namespace: 'workspace', key: receiptKey, value: {}, expectedRevision: null }] }],
  ] as const) expect(await host.call(route, params)).toEqual({ ok: false, kind: 'invalid' });
  expect(open).not.toHaveBeenCalled();
  for (const method of [store.transactions.workspace.getDocument, store.transactions.workspace.putDocument, store.transactions.workspace.listDocuments, store.transactions.commit]) expect(method).not.toHaveBeenCalled();
  await host.close();
});

it('shares the import gate and drains a queued admitted receipt before closing', async () => {
  const { store } = fakeStore(), entered = deferred<void>(), release = deferred<void>(), order: string[] = [];
  store.transactions.commit.mockImplementationOnce(async () => { order.push('import'); entered.resolve(); await release.promise; order.push('import-done'); return { ok: true, value: {} }; });
  const put = store.transactions.workspace.putDocument.getMockImplementation()!;
  store.transactions.workspace.putDocument.mockImplementationOnce(async (...args) => { order.push('receipt'); return put(...args); });
  store.close.mockImplementationOnce(async () => { order.push('close'); });
  const host = createDesignHost(async () => store), backing = host.receiptBacking();
  const importing = host.call('import.commit', { ops: [{ op: 'put-document', namespace: 'workspace', key: 'design/projects/x', value: {}, expectedRevision: null }] });
  await entered.promise;
  const pending = backing.putDocument(receiptKey, receipt(), { expectedRevision: null }), closing = host.close();
  expect(host.close()).toBe(closing);
  await expect(backing.putDocument(`${receiptKey}-late`, {}, { expectedRevision: null })).rejects.toMatchObject({ code: 'closed' });
  expect(store.transactions.workspace.putDocument).not.toHaveBeenCalled(); expect(store.close).not.toHaveBeenCalled();
  release.resolve(); await importing; await pending; await closing;
  expect(order).toEqual(['import', 'import-done', 'receipt', 'close']);
  expect(store.transactions.workspace.putDocument).toHaveBeenCalledTimes(1); expect(store.close).toHaveBeenCalledTimes(1);
});

it('holds exclusive export behind an in-flight receipt write and preserves the admission snapshot', async () => {
  const { store } = fakeStore(), entered = deferred<void>(), release = deferred<void>(), host = createDesignHost(async () => store);
  const put = store.transactions.workspace.putDocument.getMockImplementation()!;
  store.transactions.workspace.putDocument.mockImplementationOnce(async (...args) => { entered.resolve(); await release.promise; return put(...args); });
  const source = { original: true }, pending = host.receiptBacking().putDocument(receiptKey, source, { expectedRevision: null });
  source.original = false;
  await entered.promise;
  const exporting = host.call('export.preview', { exportedAt: '2026-11-13T12:00:02Z' });
  expect(store.exportBundle.preview).not.toHaveBeenCalled();
  const closing = host.close(); expect(store.close).not.toHaveBeenCalled();
  release.resolve(); await pending;
  expect((await exporting).ok).toBe(true);
  expect(store.transactions.workspace.putDocument).toHaveBeenCalledExactlyOnceWith(receiptKey, { original: true }, { expectedRevision: null });
  await closing; expect(store.close).toHaveBeenCalledTimes(1);
});

it('drains an admitted lazy open and recovery, and fails unavailable opens or recovery without a write', async () => {
  const { store } = fakeStore(), opened = deferred<DesignStore>(), entered = deferred<void>(), release = deferred<void>();
  store.transactions.recover.mockImplementationOnce(async () => { entered.resolve(); await release.promise; return { ok: true }; });
  const host = createDesignHost(() => opened.promise), pending = host.receiptBacking().putDocument(receiptKey, {}, { expectedRevision: null }), closing = host.close();
  opened.resolve(store); await entered.promise;
  expect(store.transactions.workspace.putDocument).not.toHaveBeenCalled(); expect(store.close).not.toHaveBeenCalled();
  release.resolve(); await pending; await closing;
  expect(store.close).toHaveBeenCalledTimes(1);
  for (const failsRecovery of [false, true]) {
    const fake = fakeStore();
    fake.store.transactions.recover.mockRejectedValueOnce(new Error('Recovery unavailable'));
    const failed = createDesignHost(async () => { if (!failsRecovery) throw new Error('Open unavailable'); return fake.store; });
    expect(await createCaptureReceiptPersister(failed.receiptBacking())(receipt())).toBe(false);
    expect(fake.store.transactions.workspace.putDocument).not.toHaveBeenCalled();
    await failed.close(); expect(fake.store.close).toHaveBeenCalledTimes(failsRecovery ? 1 : 0);
  }
});

it('preserves list, export preview and diagnostics forwarding with a receipt-containing fake store', async () => {
  const { store, documents } = fakeStore(), host = createDesignHost(async () => store);
  documents.set('design/projects/synthetic', document('design/projects/synthetic', { name: 'Synthetic' }));
  const calls = [
    ['doc.list', { prefix: 'design/projects/' }], ['export.preview', { exportedAt: '2026-11-13T12:00:02Z' }], ['storage.diagnostics', {}],
  ] as const;
  const before = [];
  for (const [route, params] of calls) before.push(await host.call(route, params));
  expect(before.every(result => result.ok)).toBe(true);
  expect(await createCaptureReceiptPersister(host.receiptBacking())(receipt())).toBe(true);
  expect(documents.has(receiptKey)).toBe(true);
  for (const [index, [route, params]] of calls.entries()) expect(await host.call(route, params)).toEqual(before[index]);
  expect(store.exportBundle.preview).toHaveBeenCalledTimes(2); expect(store.transactions.diagnostics).toHaveBeenCalledTimes(2);
  expect(before[1]).toMatchObject({ ok: true, value: { captures: [] } });
  await host.close();
});
