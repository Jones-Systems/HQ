import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { it } from 'node:test';
import type { Node } from '@oxc-project/types';
import { parseAst } from 'rolldown/parseAst';
import type { DesignServiceTransport } from '@hq/contracts/services';
import { LOCAL_HOST_ID } from '../../../discovery/src/adapters/local-directory.ts';
import { CATALOG_CACHE_KEY, serializeCatalogCache } from '../../../discovery/src/cache.ts';
import { EMPTY_CATALOG } from '../../../discovery/src/catalog.ts';
import { hostId, isoFromMs, type HostId, type SourceAdapter } from '../../../discovery/src/contract.ts';
import { FakeSourceAdapter, fixtureSnapshot } from '../../../discovery/src/fakes.ts';
import { TEXT_FORMAT } from '../../storage/index.ts';
import { createBridgeWorkspaceDocuments } from '../bridge-documents.ts';
import { createBridgedDiscovery, type InjectedDiscoverySource } from '../bridged-discovery.ts';
import { createBridgedWorkspace } from '../bridged-workspace.ts';
import { CACHED_TAG, SYNTHETIC_TAG } from '../labels.ts';
import { createTransportDouble } from './bridge-double.ts';

const NOW = Date.UTC(2026, 10, 1, 12);
const localRoots = [{ rootId: 'synthetic-local-root', label: 'Synthetic local folder' }];

function fakeTransport(selected = false) {
  const calls: { route: string; params: unknown }[] = [];
  let cached: unknown = null;
  let generation = 0;
  const transport = { async call(route: string, params: { value?: unknown }) {
    calls.push({ route, params: structuredClone(params) });
    if (route === 'catalog.chooseRoot') selected = true;
    if (route === 'catalog.forget') selected = false;
    if (['catalog.roots', 'catalog.chooseRoot', 'catalog.forget'].includes(route)) return { ok: true, value: selected ? localRoots : [] };
    if (route === 'cache.put') { cached = structuredClone(params.value); return { ok: true, value: {} }; }
    if (route === 'cache.get') return { ok: true, value: cached === null ? null : { value: cached } };
    if (route === 'catalog.snapshot') return { ok: true, value: await fixtureSnapshot(LOCAL_HOST_ID, ++generation,
      [{ path: 'local', name: 'Synthetic local project', previews: [] }]) };
    throw new Error(`Unexpected fake transport route: ${route}`);
  } } as unknown as DesignServiceTransport;
  return { transport, calls };
}

function source(index = 0): InjectedDiscoverySource {
  return { adapterKey: `fake-${index}`, hostId: hostId(`synthetic-host-${index}`), label: `Synthetic fake ${index}`, adapter: new FakeSourceAdapter() };
}

it('preserves exact default calls, state and labels with absent or empty source options', async (t) => {
  t.mock.method(Date, 'now', () => NOW);
  const cacheValue = { format: TEXT_FORMAT, text: serializeCatalogCache(EMPTY_CATALOG, isoFromMs(NOW)) };
  const expectedCalls = [
    { route: 'catalog.roots', params: {} },
    { route: 'cache.put', params: { key: CATALOG_CACHE_KEY, value: cacheValue } },
    { route: 'cache.get', params: { key: CATALOG_CACHE_KEY } },
    { route: 'cache.get', params: { key: CATALOG_CACHE_KEY } },
  ];
  const expectedState = { opened: true, cacheStatus: 'warm', cacheWritable: true, cacheWriteFailed: false,
    context: { id: 'all', hostIds: [LOCAL_HOST_ID] }, catalog: EMPTY_CATALOG,
    enrollments: [{ hostId: LOCAL_HOST_ID, label: 'This device', adapterKey: 'local', enrolledAt: isoFromMs(NOW) }], refreshing: [] };
  for (const options of [undefined, {}, { sources: undefined }, { sources: [] }]) {
    const fake = fakeTransport();
    const env = options === undefined ? await createBridgedDiscovery(fake.transport) : await createBridgedDiscovery(fake.transport, options);
    t.after(() => env.service.dispose());
    assert.deepEqual(fake.calls, expectedCalls);
    assert.deepEqual(env.service.getState(), expectedState);
    assert.deepEqual(env.adapterLabels, { local: { label: 'Local directory', fake: false } });
    assert.deepEqual(env.readPort.status(), { cache: 'warm', entries: 0, hosts: 0, tag: CACHED_TAG, provenance: 'Selected local projects folder' });
    assert.equal(env.tag, CACHED_TAG);
    assert.equal(env.readPort.tag, CACHED_TAG);
    await env.refresh();
    assert.deepEqual(fake.calls, expectedCalls, 'no selected local root still gates refresh');
  }
});

