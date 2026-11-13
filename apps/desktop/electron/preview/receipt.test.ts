import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Node } from '@oxc-project/types';
import { parseAst } from 'rolldown/parseAst';
import { expect, it } from 'vitest';
import type { CaptureRecord } from '@hq/contracts/preview';
import { decodeCaptureReceipt, staticCaptureEligible } from '../hq-records/capture-evidence';
import { buildCaptureReceipt, type CaptureReceiptFacts } from './receipt';

function facts(): CaptureReceiptFacts {
  return {
    record: {
      captureId: 'synthetic-ci-qualification-capture', sessionId: 'synthetic-session', versionId: 'synthetic-host-version', generation: 7,
      route: '/observed?tab=one', state: '#section', viewport: { w: 390, h: 844, dpr: 3 },
      scroll: { x: 10.25, y: 120.75 }, contentSize: { w: 1040.25, h: 2400.5 },
      captureDigest: `sha256:${'a'.repeat(64)}`, capturedAt: '2026-11-13T12:00:00.000Z',
    },
    observedUrl: 'https://example.com/observed?tab=one#section', qualificationEnabled: false,
    appVersion: '0.1.0-synthetic', packaged: true, byteLength: 1234, pixelWidth: 1170, pixelHeight: 2532,
    persistedAt: '2026-11-13T12:00:01.000Z',
  };
}

function decodedReceipt(input: CaptureReceiptFacts) {
  const produced = buildCaptureReceipt(input), decoded = decodeCaptureReceipt(produced);
  expect(decoded).toEqual(produced);
  expect(decoded.fixture).toEqual({ state: 'unknown', attestedBy: null });
  expect(staticCaptureEligible(decoded)).toEqual({ eligible: false, reason: input.qualificationEnabled ? 'not-production' : 'fixture-unknown' });
  // Qualification has an earlier refusal; even a production mode fact cannot supply fixture attestation.
  expect(staticCaptureEligible({ ...decoded, producer: { ...decoded.producer, mode: 'production' } }))
    .toEqual({ eligible: false, reason: 'fixture-unknown' });
  return decoded;
}

it('maps accepted viewport facts to the exact receipt schema without claiming the full page extent', () => {
  const input = facts(), before = structuredClone(input);
  expect(decodedReceipt(input)).toEqual({
    schema: 'hq.design.capture-evidence/v1', captureId: 'synthetic-ci-qualification-capture',
    producer: { id: 'hq.electron-preview', contract: 1, mode: 'production', appVersion: '0.1.0-synthetic', packaged: true },
    host: { sessionId: 'synthetic-session', hostVersionId: 'synthetic-host-version', generation: 7 },
    page: { origin: 'https://example.com', route: '/observed?tab=one', state: '#section' },
    viewport: { w: 390, h: 844, dpr: 3 }, scroll: { x: 10.25, y: 120.75 },
    pageExtentCss: { width: 1040.25, height: 2400.5 }, imageRectCss: { x: 10.25, y: 120.75, width: 390, height: 844 },
    image: { mediaType: 'image/png', digest: `sha256:${'a'.repeat(64)}`, byteLength: 1234, pixelWidth: 1170, pixelHeight: 2532 },
    time: { capturedAt: '2026-11-13T12:00:00.000Z', basis: 'host-clock-after-coherence-before-persist', acquisition: null },
    persistedAt: '2026-11-13T12:00:01.000Z', fixture: { state: 'unknown', attestedBy: null },
  });
  expect(input).toEqual(before);
});

it.each([1, 2, 3] as const)('preserves the accepted shot dimensions at DPR %s', dpr => {
  const input = facts();
  const viewport = { ...input.record.viewport, dpr };
  const receipt = decodedReceipt({ ...input, record: { ...input.record, viewport }, pixelWidth: viewport.w * dpr, pixelHeight: viewport.h * dpr });
  expect(receipt.viewport).toEqual(viewport);
  expect(receipt.imageRectCss).toEqual({ x: 10.25, y: 120.75, width: 390, height: 844 });
  expect(receipt.pageExtentCss).toEqual({ width: 1040.25, height: 2400.5 });
  expect(receipt.image).toMatchObject({ pixelWidth: viewport.w * dpr, pixelHeight: viewport.h * dpr });
});

it('preserves fractional viewport and scroll geometry without rounding the actual clip', () => {
  const input = facts();
  const viewport = { w: 390.5, h: 844.5, dpr: 2 } as const;
  const receipt = decodedReceipt({ ...input, record: { ...input.record, viewport }, pixelWidth: 781, pixelHeight: 1689 });
  expect(receipt.viewport).toEqual(viewport);
  expect(receipt.imageRectCss).toEqual({ x: 10.25, y: 120.75, width: 390.5, height: 844.5 });
  expect(receipt.image).toMatchObject({ pixelWidth: 781, pixelHeight: 1689 });
});

