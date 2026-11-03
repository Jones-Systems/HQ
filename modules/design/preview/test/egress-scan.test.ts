/**
 * Static egress scan of the preview's source import graph, starting at main.tsx
 * and following every relative static, side-effect and dynamic import plus
 * import.meta.glob patterns. The shared @hq/contracts and @hq/ui sources are scanned too.
 * It shows which modules the preview can load and that none of them names a
 * network, bridge or Node capability. React packages are listed, not scanned.
 * This is a source scan, not a network-isolation proof.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const previewRoot = fileURLToPath(new URL('../', import.meta.url));
const designRoot = resolve(previewRoot, '..');
const contractsEntry = fileURLToPath(new URL('../../../../packages/contracts/src/index.ts', import.meta.url));
const uiEntry = fileURLToPath(new URL('../../../../packages/hq-ui/src/index.ts', import.meta.url));
const workspace: Readonly<Record<string, string>> = { '@hq/contracts': contractsEntry, '@hq/ui': uiEntry };
const SPECIFIER = /(?:(?:^|[}\s])from\s+|\bimport\s*\(\s*|^\s*import\s+)['"]([^'"\n]+)['"]/gmu;
const GLOB = /import\.meta\.glob\(\s*['"]([^'"]+)['"]/gu;

/** Expand a Vite glob with one `*` segment, e.g. ./sections/*\/design-module.ts. */
function expandGlob(from: string, pattern: string): string[] {
  const [head, tail] = pattern.split('*/');
  assert.ok(head !== undefined && tail !== undefined && !tail.includes('*'), `unsupported glob ${pattern}`);
  const base = resolve(dirname(from), head);
  return readdirSync(base).map((name) => resolve(base, name, tail)).filter((path) => existsSync(path));
}

interface Graph {
  readonly files: readonly string[];
  readonly bare: ReadonlySet<string>;
}

function importGraph(entry: string): Graph {
  const seen = new Set<string>();
  const bare = new Set<string>();
  const queue = [entry];
  while (queue.length > 0) {
    const file = queue.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    if (file.endsWith('.css')) continue;
    const source = readFileSync(file, 'utf8');
    for (const match of source.matchAll(GLOB)) queue.push(...expandGlob(file, match[1]!));
    for (const match of source.matchAll(SPECIFIER)) {
      const specifier = match[1]!;
      if (Object.hasOwn(workspace, specifier)) { bare.add(specifier); queue.push(workspace[specifier]!); continue; }
      if (!specifier.startsWith('.')) { bare.add(specifier); continue; }
      const base = resolve(dirname(file), specifier);
      const target = [base, `${base}.ts`, `${base}.tsx`, join(base, 'index.ts')].find((path) => existsSync(path) && statSync(path).isFile());
      assert.ok(target, `${relative(designRoot, file)} imports missing ${specifier}`);
      queue.push(target);
    }
  }
  return { files: [...seen].sort(), bare };
}

/** Comments may describe what code does not do; scan code only. */
function code(file: string): string {
  return readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//gu, '').replace(/(^|[^:'"])\/\/.*$/gmu, '$1');
}