it('refuses every invalid source before any transport or adapter call', async () => {
  const first = source();
  const fakeAdapter = first.adapter as FakeSourceAdapter;
  const qualified: SourceAdapter = { label: 'Unaccepted qualified source', qualification: 'qualified', qualificationRef: 'synthetic-ref',
    listSnapshot: fakeAdapter.listSnapshot.bind(fakeAdapter), readPreview: fakeAdapter.readPreview.bind(fakeAdapter) };
  const cases: { sources: InjectedDiscoverySource[]; error: RegExp }[] = [
    { sources: Array.from({ length: 9 }, (_, index) => source(index)), error: /at most eight/i },
    { sources: [{ ...first, adapter: qualified }], error: /fake adapters/ },
    { sources: [first, { ...source(1), adapter: qualified }], error: /fake adapters/ },
    { sources: [{ ...first, adapterKey: 'local' }], error: /adapter keys/ },
    { sources: [first, { ...source(1), adapterKey: first.adapterKey }], error: /adapter keys/ },
    { sources: [{ ...first, hostId: LOCAL_HOST_ID }], error: /host IDs/ },
    { sources: [first, { ...source(1), hostId: first.hostId }], error: /host IDs/ },
    ...[null, 42, '', ' padded', 'padded ', 'x\n', 'x\u007f', 'x'.repeat(161)].map((invalid) => (
      { sources: [{ ...first, hostId: invalid as HostId }], error: /Invalid HostId/ })),
  ];
  for (const invalid of cases) {
    const fake = fakeTransport();
    await assert.rejects(createBridgedDiscovery(fake.transport, { sources: invalid.sources }), invalid.error);
    assert.deepEqual(fake.calls, []);
  }
  assert.deepEqual(fakeAdapter.listCalls, []);
});

it('accepts eight fake sources and the existing opaque host grammar without adding a new grammar', async (t) => {
  const sources = Array.from({ length: 8 }, (_, index) => source(index));
  sources[0] = { ...sources[0]!, hostId: hostId('Opaque host: synthetic / fixture') };
  const env = await createBridgedDiscovery(fakeTransport().transport, { sources });
  t.after(() => env.service.dispose());
  assert.deepEqual(env.service.getState().enrollments.slice(1).map((entry) => entry.hostId), sources.map((item) => item.hostId));
  assert.equal(env.readPort.tag, SYNTHETIC_TAG);
});

