import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { buildSampleProduct } from '../samples/sample-product.ts';
import { resolveRenderInput } from '../src/model/props.ts';
import { buildSandboxDocument } from '../src/review/sandbox-document.ts';
import {
  PRODUCT_RULES, importSpecifiers, scanImportGraph, scanProductOutput,
} from '../src/tooling/removability.ts';
import { seededWorkspace } from './helpers.ts';

const REPO = fileURLToPath(new URL('../../../../', import.meta.url));
const readRepo = (path: string): string | null => {
  try {
    return readFileSync(`${REPO}${path}`, 'utf8');
  } catch {
    return null;
  }
};
const SAMPLE_RULES = { ...PRODUCT_RULES, allowedPrefixes: [...PRODUCT_RULES.allowedPrefixes, 'modules/design/components/samples/'] };

test('the sample product import graph reaches no review, annotation, UI or other-section code', () => {
  const result = scanImportGraph('modules/design/components/samples/sample-product.ts', readRepo, SAMPLE_RULES);
  assert.deepEqual(result.violations, []);
  assert.ok(result.reachable.includes('modules/design/components/src/product/product-document.ts'));
  assert.ok(result.reachable.length >= 8, `walked ${result.reachable.length} modules`);
  for (const file of result.reachable) {
    assert.doesNotMatch(file, /\/(review|ui|tooling|workspace|annotations|requests|canvas)\//u, file);
  }
});

test('the product entry itself is review-free', () => {
  assert.deepEqual(scanImportGraph('modules/design/components/src/product/index.ts', readRepo).violations, []);
});

test('the built sample product contains no review markers, while a review sandbox does', async () => {
  const product = await buildSampleProduct();
  assert.deepEqual(scanProductOutput(product), []);
  assert.match(product, /\$120/u);
  assert.match(product, /\/year/u);
  const { button } = await seededWorkspace();
  const review = buildSandboxDocument(button, resolveRenderInput(button, null, null, {}, {}), { nonce: 'review-nonce-01' });
  assert.ok(scanProductOutput(review).length >= 3, 'the scan detects review code when present');
});

test('the scanner flags reachable review code and forbidden bare imports', () => {
  const files: Record<string, string> = {
    'modules/design/components/src/product/index.ts': "export { a } from './a.ts';\nimport type { B } from '../review/b.ts';",
    'modules/design/components/src/product/a.ts': "import '@hq/design-annotations';\nexport const a = await import('../model/c.ts');",
    'modules/design/components/src/review/b.ts': 'export type B = 1;',
    'modules/design/components/src/model/c.ts': "import { x } from './missing.ts';",
  };
  const result = scanImportGraph('modules/design/components/src/product/index.ts', (path) => files[path] ?? null);
  const reasons = result.violations.map((violation) => `${violation.specifier}: ${violation.reason}`);
  assert.deepEqual(reasons.sort(), [
    '@hq/design-annotations: bare import of review, annotation or UI framework code',
    'modules/design/components/src/model/missing.ts: module could not be read',
    'modules/design/components/src/review/b.ts: reachable module is outside the product-safe allowlist',
  ]);
});

test('import specifier extraction covers static, type-only, re-export, side-effect and dynamic forms', () => {
  const code = [
    "import a from './a.ts';",
    "import type { B } from './b.ts';",
    "import {\n  c,\n  d,\n} from './cd.ts';",
    "export * from './e.ts';",
    "export { f } from './f.ts';",
    "import './g.ts';",
    "const h = await import('./h.ts');",
  ].join('\n');
  assert.deepEqual(importSpecifiers(code), ['./a.ts', './b.ts', './cd.ts', './e.ts', './f.ts', './g.ts', './h.ts']);
});
