// The report is a closed-world value: the only leaves are finite non-negative numbers, booleans, `null`
// and members of fixed enumerations written in this file; the only keys are the ones declared here.
// `render*` checks the finished report against that schema and refuses to print anything that does not
// match, so a path, title, alias, field, topic label, ref, commit id or query can neither be built into
// the output by accident nor reach it through a future change without failing every run.

import { INDEX_STATES, NAMESPACES, RAW_REASONS } from '../../contract/src/index.ts';
import { INDEX_RULES_VERSION } from '../src/index.ts';
import { AMBIGUOUS_BUCKETS, LINK_KINDS, MISSING_SHAPES } from './classify.ts';

/** Version of this tool's report layout. */
export const REPORT_VERSION = 1;
/** Most search queries one run accepts; also the bound of the per-query timing list. */
export const MAX_QUERIES = 100;
/** Most pages sampled for `getPage`, `getBacklinks` and `resolveAlias`. */
export const MAX_SAMPLE = 200;

export type Schema =
  | { readonly t: 'num' }
  | { readonly t: 'bool' }
  | { readonly t: 'enum'; readonly values: readonly string[] }
  | { readonly t: 'nullable'; readonly of: Schema }
  | { readonly t: 'array'; readonly of: Schema; readonly max: number }
  | { readonly t: 'object'; readonly fields: Readonly<Record<string, Schema>> };

export type Infer<S> = S extends { readonly t: 'num' }
  ? number
  : S extends { readonly t: 'bool' }
    ? boolean
    : S extends { readonly t: 'enum'; readonly values: infer V extends readonly string[] }
      ? V[number]
      : S extends { readonly t: 'nullable'; readonly of: infer O }
        ? Infer<O> | null
        : S extends { readonly t: 'array'; readonly of: infer O }
          ? Infer<O>[]
          : S extends { readonly t: 'object'; readonly fields: infer F }
            ? { -readonly [K in keyof F]: Infer<F[K]> }
            : never;

const num = { t: 'num' } as const;
const bool = { t: 'bool' } as const;
const enumOf = <const V extends readonly string[]>(values: V) => ({ t: 'enum', values }) as const;
const nullable = <const O extends Schema>(of: O) => ({ t: 'nullable', of }) as const;
const array = <const O extends Schema>(of: O, max: number) => ({ t: 'array', of, max }) as const;
const object = <const F extends Readonly<Record<string, Schema>>>(fields: F) => ({ t: 'object', fields }) as const;
/** An object with one member per fixed key. */
const table = <const K extends readonly string[], const O extends Schema>(keys: K, of: O) =>
  object(Object.fromEntries(keys.map((key) => [key, of])) as { readonly [P in K[number]]: O });

export const ERROR_CODES = ['invalid-input', 'not-found', 'unavailable', 'internal'] as const;
const failures = table(ERROR_CODES, num);
const timing = object({ p50: num, p95: num, max: num });

const namespaceSchema = object({
  namespace: enumOf(NAMESPACES),
  /** The ref is never reported: it is always the fixed word `configured`. */
  ref: enumOf(['configured']),
  state: enumOf(INDEX_STATES),
  pages: num,
  raw: object({ total: num, ratePct: num, byReason: table(RAW_REASONS, num) }),
  nullOmissions: num,
  skipped: object({ symlinks: num, submodules: num, other: num, invalidPaths: num }),
  oversize: num,
  outLinkCaps: num,
  excerptsAtCap: num,
  links: object({
    targets: table(LINK_KINDS, num),
    /** page / (page + missing + ambiguous) as a percentage; null when the corpus has no internal link. */
    internalResolutionPct: nullable(num),
  }),
  missingShapes: table(MISSING_SHAPES, num),
  ambiguousCandidates: table(AMBIGUOUS_BUCKETS, num),
  topics: object({ count: num, candidates: num, capped: bool, truncatedPageLists: num }),
  backlinks: object({ edges: num, pagesWithInbound: num, orphanPages: num }),
  sample: object({
    pages: num,
    getPage: object({ ok: num, parsed: num, rawByReason: table(RAW_REASONS, num), failures }),
    getBacklinks: object({ ok: num, withBacklinks: num, total: num, truncated: num, failures }),
    resolveAlias: object({ ok: num, resolved: num, resolvedToSelf: num, ambiguous: num, missing: num, failures }),
    /** Sampled pages whose live parse differs from the index, by field. */
    mismatches: object({ raw: num, title: num, byteLength: num, outLinks: num }),
  }),
  search: object({ queries: array(object({ ok: bool, ms: num, hits: num, truncated: bool }), MAX_QUERIES) }),
  timing: object({
    refreshMs: num,
    listSourcesMs: num,
    indexStatusMs: num,
    listTopicsMs: num,
    getPageMs: timing,
    getBacklinksMs: timing,
    resolveAliasMs: timing,
  }),
  gitProcesses: object({ refresh: num, sampling: num }),
  snapshotBytes: num,
  contractFailures: num,
});