it('refreshes fake entries into the synthetic read port and retains folder lifecycle and gating', async (t) => {
  t.mock.method(Date, 'now', () => NOW);
  const injected = source();
  const adapter = injected.adapter as FakeSourceAdapter;
  adapter.on(injected.hostId,
    { kind: 'snapshot', snapshot: await fixtureSnapshot(injected.hostId, 1, [{ path: 'fake', name: 'Injected fixture', previews: [] }]) },
    { kind: 'snapshot', snapshot: await fixtureSnapshot(injected.hostId, 2, [{ path: 'fake', name: 'Injected fixture', previews: [] }]) });
  const fake = fakeTransport();
  const env = await createBridgedDiscovery(fake.transport, { sources: [injected] });
  t.after(() => env.service.dispose());
  const enrollment = { hostId: injected.hostId, label: injected.label, adapterKey: injected.adapterKey, enrolledAt: isoFromMs(NOW) };
  assert.deepEqual(env.service.getState().enrollments[1], enrollment);
  assert.deepEqual(env.adapterLabels[injected.adapterKey], { label: injected.label, fake: true });
  assert.equal(env.tag, SYNTHETIC_TAG);
  assert.equal(env.readPort.tag, SYNTHETIC_TAG);
  assert.match(env.readPort.status().provenance, /Synthetic injected sources: Synthetic fake 0; selected local projects folder/);
  assert.deepEqual(adapter.listCalls, [], 'opening does not refresh');
  await env.refresh();
  assert.deepEqual(adapter.listCalls, [], 'local roots still gate injected refresh');
  const oldService = env.service;
  await env.chooseRoot();
  assert.notEqual(env.service, oldService);
  assert.deepEqual(env.roots(), localRoots);
  assert.deepEqual(adapter.listCalls, [injected.hostId]);
  assert.deepEqual(env.readPort.current().map((entry) => [entry.displayName, entry.hostLabel]),
    [['Injected fixture', injected.label], ['Synthetic local project', 'This device']]);
  const entry = env.readPort.current()[0]!;
  assert.equal(entry.hostId, injected.hostId);
  assert.equal(entry.sourceProjectId, env.service.getState().catalog.records[entry.sourceProjectId]!.entry.sourceProjectId);
  assert.equal(env.readPort.status().tag, SYNTHETIC_TAG, 'mixed data retains synthetic provenance');
  const callsBeforeNoop = fake.calls.length;
  await env.chooseRoot();
  assert.deepEqual(fake.calls.slice(callsBeforeNoop), [{ route: 'catalog.chooseRoot', params: {} }]);
  await env.refresh();
  assert.equal(adapter.listCalls.length, 2);
  await env.forget();
  assert.deepEqual(env.roots(), []);
  assert.deepEqual(env.readPort.current(), []);
  assert.deepEqual(env.service.getState().enrollments[1], enrollment);
  assert.equal(env.readPort.tag, SYNTHETIC_TAG);
  const callsAfterForget = fake.calls.length;
  await env.refresh();
  assert.equal(fake.calls.length, callsAfterForget);
  assert.equal(adapter.listCalls.length, 2);
  assert.equal(fake.calls.some(({ route }) => route.startsWith('doc.') || route === 'catalog.preview'), false);
});

it('forwards optional workspace sources lazily through the default transport', async (t) => {
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  t.after(() => {
    if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow);
    else Reflect.deleteProperty(globalThis, 'window');
  });
  const fake = fakeTransport();
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { hqServices: { design: fake.transport } } });
  const double = createTransportDouble();
  const documents = createBridgeWorkspaceDocuments(double.transport);
  const injected = source();
  for (const options of [undefined, { discoverySources: [] }, { discoverySources: [injected] }]) {
    const before = fake.calls.length;
    const workspace = createBridgedWorkspace(documents, options);
    assert.equal(fake.calls.length, before);
    const first = workspace.discoveryEnv();
    assert.equal(workspace.discoveryEnv(), first);
    const env = await first;
    t.after(() => env.service.dispose());
    assert.equal(env.service.getState().enrollments.length, options?.discoverySources?.length ? 2 : 1);
    assert.equal(env.readPort.tag, options?.discoverySources?.length ? SYNTHETIC_TAG : CACHED_TAG);
    if (options?.discoverySources?.length) assert.deepEqual(env.adapterLabels[injected.adapterKey], { label: injected.label, fake: true });
  }
  const beforeInvalid = fake.calls.length;
  const invalid = createBridgedWorkspace(documents, { discoverySources: [{ ...injected, adapterKey: 'local' }] });
  await assert.rejects(invalid.discoveryEnv(), /adapter keys/);
  assert.equal(fake.calls.length, beforeInvalid);
  assert.deepEqual(double.calls, [], 'workspace source propagation never accesses workspace documents');
});

