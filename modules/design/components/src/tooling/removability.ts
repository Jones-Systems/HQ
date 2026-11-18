/**
 * Removability scan. Walks the static import graph from a product entry and
 * reports any reachable module that belongs to the review layer, and any
 * review marker in a built product document. File access is injected so the
 * scan runs on real sources and on synthetic graphs alike.
 */

export interface RemovabilityRules {
  /** Repository-relative prefixes a product may reach. */
  readonly allowedPrefixes: readonly string[];
  /** Bare specifiers that are review or annotation code. */
  readonly forbiddenBare: RegExp;
}

export interface Violation {
  readonly file: string;
  readonly specifier: string;
  readonly reason: string;
}

export interface ScanResult {
  readonly reachable: readonly string[];
  readonly violations: readonly Violation[];
}

export const PRODUCT_RULES: RemovabilityRules = {
  allowedPrefixes: [
    'modules/design/components/src/product/',
    'modules/design/components/src/model/',
    'modules/design/components/src/contract.ts',
  ],
  forbiddenBare: /annotation|review|preview-agent|^@hq\/|^react(-dom)?(\/|$)/iu,
};

/** Markers of review-layer code that must never appear in a product document. */
export const REVIEW_MARKERS: readonly string[] = [
  'hq.design.component-sandbox', 'postMessage', 'data-hq-', 'hq-component-root', 'hq-component-props',
  'annotation', 'motion-frame', 'NONCE',
];

const SPECIFIER = /\b(?:import|export)\s+(?:type\s+)?(?:[\w*{}\s,$]+\s+from\s+)?['"]([^'"]+)['"]|\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/gu;

export function importSpecifiers(code: string): readonly string[] {
  const found: string[] = [];
  for (const match of code.matchAll(SPECIFIER)) {
    const specifier = match[1] ?? match[2];
    if (specifier !== undefined) found.push(specifier);
  }
  return found;
}

function normalize(path: string): string {
  const parts: string[] = [];
  for (const part of path.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') parts.pop();
    else parts.push(part);
  }
  return parts.join('/');
}

function dirname(path: string): string {
  const index = path.lastIndexOf('/');
  return index < 0 ? '' : path.slice(0, index);
}

export function scanImportGraph(entry: string, read: (path: string) => string | null, rules: RemovabilityRules = PRODUCT_RULES): ScanResult {
  const reachable = new Set<string>();
  const violations: Violation[] = [];
  const queue = [normalize(entry)];
  while (queue.length > 0) {
    const file = queue.shift() as string;
    if (reachable.has(file)) continue;
    reachable.add(file);
    if (!rules.allowedPrefixes.some((prefix) => file.startsWith(prefix))) {
      violations.push({ file, specifier: file, reason: 'reachable module is outside the product-safe allowlist' });
    }
    const code = read(file);
    if (code === null) {
      violations.push({ file, specifier: file, reason: 'module could not be read' });
      continue;
    }
    for (const specifier of importSpecifiers(code)) {
      if (specifier.startsWith('.')) {
        queue.push(normalize(`${dirname(file)}/${specifier}`));
      } else if (rules.forbiddenBare.test(specifier)) {
        violations.push({ file, specifier, reason: 'bare import of review, annotation or UI framework code' });
      }
    }
  }
  return { reachable: [...reachable].sort(), violations };
}

export function scanProductOutput(document: string): readonly string[] {
  return REVIEW_MARKERS.filter((marker) => document.includes(marker));
}