export const REPORT_SCHEMA = object({
  reportVersion: num,
  indexRulesVersion: num,
  sourcesUnavailable: num,
  peakRssBytes: num,
  namespaces: array(namespaceSchema, NAMESPACES.length),
});

export type NamespaceReport = Infer<typeof namespaceSchema>;
export type Report = Infer<typeof REPORT_SCHEMA>;

/** Thrown when a report would contain anything the schema does not allow. */
export class ReportRejected extends Error {}

function conforms(value: unknown, schema: Schema): boolean {
  switch (schema.t) {
    case 'num':
      return typeof value === 'number' && Number.isFinite(value) && value >= 0;
    case 'bool':
      return typeof value === 'boolean';
    case 'enum':
      return typeof value === 'string' && schema.values.includes(value);
    case 'nullable':
      return value === null || conforms(value, schema.of);
    case 'array':
      return Array.isArray(value) && value.length <= schema.max && value.every((item) => conforms(item, schema.of));
    case 'object': {
      if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
      const keys = Object.keys(value);
      const declared = Object.keys(schema.fields);
      if (keys.length !== declared.length || !declared.every((key) => keys.includes(key))) return false;
      return declared.every((key) => conforms((value as Record<string, unknown>)[key], schema.fields[key] as Schema));
    }
  }
}

/** True exactly when `value` is a report built only from the declared keys and fixed leaves. */
export function isClosedReport(value: unknown): value is Report {
  return conforms(value, REPORT_SCHEMA);
}

export function emptyTable<const K extends readonly string[]>(keys: K): { [P in K[number]]: number } {
  return Object.fromEntries(keys.map((key) => [key, 0])) as { [P in K[number]]: number };
}

export function buildReport(namespaces: readonly NamespaceReport[], sourcesUnavailable: number, peakRssBytes: number): Report {
  return { reportVersion: REPORT_VERSION, indexRulesVersion: INDEX_RULES_VERSION, sourcesUnavailable, peakRssBytes, namespaces: [...namespaces] };
}

export function renderJson(report: Report): string {
  if (!isClosedReport(report)) throw new ReportRejected();
  return `${JSON.stringify(report, null, 2)}\n`;
}

type Cell = number | boolean | string | null;

function cells(value: unknown, path: string, out: Map<string, Cell>): void {
  if (Array.isArray(value)) value.forEach((item, i) => cells(item, `${path}[${i}]`, out));
  else if (typeof value === 'object' && value !== null) for (const [key, item] of Object.entries(value)) cells(item, path === '' ? key : `${path}.${key}`, out);
  else out.set(path, value as Cell);
}

function show(cell: Cell | undefined): string {
  if (cell === undefined || cell === null) return '-';
  if (typeof cell === 'boolean') return cell ? 'yes' : 'no';
  return String(cell);
}

const isZero = (cell: Cell | undefined): boolean => cell === undefined || cell === null || cell === 0 || cell === false;

/**
 * A short table: one row per measurement, one column per namespace, built from the same closed report.
 * Rows that are zero (or false, or absent) for every namespace are left out; `--json` lists all of them.
 */
export function renderTable(report: Report): string {
  if (!isClosedReport(report)) throw new ReportRejected();
  const columns = report.namespaces.map((ns) => {
    const map = new Map<string, Cell>();
    cells(ns, '', map);
    return map;
  });
  const rows: string[] = [];
  for (const map of columns) for (const key of map.keys()) if (key !== 'namespace' && !rows.includes(key)) rows.push(key);
  const shown = rows.filter((row) => !columns.every((map) => isZero(map.get(row))));
  const names = report.namespaces.map((ns) => ns.namespace as string);
  const width = Math.max(...shown.map((row) => row.length), 6);
  const widths = names.map((name, i) => Math.max(name.length, ...shown.map((row) => show(columns[i]?.get(row)).length)));
  const line = (label: string, values: readonly string[]) => `${label.padEnd(width)}  ${values.map((v, i) => v.padStart(widths[i] as number)).join('  ')}`.trimEnd();
  return [
    `wiki source validation (aggregates only), report v${report.reportVersion}, index rules v${report.indexRulesVersion}`,
    `sources unavailable: ${report.sourcesUnavailable}, peak rss bytes: ${report.peakRssBytes}`,
    line('metric', names),
    ...shown.map((row) => line(row, columns.map((map) => show(map.get(row))))),
    'rows that are zero for every namespace are omitted; --json lists all of them',
    '',
  ].join('\n');
}