const repo = fileURLToPath(new URL('../../../../../', import.meta.url));
const workspacePath = 'modules/design/app/compose/bridged-workspace.ts';
const generated = new Set(['node_modules', '.git', 'dist', 'dist-electron', 'dist-design-host', 'dist-wiki-host', 'coverage', '.cache']);
const sourceExtension = /\.(?:[cm]?[jt]sx?|html|vue|svelte)$/u;
const testExtension = /\.(?:test|spec)\.[cm]?[jt]sx?$/u;

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (entry.isSymbolicLink() || generated.has(entry.name)) return [];
    const path = join(directory, entry.name);
    return entry.isDirectory() ? sourceFiles(path) : entry.isFile() && sourceExtension.test(path) && !testExtension.test(path) ? [path] : [];
  });
}

function isNode(value: unknown): value is Node {
  return value !== null && typeof value === 'object' && 'type' in value && typeof value.type === 'string';
}

function walk(node: Node, visit: (node: Node, ancestors: readonly Node[]) => void, ancestors: readonly Node[] = []) {
  visit(node, ancestors);
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) { for (const child of value) if (isNode(child)) walk(child, visit, [...ancestors, node]); }
    else if (isNode(value)) walk(value, visit, [...ancestors, node]);
  }
}

function identifier(node: Node | null | undefined, name: string): boolean { return node?.type === 'Identifier' && node.name === name; }
function sourceRead(node: Node): boolean {
  return node.type === 'MemberExpression' && !node.computed && !node.optional
    && identifier(node.object, 'options') && identifier(node.property, 'discoverySources');
}

function staticText(node: Node): string | null {
  if (node.type === 'Literal' && typeof node.value === 'string') return node.value;
  if (node.type === 'TemplateLiteral' && node.expressions.length === 0) return node.quasis[0].value.cooked;
  if (node.type === 'ParenthesizedExpression') return staticText(node.expression);
  if (node.type === 'BinaryExpression' && node.operator === '+') {
    const left = staticText(node.left), right = staticText(node.right);
    return left !== null && right !== null ? left + right : null;
  }
  return null;
}

function exactForwarding(node: Node): Node[] | null {
  if (node.type !== 'ConditionalExpression' || node.test.type !== 'BinaryExpression' || node.test.operator !== '==='
    || !sourceRead(node.test.left) || !identifier(node.test.right, 'undefined')) return null;
  const { consequent, alternate } = node;
  if (consequent.type !== 'CallExpression' || consequent.optional || !identifier(consequent.callee, 'createBridgedDiscovery') || consequent.arguments.length !== 0
    || alternate.type !== 'CallExpression' || alternate.optional || !identifier(alternate.callee, 'createBridgedDiscovery')
    || alternate.arguments.length !== 2 || !identifier(alternate.arguments[0], 'undefined')) return null;
  const options = alternate.arguments[1];
  if (options.type !== 'ObjectExpression' || options.properties.length !== 1) return null;
  const property = options.properties[0];
  if (property.type !== 'Property' || property.computed || property.method || property.shorthand || property.kind !== 'init'
    || !identifier(property.key, 'sources') || !sourceRead(property.value)) return null;
  if (node.test.left.type !== 'MemberExpression' || property.value.type !== 'MemberExpression') return null;
  return [alternate, node.test.left.property, property.value.property];
}

