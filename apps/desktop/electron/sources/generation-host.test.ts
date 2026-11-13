import { afterEach, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { jsonStore } from '../jones-code/storage.js';
import { createGenerationSources, GenerationSourceError } from './generation-sources.js';
import type { GenerationSourceRecord, GenerationSourcesApi } from './generation-sources.js';
import type { GenerationBinding, ServingGenerationConsumer, ServingState } from './generations/index.js';
import { createGenerationSourcesHost } from './generation-host.js';

const generationsImport = vi.hoisted(() => vi.fn());
vi.mock('./generations/index.js', () => {
  generationsImport();
  throw Error('Real generations import is forbidden in host tests');
});

vi.mock('../jones-code/storage.js', async original => {
  const actual = await original<typeof import('../jones-code/storage.js')>();
  return { ...actual, jsonStore: vi.fn(actual.jsonStore) };
});
vi.mock('./generation-sources.js', async original => {
  const actual = await original<typeof import('./generation-sources.js')>();
  return { ...actual, createGenerationSources: vi.fn(actual.createGenerationSources) };
});
vi.mock('node:fs/promises', async original => {
  const actual = await original<typeof import('node:fs/promises')>();
  return { ...actual, readFile: vi.fn(actual.readFile), mkdir: vi.fn(actual.mkdir),
    open: vi.fn(actual.open), rename: vi.fn(actual.rename), unlink: vi.fn(actual.unlink) };
});

const hosts: ReturnType<typeof createGenerationSourcesHost>[] = [], directories: string[] = [];
afterEach(async () => {
  try { await Promise.all(hosts.splice(0).map(host => host.close())); }
  finally {
    await Promise.all(directories.splice(0).map(root => rm(root, { recursive: true, force: true })));
    vi.clearAllMocks();
  }
});
function host(options: Parameters<typeof createGenerationSourcesHost>[0]) {
  const value = createGenerationSourcesHost(options); hosts.push(value); return value;
}
const binding: GenerationBinding = { publisherId: 'synthetic-publisher', hostId: 'synthetic-host', rootId: 'synthetic-root',
  bindingRevision: 'accepted-revision', origin: 'http://127.0.0.1:48123', scopeDigest: 'a'.repeat(64), consistencyMode: 'observed-files-v1' };
const generation = { rootId: binding.rootId, epoch: '900719925474099312345', sequence: '900719925474099398765', manifestSha256: 'b'.repeat(64) };
function fakeApi() {
  const state: { value: ServingState } = { value: { status: 'empty' } };
  const unexpected = vi.fn(async (): Promise<never> => { throw Error('Operational generation call is forbidden'); });
  const consumer: ServingGenerationConsumer = { serving: vi.fn(async () => structuredClone(state.value)),
    refresh: unexpected, current: unexpected, manifest: unexpected, readFile: unexpected };
  const api: GenerationSourcesApi = {
    readConsumerBindingSet: unexpected, diffBindingSets: vi.fn(() => { throw Error('No publisher import'); }),
    bindingKey: value => JSON.stringify([value.publisherId, value.hostId, value.rootId]),
    rebindable: (a, b) => a.origin !== b.origin || a.bindingRevision !== b.bindingRevision,
    createGenerationConsumer: vi.fn(() => consumer),
  };
  return { api, consumer, state, unexpected };
}
async function fixture(seed = false) {
  const userData = await mkdtemp(join(tmpdir(), 'hq-generation-host-')); directories.push(userData);
  if (seed) {
    const record: GenerationSourceRecord = { schema: 'hq.generation-sources/v1', recordRevision: '900719925474099312345',
      publishers: [{ publisherId: binding.publisherId, accepted: { hostId: binding.hostId, setRevision: '1', sha256: 'c'.repeat(64) } }],
      sources: [{ sourceId: 'synthetic-source', ownerState: 'active', issuance: 'issued', reason: 'issued', binding, acceptedSetRevision: '1' }] };
    await mkdir(join(userData, 'sources'));
    await writeFile(join(userData, 'sources', 'generation-sources.json'), JSON.stringify(record), { mode: 0o600 });
  }
  const fake = fakeApi();
  return { userData, ...fake, make: (path = userData) => host({ userData: path, mode: 'enabled', generations: fake.api }) };
}

it('keeps default and explicit disabled calls inert, including invalid routes and calls after close', async () => {
  const fs = await import('node:fs/promises');
  for (const mode of [undefined, 'disabled'] as const) {
    const disabled = host({ mode,
      get userData(): string { throw Error('Disabled host must not inspect storage'); },
      get generations(): GenerationSourcesApi { throw Error('Disabled host must not construct generations'); } });
    expect(Object.keys(disabled).sort()).toEqual(['call', 'close']);
    for (const route of ['snapshot', 'serving', 'registerPublisher', 'importPublisher', 'setOwnerState', 'refresh', null])
      for (const params of [{}, { sourceId: 'synthetic-source' }, null])
        expect(await disabled.call(route, params)).toEqual({ ok: false, kind: 'unavailable', reason: 'disabled' });
    const closing = disabled.close(); expect(disabled.close()).toBe(closing); await closing;
    expect(await disabled.call('snapshot', {})).toEqual({ ok: false, kind: 'unavailable', reason: 'disabled' });
  }
  expect(jsonStore).not.toHaveBeenCalled(); expect(createGenerationSources).not.toHaveBeenCalled();
  for (const operation of [fs.readFile, fs.mkdir, fs.open, fs.rename, fs.unlink]) expect(operation).not.toHaveBeenCalled();
});

it('lazily opens only the temporary record and returns empty snapshot and source_unknown without a consumer', async () => {
  const f = await fixture(), enabled = f.make();
  expect(jsonStore).not.toHaveBeenCalled(); expect(createGenerationSources).not.toHaveBeenCalled();
  expect(await enabled.call('snapshot', {})).toEqual({ ok: true, value: [] });
  expect(await enabled.call('serving', { sourceId: 'unknown' })).toEqual({ ok: true, value: { status: 'unavailable', reason: 'source_unknown' } });
  expect(jsonStore).toHaveBeenCalledExactlyOnceWith(join(f.userData, 'sources'), 'generation-sources.json');
  expect(vi.mocked(readFile).mock.calls.map(([path]) => path)).toEqual([
    join(f.userData, 'sources', 'generation-sources.json'), join(f.userData, 'sources', 'generation-sources.json')]);
  expect(f.api.createGenerationConsumer).not.toHaveBeenCalled(); expect(f.unexpected).not.toHaveBeenCalled();
  expect(await readdir(f.userData)).toEqual([]);
  const closing = enabled.close(); expect(enabled.close()).toBe(closing); await closing;
  expect(await enabled.call('snapshot', {})).toEqual({ ok: false, kind: 'unavailable', reason: 'writer_closed' });
});

it('rejects operational routes and malformed parameters before opening storage', async () => {
  const f = await fixture(), enabled = f.make();
  for (const [route, params] of [
    ['registerPublisher', {}], ['importPublisher', {}], ['setOwnerState', {}], ['refresh', {}], ['unknown', {}], [null, {}],
    ['snapshot', null], ['snapshot', []], ['snapshot', { extra: true }], ['serving', {}], ['serving', { sourceId: 7 }],
    ...['', '../source', 'source/name', 'source\n', 'a'.repeat(129)].map(sourceId => ['serving', { sourceId }]),
    ['serving', { sourceId: 'synthetic-source', extra: true }],
  ]) expect(await enabled.call(route, params)).toEqual({ ok: false, kind: 'invalid' });
  expect(jsonStore).not.toHaveBeenCalled(); expect(createGenerationSources).not.toHaveBeenCalled();
  expect(f.api.createGenerationConsumer).not.toHaveBeenCalled(); expect(f.unexpected).not.toHaveBeenCalled();
});

it('projects snapshot fields and preserves serving states and arbitrarily large decimal counters', async () => {
  const f = await fixture(true), enabled = f.make();
  const pending: ServingState = { status: 'rebind_pending', generation, served: { bindingRevision: 'served-revision', origin: 'http://127.0.0.1:48124' } };
  f.state.value = pending;
  expect(await enabled.call('snapshot', {})).toEqual({ ok: true, value: [{ sourceId: 'synthetic-source', ownerState: 'active',
    issuance: { state: 'issued', reason: 'issued' }, served: { bindingRevision: 'served-revision' }, accepted: { bindingRevision: binding.bindingRevision } }] });
  for (const status of ['rebind_pending', 'active'] as const) {
    f.state.value = { ...pending, status };
    expect(await enabled.call('serving', { sourceId: 'synthetic-source' })).toEqual({ ok: true, value: {
      status: status === 'active' ? 'current' : 'pending', generation,
      served: pending.served, accepted: { bindingRevision: binding.bindingRevision, origin: binding.origin } } });
  }
  for (const value of [{ status: 'empty' }, { status: 'held', reason: 'transport_unavailable', lastGood: generation }] as const) {
    f.state.value = value;
    expect(await enabled.call('serving', { sourceId: 'synthetic-source' })).toEqual({ ok: true, value });
    expect(await enabled.call('snapshot', {})).toEqual({ ok: true, value: [{ sourceId: 'synthetic-source', ownerState: 'active',
      issuance: { state: 'issued', reason: 'issued' }, served: null, accepted: { bindingRevision: binding.bindingRevision } }] });
  }
  expect(f.api.createGenerationConsumer).toHaveBeenCalledExactlyOnceWith({ storeRoot: join(f.userData, 'sources', 'generations', 'synthetic-source'), binding, rebind: 'same-scope-v1' });
  expect(f.unexpected).not.toHaveBeenCalled();
});

it('surfaces writer_exists for the same normalized store and releases only its own writer on idempotent close', async () => {
  const f = await fixture(), first = f.make(), second = f.make(join(f.userData, 'nested', '..'));
  const results = await Promise.all([first.call('snapshot', {}), second.call('snapshot', {})]);
  expect(results).toEqual([{ ok: true, value: [] }, { ok: false, kind: 'unavailable', reason: 'writer_exists' }]);
  expect(jsonStore).toHaveBeenCalledTimes(1);
  await second.close();
  const third = f.make();
  expect(await third.call('snapshot', {})).toEqual({ ok: false, kind: 'unavailable', reason: 'writer_exists' });
  expect(await first.call('snapshot', {})).toEqual({ ok: true, value: [] });
  const closing = first.close(); expect(first.close()).toBe(closing); await closing;
  const replacement = f.make();
  expect(await replacement.call('snapshot', {})).toEqual({ ok: true, value: [] });
  expect(f.api.createGenerationConsumer).not.toHaveBeenCalled(); expect(f.unexpected).not.toHaveBeenCalled();
});

const lifecycleCalls = [
  ['registerPublisher', { publisherId: 'synthetic-publisher', expectedRevision: '0' }],
  ['importPublisher', { publisherId: 'synthetic-publisher', expectedRevision: '900719925474099312345' }],
  ['setOwnerState', { sourceId: 'synthetic-source', ownerState: 'removed', expectedRevision: '0' }],
  ['refresh', { sourceId: 'synthetic-source' }],
] as const;

it('requires injection for all four lifecycle routes before inspecting params, storage or the real import fallback', async () => {
  const fs = await import('node:fs/promises');
  const enabled = host({ mode: 'enabled', get userData(): string { throw Error('No storage without injection'); } });
  const injected = fakeApi();
  for (const mode of [undefined, 'disabled'] as const) {
    const disabled = host({ userData: 'unused', mode, generations: injected.api });
    for (const [route, params] of [['snapshot', {}], ['serving', { sourceId: 'synthetic-source' }], ...lifecycleCalls] as const)
      expect(await disabled.call(route, params)).toEqual({ ok: false, kind: 'unavailable', reason: 'disabled' });
    for (const spy of [injected.consumer.serving, injected.api.createGenerationConsumer, injected.api.diffBindingSets, injected.unexpected])
      expect(spy).not.toHaveBeenCalled();
  }
  for (const [route, params] of lifecycleCalls) {
    expect(await enabled.call(route, params)).toEqual({ ok: false, kind: 'unavailable', reason: 'disabled' });
    expect(await enabled.call(route, null)).toEqual({ ok: false, kind: 'unavailable', reason: 'disabled' });
  }
  expect(generationsImport).not.toHaveBeenCalled();
  expect(jsonStore).not.toHaveBeenCalled(); expect(createGenerationSources).not.toHaveBeenCalled();
  for (const operation of [fs.readFile, fs.mkdir, fs.open, fs.rename, fs.unlink]) expect(operation).not.toHaveBeenCalled();
});

it('validates closed lifecycle params, opaque IDs and canonical decimal revisions without constructing a writer', async () => {
  const f = fakeApi(), enabled = host({ userData: 'unused', mode: 'enabled', generations: f.api });
  const invalid: [unknown, unknown][] = [];
  for (const [route, params] of lifecycleCalls) {
    invalid.push([route, null], [route, []], [route, {}], [route, { ...params, extra: true }]);
    for (const key of Object.keys(params)) {
      const missing = { ...params } as Record<string, unknown>; delete missing[key];
      invalid.push([route, missing]);
    }
    const idKey = 'publisherId' in params ? 'publisherId' : 'sourceId';
    for (const id of ['', '../source', 'source/name', 'source\n', '_source', 'a'.repeat(129), 1, null])
      invalid.push([route, { ...params, [idKey]: id }]);
    if ('expectedRevision' in params)
      for (const expectedRevision of ['', '00', '01', '-1', '+1', '1.0', '1e2', '1\n', 0, null])
        invalid.push([route, { ...params, expectedRevision }]);
  }
  for (const ownerState of ['inactive', 'ACTIVE', '', null, true])
    invalid.push(['setOwnerState', { sourceId: 'source', ownerState, expectedRevision: '0' }]);
  for (const [route, params] of invalid) expect(await enabled.call(route, params)).toEqual({ ok: false, kind: 'invalid' });
  expect(jsonStore).not.toHaveBeenCalled(); expect(createGenerationSources).not.toHaveBeenCalled();
  expect(f.unexpected).not.toHaveBeenCalled(); expect(generationsImport).not.toHaveBeenCalled();
});

type Writer = ReturnType<typeof createGenerationSources>;
function fakeWriterHost(constructionError?: Error) {
  const record: GenerationSourceRecord = { schema: 'hq.generation-sources/v1', recordRevision: '900719925474099312345', publishers: [], sources: [] };
  const writer = {
    snapshot: vi.fn<Writer['snapshot']>().mockResolvedValue(record),
    registerPublisher: vi.fn<Writer['registerPublisher']>().mockResolvedValue(record),
    importPublisher: vi.fn<Writer['importPublisher']>().mockResolvedValue({ kind: 'unchanged', recordRevision: record.recordRevision }),
    setOwnerState: vi.fn<Writer['setOwnerState']>().mockResolvedValue(record),
    serving: vi.fn<Writer['serving']>().mockResolvedValue({ status: 'empty' }),
    refresh: vi.fn<Writer['refresh']>().mockResolvedValue({ status: 'unavailable', reason: 'source_unknown' }),
    close: vi.fn<Writer['close']>().mockResolvedValue(undefined),
  };
  const forbiddenStore = {
    read: vi.fn(async (): Promise<GenerationSourceRecord | null> => { throw Error('Fake writer must not read storage'); }),
    write: vi.fn(async (): Promise<void> => { throw Error('Fake writer must not write storage'); }),
  };
  vi.mocked(jsonStore).mockReturnValueOnce(forbiddenStore);
  if (constructionError) vi.mocked(createGenerationSources).mockImplementationOnce(() => { throw constructionError; });
  else vi.mocked(createGenerationSources).mockReturnValueOnce(writer);
  const fake = fakeApi(), enabled = host({ userData: 'synthetic-unused', mode: 'enabled', generations: fake.api });
  return { enabled, writer, record, fake, forbiddenStore };
}

it('maps lifecycle arguments and projects only revisions and import outcomes from the injected fake writer', async () => {
  const f = fakeWriterHost();
  const revision = { recordRevision: f.record.recordRevision };
  const publisherId = 'A' + '_-9'.repeat(42) + 'z';
  expect(publisherId.length).toBe(128);
  expect(await f.enabled.call('registerPublisher', { publisherId, expectedRevision: '0' })).toEqual({ ok: true, value: revision });
  expect(f.writer.registerPublisher).toHaveBeenCalledExactlyOnceWith(publisherId, '0');
  for (const ownerState of ['active', 'removed'] as const) {
    expect(await f.enabled.call('setOwnerState', { sourceId: 'S_-9', ownerState, expectedRevision: f.record.recordRevision }))
      .toEqual({ ok: true, value: revision });
    expect(f.writer.setOwnerState).toHaveBeenLastCalledWith('S_-9', ownerState, f.record.recordRevision);
  }
  for (const result of [
    { kind: 'held', reason: 'publisher_unregistered', extra: 'private' },
    { kind: 'held', reason: 'transport_unavailable', extra: 'private' },
    { kind: 'advanced', ...revision, extra: 'private' }, { kind: 'unchanged', ...revision, extra: 'private' },
  ] as const) {
    f.writer.importPublisher.mockResolvedValueOnce(result);
    expect(await f.enabled.call('importPublisher', lifecycleCalls[1][1])).toEqual({ ok: true, value: result.kind === 'held'
      ? { kind: result.kind, reason: result.reason } : { kind: result.kind, ...revision } });
    expect(f.writer.importPublisher).toHaveBeenLastCalledWith('synthetic-publisher', f.record.recordRevision);
  }
  expect(f.writer.snapshot).not.toHaveBeenCalled(); expect(f.writer.serving).not.toHaveBeenCalled();
  expect(f.forbiddenStore.read).not.toHaveBeenCalled(); expect(f.forbiddenStore.write).not.toHaveBeenCalled();
  expect(f.fake.unexpected).not.toHaveBeenCalled(); expect(generationsImport).not.toHaveBeenCalled();
});

it('closes refresh projections over every status and nested identity, omitting health and extra private fields', async () => {
  const f = fakeWriterHost();
  const privateFields = { path: '/synthetic/private', hostId: 'private-host', origin: 'https://private.invalid', bytes: new Uint8Array([7]) };
  const exposed = { ...generation, ...privateFields };
  const previous = { ...exposed, sequence: '1' };
  const health = { ...privateFields } as unknown as import('./generations/index.js').PublisherHealth;
  const cases: [Awaited<ReturnType<Writer['refresh']>>, unknown][] = [
    [{ status: 'activated', generation: exposed, previous, health }, { status: 'activated', generation, previous: { ...generation, sequence: '1' } }],
    [{ status: 'activated', generation: exposed, previous: null, health }, { status: 'activated', generation, previous: null }],
    [{ status: 'current', generation: exposed, health }, { status: 'current', generation }],
    [{ status: 'held', reason: 'store_uncertain', lastGood: exposed }, { status: 'held', reason: 'store_uncertain', lastGood: generation }],
    [{ status: 'held', reason: 'transport_unavailable', lastGood: null }, { status: 'held', reason: 'transport_unavailable', lastGood: null }],
    ...(['source_unknown', 'source_removed', 'not_issued', 'binding_scope_changed', 'application_pending'] as const)
      .map(reason => [{ status: 'unavailable' as const, reason }, { status: 'unavailable', reason }] as [Awaited<ReturnType<Writer['refresh']>>, unknown]),
  ];
  for (const [result, value] of cases) {
    f.writer.refresh.mockResolvedValueOnce({ ...result, ...privateFields });
    expect(await f.enabled.call('refresh', { sourceId: 'synthetic-source' })).toEqual({ ok: true, value });
    expect(f.writer.refresh).toHaveBeenLastCalledWith('synthetic-source');
  }
  expect(f.fake.unexpected).not.toHaveBeenCalled(); expect(generationsImport).not.toHaveBeenCalled();
});

it('maps every GenerationSourceError reason and redacts unexpected exceptions on all lifecycle routes', async () => {
  const f = fakeWriterHost();
  const reasons = ['record_invalid', 'record_conflict', 'record_unavailable', 'record_uncertain', 'invalid_publisher', 'publisher_exists',
    'publisher_unregistered', 'source_unknown', 'source_id_collision', 'store_root_changed', 'store_root_collision', 'writer_exists', 'writer_closed'] as const;
  for (const [route, params] of lifecycleCalls) {
    for (const reason of reasons) {
      f.writer[route].mockRejectedValueOnce(new GenerationSourceError(reason));
      expect(await f.enabled.call(route, params)).toEqual({ ok: false, kind: 'unavailable', reason });
    }
    f.writer[route].mockRejectedValueOnce(Error('private path, host and exception details'));
    expect(await f.enabled.call(route, params)).toEqual({ ok: false, kind: 'unavailable', reason: 'record_unavailable' });
  }
  expect(createGenerationSources).toHaveBeenCalledTimes(1);
});

it('serializes lifecycle calls, drains admitted work before idempotent close, and rejects later calls', async () => {
  const f = fakeWriterHost(), events: string[] = [];
  let release!: () => void, entered!: () => void;
  const blocked = new Promise<void>(resolve => { release = resolve; });
  const started = new Promise<void>(resolve => { entered = resolve; });
  f.writer.registerPublisher.mockImplementationOnce(async () => {
    events.push('register:start'); entered(); await blocked; events.push('register:end'); return f.record;
  });
  f.writer.importPublisher.mockImplementationOnce(async () => { events.push('import'); return { kind: 'unchanged', recordRevision: f.record.recordRevision }; });
  f.writer.setOwnerState.mockImplementationOnce(async () => { events.push('owner'); return f.record; });
  f.writer.refresh.mockImplementationOnce(async () => { events.push('refresh'); return { status: 'unavailable', reason: 'source_removed' }; });
  f.writer.close.mockImplementationOnce(async () => { events.push('close'); });
  const pending = lifecycleCalls.map(([route, params]) => f.enabled.call(route, params));
  await started;
  const closing = f.enabled.close(); expect(f.enabled.close()).toBe(closing);
  try {
    expect(events).toEqual(['register:start']);
    for (const [route, params] of lifecycleCalls)
      expect(await f.enabled.call(route, params)).toEqual({ ok: false, kind: 'unavailable', reason: 'writer_closed' });
    expect(f.writer.close).not.toHaveBeenCalled();
  } finally { release(); await Promise.all(pending); await closing; }
  expect(events).toEqual(['register:start', 'register:end', 'import', 'owner', 'refresh', 'close']);
  expect(f.writer.close).toHaveBeenCalledTimes(1);
  expect(createGenerationSources).toHaveBeenCalledTimes(1);
});

it('maps failed lazy construction without retrying it or owning another writer', async () => {
  for (const error of [new GenerationSourceError('writer_exists'), Error('private construction details')]) {
    const f = fakeWriterHost(error);
    for (const [route, params] of lifecycleCalls)
      expect(await f.enabled.call(route, params)).toEqual({ ok: false, kind: 'unavailable',
        reason: error instanceof GenerationSourceError ? error.reason : 'record_unavailable' });
    await f.enabled.close();
    expect(createGenerationSources).toHaveBeenCalledTimes(1);
    expect(f.writer.close).not.toHaveBeenCalled();
    expect(f.forbiddenStore.read).not.toHaveBeenCalled(); expect(f.forbiddenStore.write).not.toHaveBeenCalled();
    vi.mocked(createGenerationSources).mockClear();
  }
});

it('keeps production construction default-disabled and the disabled return first in call', async () => {
  const root = fileURLToPath(new URL('../../../../', import.meta.url));
  const main = await readFile(join(root, 'apps/desktop/electron/main.ts'), 'utf8');
  const source = await readFile(join(root, 'apps/desktop/electron/sources/generation-host.ts'), 'utf8');
  const mainCalls = [...main.matchAll(/\bcreateGenerationSourcesHost\s*\(/g)];
  expect(mainCalls).toHaveLength(1);
  expect(main.slice(mainCalls[0]!.index)).toMatch(/^createGenerationSourcesHost\(\{ userData: app\.getPath\('userData'\) \}\)/);
  const syntax = ts.createSourceFile('generation-host.ts', source, ts.ScriptTarget.Latest, true);
  let firstStatement: string | undefined;
  function visit(node: ts.Node) {
    if (ts.isMethodDeclaration(node) && node.name.getText(syntax) === 'call') firstStatement = node.body?.statements[0]?.getText(syntax);
    ts.forEachChild(node, visit);
  }
  visit(syntax);
  expect(firstStatement).toBe("if (mode === 'disabled') return { ok: false, kind: 'unavailable', reason: 'disabled' };");
  expect(source).toContain("const mode = options.mode ?? 'disabled';");
  const callers: string[] = [];
  async function scan(directory: string): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (['node_modules', 'dist', 'dist-electron', '.t3'].includes(entry.name)) continue;
      const path = join(directory, entry.name);
      if (entry.isDirectory()) { await scan(path); continue; }
      if (!/\.(?:[cm]?ts|tsx|[cm]?js|jsx)$/.test(entry.name) || /\.(?:test|spec)\./.test(entry.name)) continue;
      const text = await readFile(path, 'utf8');
      if (!text.includes('generation-host') && !text.includes('createGenerationSourcesHost')) continue;
      const file = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true);
      const names = new Set(['createGenerationSourcesHost']);
      function inspect(node: ts.Node) {
        if (ts.isImportSpecifier(node) && (node.propertyName ?? node.name).text === 'createGenerationSourcesHost') names.add(node.name.text);
        if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && names.has(node.expression.text)) callers.push(path);
        ts.forEachChild(node, inspect);
      }
      inspect(file);
    }
  }
  await scan(join(root, 'apps'));
  expect(callers).toEqual([join(root, 'apps/desktop/electron/main.ts')]);
});