it.each([
  { qualificationEnabled: false, packaged: false, mode: 'production' },
  { qualificationEnabled: false, packaged: true, mode: 'production' },
  { qualificationEnabled: true, packaged: false, mode: 'qualification' },
  { qualificationEnabled: true, packaged: true, mode: 'qualification' },
] as const)('uses the qualification fact alone for mode: %j, with fixture always unknown', ({ mode, ...producerFacts }) => {
  const receipt = decodedReceipt({ ...facts(), ...producerFacts });
  expect(receipt.producer).toEqual({ id: 'hq.electron-preview', contract: 1, mode, appVersion: '0.1.0-synthetic', packaged: producerFacts.packaged });
  expect(receipt.fixture).toEqual({ state: 'unknown', attestedBy: null });
});

it.each([0, 1.5, 4, NaN, Infinity, '2', null])('refuses invalid DPR %s without coercion', dpr => {
  const input = facts();
  const record = { ...input.record, viewport: { ...input.record.viewport, dpr } } as unknown as CaptureRecord;
  expect(() => buildCaptureReceipt({ ...input, record })).toThrow('Invalid capture DPR');
});

const repo = fileURLToPath(new URL('../../../../', import.meta.url));
const generated = new Set(['node_modules', '.git', 'dist', 'dist-electron', 'dist-design-host', 'dist-wiki-host', 'coverage', '.cache']);
function productionSources(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    if (entry.isSymbolicLink() || generated.has(entry.name)) return [];
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return productionSources(path);
    return entry.isFile() && /\.[cm]?[jt]sx?$/u.test(entry.name) && !/\.(?:test|spec)\.[cm]?[jt]sx?$/u.test(entry.name) ? [path] : [];
  });
}
function isNode(value: unknown): value is Node {
  return value !== null && typeof value === 'object' && 'type' in value && typeof value.type === 'string';
}
function walk(node: Node, visit: (node: Node) => void) {
  visit(node);
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) { for (const child of value) if (isNode(child)) walk(child, visit); }
    else if (isNode(value)) walk(value, visit);
  }
}
function propertyName(node: Node): string | null {
  if (node.type === 'Identifier') return node.name;
  if (node.type === 'Literal' && typeof node.value === 'string') return node.value;
  return null;
}
function inspectWiring(source: string, path: string) {
  const lang = /\.d\.[cm]?ts$/u.test(path) ? 'dts' : /\.[cm]?tsx?$/u.test(path) ? (path.endsWith('x') ? 'tsx' : 'ts') : 'jsx';
  const ast = parseAst(source, { lang, sourceType: 'unambiguous' }, path);
  const factories = new Set(['createPreviewHost']), violations: string[] = [];
  let calls = 0;
  walk(ast, node => {
    if (node.type === 'ImportSpecifier' && propertyName(node.imported) === 'createPreviewHost') factories.add(node.local.name);
    if (node.type === 'VariableDeclarator' && node.id.type === 'Identifier' && node.init?.type === 'Identifier' && factories.has(node.init.name)) factories.add(node.id.name);
  });
  walk(ast, node => {
    if (node.type === 'ObjectExpression' && node.properties.some(property => property.type === 'Property' && propertyName(property.key) === 'persistReceipt')) {
      violations.push('runtime receipt option');
    }
    if (node.type !== 'CallExpression') return;
    const callee = node.callee;
    if (!(callee.type === 'Identifier' && factories.has(callee.name))
      && !(callee.type === 'MemberExpression' && propertyName(callee.property) === 'createPreviewHost')) return;
    calls++;
    const options = node.arguments[0];
    if (node.arguments.length !== 1 || options?.type !== 'ObjectExpression'
      || options.properties.some(property => property.type !== 'Property' || !['window', 'putBlob'].includes(propertyName(property.key) ?? ''))) {
      violations.push('preview host options are not the inert literal composition');
    }
  });
  return { calls, violations };
}

it('distinguishes receipt wiring from the legal host type, implementation and ordinary text', () => {
  expect(inspectWiring(`
    function createPreviewHost(options: { persistReceipt?: (receipt: unknown) => Promise<boolean> }) { return options.persistReceipt; }
    const documentation = 'persistReceipt'; // createPreviewHost({ persistReceipt });
  `, 'fixture.ts')).toEqual({ calls: 0, violations: [] });
  for (const source of [
    'createPreviewHost({ window, putBlob, persistReceipt });',
    'createPreviewHost({ window, putBlob, ["persistReceipt"]: save });',
    'createPreviewHost({ ...options });',
    'createPreviewHost(options);',
    'import { createPreviewHost as make } from "./host"; make({ window, putBlob, persistReceipt });',
  ]) expect(inspectWiring(source, 'fixture.ts').violations.length).toBeGreaterThan(0);
});

it('keeps main and every non-test source caller free of receipt persistence composition', () => {
  const main = join(repo, 'apps/desktop/electron/main.ts');
  expect(inspectWiring(readFileSync(main, 'utf8'), main)).toEqual({ calls: 1, violations: [] });
  const violations: string[] = [];
  for (const path of ['apps', 'modules', 'packages'].flatMap(root => productionSources(join(repo, root)))) {
    const source = readFileSync(path, 'utf8');
    if (!source.includes('createPreviewHost') && !source.includes('persistReceipt')) continue;
    for (const violation of inspectWiring(source, path).violations) violations.push(`${relative(repo, path)}: ${violation}`);
  }
  expect(violations).toEqual([]);
});