function inspectProduction(path: string, source: string) {
  const violations: string[] = [];
  let forwardings = 0, declarations = 0, reads = 0;
  const imports: string[] = [];
  if (/\.(?:html|vue|svelte)$/u.test(path)) {
    for (const script of source.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/giu)) {
      const src = /\bsrc\s*=\s*["']([^"']+)["']/iu.exec(script[1]);
      if (src) imports.push(src[1]);
      const nested = inspectProduction(`${path}.ts`, script[2]);
      violations.push(...nested.violations); imports.push(...nested.imports);
      forwardings += nested.forwardings; declarations += nested.declarations; reads += nested.reads;
    }
  } else {
    // The locked TS7 root export has no compiler API; use the same locked parser as the records guard.
    const lang = /\.d\.[cm]?ts$/u.test(path) ? 'dts' : /\.[cm]?tsx?$/u.test(path) ? (path.endsWith('x') ? 'tsx' : 'ts') : 'jsx';
    const ast = parseAst(source, { lang, sourceType: 'unambiguous' }, path);
    const allowed = new Set<Node>();
    const discoveryNames = new Set(['createBridgedDiscovery']);
    walk(ast, (node, ancestors) => {
      if (node.type === 'ImportSpecifier' && identifier(node.imported, 'createBridgedDiscovery')) discoveryNames.add(node.local.name);
      if (path !== workspacePath) return;
      const parent = ancestors.at(-1);
      if (node.type === 'TSPropertySignature' && identifier(node.key, 'discoverySources') && node.optional && node.readonly
        && parent?.type === 'TSInterfaceBody'
        && ancestors.at(-2)?.type === 'TSInterfaceDeclaration'
        && ancestors.some((ancestor) => ancestor.type === 'TSInterfaceDeclaration' && identifier(ancestor.id, 'BridgedWorkspaceOptions'))) {
        allowed.add(node.key); declarations += 1;
      }
      const forwarding = exactForwarding(node);
      if (forwarding && parent?.type === 'VariableDeclarator' && parent.init === node && identifier(parent.id, 'attempt')
        && ancestors.some((ancestor) => ancestor.type === 'VariableDeclarator' && identifier(ancestor.id, 'discoveryEnv'))
        && ancestors.some((ancestor) => ancestor.type === 'FunctionDeclaration' && identifier(ancestor.id, 'createBridgedWorkspace'))) {
        forwarding.forEach((entry) => allowed.add(entry)); forwardings += 1; reads += 2;
      }
    });
    const addImport = (node: Node | null | undefined) => { if (node) { const text = staticText(node); if (text !== null) imports.push(text); } };
    walk(ast, (node, ancestors) => {
      if (node.type === 'Identifier' && node.name === 'discoverySources' && !allowed.has(node)) violations.push('discoverySources outside the exact workspace option/forwarding');
      const parent = ancestors.at(-1);
      if (node.type === 'Literal' && node.value === 'discoverySources'
        && ((parent?.type === 'Property' && parent.key === node) || (parent?.type === 'MemberExpression' && parent.property === node)
          || (parent?.type === 'TSPropertySignature' && parent.key === node))) violations.push('constructed discoverySources key');
      if (node.type === 'CallExpression') {
        const callee = node.callee;
        const discoveryCall = (callee.type === 'Identifier' && discoveryNames.has(callee.name))
          || (callee.type === 'MemberExpression' && (identifier(callee.property, 'createBridgedDiscovery') || staticText(callee.property) === 'createBridgedDiscovery'));
        if (discoveryCall && node.arguments.length >= 2 && !allowed.has(node)) violations.push('unaccepted second discovery argument');
        if ((callee.type === 'Identifier' && callee.name === 'require')
          || (callee.type === 'MemberExpression' && !callee.computed && callee.property.type === 'Identifier'
            && (callee.property.name === 'require' || (identifier(callee.object, 'require') && callee.property.name === 'resolve')))) addImport(node.arguments[0]);
      }
      if (node.type === 'ImportDeclaration' || node.type === 'ExportNamedDeclaration' || node.type === 'ExportAllDeclaration'
        || node.type === 'ImportExpression' || node.type === 'TSImportType') addImport(node.source);
      if (node.type === 'TSExternalModuleReference') addImport(node.expression);
    });
  }
  if (path.startsWith('modules/design/')) for (const specifier of imports) {
    const target = specifier.startsWith('.') ? relative(repo, resolve(dirname(join(repo, path)), specifier)) : specifier;
    if (/(?:^|[/\\])apps[/\\]desktop[/\\]electron(?:[/\\]|$)|(?:^|[/\\])generations(?:[/\\]|$)/u.test(target)) {
      violations.push(`Design imports a protected host/generation module: ${specifier}`);
    }
  }
  return { violations, forwardings, declarations, reads, imports };
}

const forwardingFixture = `export interface BridgedWorkspaceOptions { readonly discoverySources?: readonly InjectedDiscoverySource[] }
export function createBridgedWorkspace(documents, options: BridgedWorkspaceOptions = {}) {
  const discoveryEnv = () => { if (discovery === undefined) {
    const attempt = options.discoverySources === undefined ? createBridgedDiscovery() : createBridgedDiscovery(undefined, { sources: options.discoverySources });
  } };
}`;