const FORBIDDEN: readonly (readonly [string, RegExp])[] = [
  ['fetch', /\bfetch\s*\(/u], ['XMLHttpRequest', /\bXMLHttpRequest\b/u], ['WebSocket', /\bWebSocket\b/u],
  ['EventSource', /\bEventSource\b/u], ['sendBeacon', /\bsendBeacon\b/u], ['window.open', /\bwindow\.open\s*\(/u],
  ['Worker', /\bnew\s+(?:Shared)?Worker\s*\(/u], ['importScripts', /\bimportScripts\b/u],
  ['WebRTC', /\bRTCPeerConnection\b/u], ['clipboard', /\bnavigator\.clipboard\b/u],
  ['preload bridge', /\bhqDesktop\b/u], ['IPC', /\bipcRenderer\b/u],
  ['electron', /['"]electron['"]/u], ['node builtin', /['"]node:[a-z_/]+['"]/u],
];

/** Remote URL literals allowed in the graph, each as inert data. */
const URL_ALLOWLIST: readonly (readonly [RegExp, string])[] = [
  [/^https:\/\/example\.com\//u, 'synthetic fixture data (reference source, flow exit hotspot); never requested'],
  [/^http:\/\/www\.w3\.org\/2000\/svg$/u, 'SVG XML namespace in synthetic captures; not a request'],
];

const graph = importGraph(resolve(previewRoot, 'main.tsx'));
const scanned = graph.files.filter((file) => /\.tsx?$/u.test(file));

test('preview graph reaches every section cone through its real entry modules', () => {
  const cones = new Set(scanned.map((file) => relative(designRoot, file).split('/')[0]));
  for (const cone of ['ui', 'preview', 'projects', 'discovery', 'references', 'components', 'flows', 'canvas', 'compare',
    'annotations', 'taste', 'requests', 'imports', 'connector']) assert.ok(cones.has(cone), `graph includes ${cone}`);
  assert.ok(scanned.length > 100, `graph has ${scanned.length} source files`);
});

test('bare imports are React plus the shared contracts and UI kit, both scanned', () => {
  assert.deepEqual([...graph.bare].sort(), ['@hq/contracts', '@hq/ui', 'react', 'react-dom/client']);
  assert.ok(scanned.includes(contractsEntry));
  assert.ok(scanned.includes(uiEntry));
  assert.ok(scanned.includes(resolve(dirname(uiEntry), 'components/Button.tsx')));
});

test('no module in the graph names a network, bridge or Node capability', () => {
  const hits: string[] = [];
  for (const file of scanned) {
    const text = code(file);
    for (const [name, pattern] of FORBIDDEN) if (pattern.test(text)) hits.push(`${relative(designRoot, file)}: ${name}`);
  }
  assert.deepEqual(hits, []);
});

test('isolation probe, Node adapters, producer, preview agent, app entry and the store stay out of the graph', () => {
  const paths = scanned.map((file) => relative(designRoot, file));
  for (const excluded of ['components/src/review/isolation-probe.ts', 'taste/src/node-file-system.ts', 'taste/src/main.ts']) {
    assert.ok(!paths.includes(excluded), `${excluded} is not loaded`);
  }
  assert.ok(!paths.some((path) => path.startsWith('annotations/src/preview-agent/')), 'preview agent is not loaded');
  assert.ok(!paths.some((path) => path.startsWith('references/producer/')), 'Node-only reference producer is not loaded');
  assert.ok(!paths.some((path) => path.startsWith('app/')), 'production entry and its storage seam are not loaded');
  const outside = paths.filter((path) => path.startsWith('../'));
  assert.ok(outside.includes('../../packages/contracts/src/index.ts'));
  assert.ok(outside.includes('../../packages/hq-ui/src/index.ts'));
  assert.deepEqual(outside.filter((path) => !['index.ts', 'catalog.ts', 'jones-code.ts', 'preview.ts'].some(name => path === `../../packages/contracts/src/${name}`) && !path.startsWith('../../packages/hq-ui/src/')), [],
    'only shared contracts and scanned UI kit source load outside modules/design; the Node store does not');
});

test('remote URL literals in the graph are allowlisted inert data', () => {
  const unexpected: string[] = [];
  for (const file of scanned) {
    for (const match of code(file).matchAll(/\bhttps?:\/\/[^\s'"`)]+/gu)) {
      if (!URL_ALLOWLIST.some(([pattern]) => pattern.test(match[0]))) unexpected.push(`${relative(designRoot, file)}: ${match[0]}`);
    }
  }
  assert.deepEqual(unexpected, []);
});

test('no transport or source adapter is registered by the preview wiring', () => {
  const connector = code(resolve(previewRoot, 'sections/connector/View.tsx'));
  assert.match(connector, /const transports = \{\};/u);
  assert.doesNotMatch(connector, /createFakeReceiver/u);
  const discovery = code(resolve(previewRoot, 'sections/discovery/View.tsx'));
  assert.match(discovery, /adapters: \{\}/u);
  assert.match(discovery, /refreshOnOpen: false/u);
  assert.doesNotMatch(code(resolve(previewRoot, 'sections/requests/View.tsx')), /DispatchSpyFake/u);
  assert.match(code(resolve(previewRoot, 'sections/requests/View.tsx')), /dispatch=\{null\}/u);
});