it('admits only the exact AST forwarding exception, with meaningful negative controls', () => {
  const valid = inspectProduction(workspacePath, forwardingFixture);
  assert.deepEqual(valid.violations, []);
  assert.deepEqual([valid.forwardings, valid.declarations, valid.reads], [1, 1, 2]);
  const negative = [
    forwardingFixture.replace('options.discoverySources === undefined', 'options.discoverySources == undefined'),
    forwardingFixture.replace('createBridgedDiscovery()', 'createBridgedDiscovery?.()'),
    forwardingFixture.replace('createBridgedDiscovery(undefined,', 'createBridgedDiscovery(transport,'),
    forwardingFixture.replace('{ sources: options.discoverySources }', '{ sources: options.discoverySources, extra: true }'),
    forwardingFixture.replace('{ sources: options.discoverySources }', '{ ...options }'),
    forwardingFixture.replace('const discoveryEnv', 'const unrelated'),
    `${forwardingFixture}\ncreateBridgedDiscovery(undefined, {});`,
    `${forwardingFixture}\ncreateBridgedWorkspace(documents, { discoverySources: [] });`,
    `${forwardingFixture}\nconst other = options.discoverySources;`,
    `${forwardingFixture}\nconst other = { ['discoverySources']: [] };`,
    `${forwardingFixture}\nimport { createBridgedDiscovery as build } from './bridged-discovery.ts'; build(undefined, {});`,
  ];
  for (const fixture of negative) assert.ok(inspectProduction(workspacePath, fixture).violations.length > 0, fixture);
  assert.ok(inspectProduction('apps/fixture.ts', forwardingFixture).violations.length > 0, 'the same shape elsewhere is refused');
  assert.deepEqual(inspectProduction('apps/fixture.ts', '// createBridgedDiscovery(undefined, {})\nconst text = "discoverySources";').violations, []);
});

it('detects static, dynamic, CommonJS, re-export and type imports across the Design host boundary', () => {
  const path = 'modules/design/fixture.ts';
  for (const statement of [
    "import x from '../../apps/desktop/electron/main.ts';",
    "export * from '../../apps/desktop/electron/main.ts';",
    "import('../../apps/desktop/electron/main.ts');",
    "require('../../apps/desktop/' + 'electron/main.ts');",
    "module.require('../../apps/desktop/electron/main.ts');",
    "require.resolve('../../apps/desktop/electron/main.ts');",
    "type T = import('../../apps/desktop/electron/main.ts').T;",
    "import x = require('../../apps/desktop/electron/main.ts');",
    'import(`./generations/consumer.ts`);',
  ]) assert.equal(inspectProduction(path, statement).violations.length, 1, statement);
  assert.ok(inspectProduction('modules/design/fixture.html', '<script src="../../apps/desktop/electron/main.ts"></script>').violations.length > 0);
  assert.deepEqual(inspectProduction(path, 'const text = "apps/desktop/electron/main.ts"; // import("./generations/x.ts")').violations, []);
  assert.deepEqual(inspectProduction(path, "import type { HostId } from './discovery/src/contract.ts';").violations, []);
});

it('keeps all non-test production sources behind the single workspace forwarding and Design import boundaries', () => {
  const files = ['apps', 'modules', 'packages'].flatMap((root) => sourceFiles(join(repo, root)));
  assert.ok(files.length > 0);
  const violations: string[] = [];
  let forwardings = 0, declarations = 0, reads = 0;
  for (const file of files) {
    const path = relative(repo, file);
    const result = inspectProduction(path, readFileSync(file, 'utf8'));
    violations.push(...result.violations.map((violation) => `${path}: ${violation}`));
    forwardings += result.forwardings; declarations += result.declarations; reads += result.reads;
  }
  assert.deepEqual(violations, []);
  assert.deepEqual([forwardings, declarations, reads], [1, 1, 2]);
});
