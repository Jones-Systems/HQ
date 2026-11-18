// End to end: the tool runs as a child process against bare repositories built from the synthetic corpus
// (and a second synthetic repository that exercises every counter). The expected figures are derived from
// the fixture text and from Git itself, never from the tool's own output.

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { after, before, describe, test } from 'node:test';
import { buildCorpus, REMOTE, type SyntheticCorpus } from '../../../app/test/corpus.ts';
import { INDEX_RULES_VERSION } from '../../src/index.ts';
import { fingerprintTree, isolatedGitEnv } from '../../test/support.ts';
import { createScratch, type Scratch } from './scratch.ts';
import { zeroReport } from '../collect.ts';
import { MAX_INPUT_BYTES } from '../config-file.ts';
import type { NamespaceReport, Report } from '../report.ts';
import {
  SHAPE_PAGES,
  TAGS_PER_PAGE,
  TAG_PAGES,
  WIKI_ROOT,
  buildShapeRepo,
  indexInProcess,
  leaks,
  occurs,
  privateStrings,
  rowPaths,
  runTool,
  shapeProfile,
  vocabulary,
  writeJson,
  type ShapeRepo,
  type ToolRun,
} from './support.ts';

/** Pinned on purpose: a new key in the report must be added here by a reviewer, not appear silently. */
const REPORT_KEYS = [
  'active', 'batch', 'closed', 'failedStarts', 'oneShot', '10-24', '2', '25-49', '3', '4', '5-9', 'ambiguous', 'ambiguousCandidates', 'backlinks', 'byReason', 'byteLength', 'candidates', 'cap', 'capped', 'contractFailures', 'count', 'edges',
  'excerptsAtCap', 'external', 'failures', 'frontmatter-unsupported', 'getBacklinks', 'getBacklinksMs', 'getPage', 'getPageMs', 'gitProcesses', 'hits', 'indexRulesVersion',
  'indexStatusMs', 'internal', 'internalResolutionPct', 'invalid-input', 'invalidPaths', 'links', 'listSourcesMs', 'listTopicsMs', 'markdown-unsupported', 'max', 'md-path-not-found',
  'mismatches', 'missing', 'missingShapes', 'ms', 'namespace', 'namespaces', 'non-page-extension', 'not-found', 'not-text', 'nullOmissions', 'ok', 'orphanPages', 'other', 'outLinkCaps',
  'outLinks', 'oversize', 'p50', 'p95', 'page', 'pages', 'pagesWithInbound', 'parsed', 'path-like', 'peakRssBytes', 'queries', 'ratePct', 'raw', 'rawByReason', 'ref', 'refresh',
  'refreshMs', 'reportVersion', 'resolveAlias', 'resolveAliasMs', 'resolved', 'resolvedToSelf', 'sample', 'sampling', 'search', 'skipped', 'slug-like', 'snapshotBytes',
  'sourcesUnavailable', 'state', 'submodules', 'symlinks', 'targets', 'timing', 'title', 'title-like', 'topics', 'total', 'truncated', 'truncatedPageLists', 'unavailable', 'withBacklinks',
];
/** The only strings a report may hold. */
const REPORT_STRINGS = ['appdev', 'bl', 'building', 'configured', 'ready', 'stale', 'unavailable'];

const UNAVAILABLE_LINE = 'wiki-validate: one or more sources are unavailable';
const SENTINEL = 'sentinel-7c1e';
const QUERY_TEXTS = ['quokkaharbor', 'zzznotpresent'];

/** Lines of stderr that Node itself may print (warnings about experimental or permission flags); everything else is the tool's. */
function toolStderr(stderr: string): string {
  return stderr
    .split('\n')
    .filter((line) => line !== '' && !/^\(node:\d+\) |^\(Use `node --trace-warnings/.test(line))
    .join('\n');
}

type Json = Record<string, unknown>;

function isRecord(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Deep merge of `patch` onto `base`: records merge, everything else (including arrays) is replaced. */
function merge<T>(base: T, patch: unknown): T {
  if (!isRecord(base) || !isRecord(patch)) return patch as T;
  const out: Json = { ...base };
  for (const [key, value] of Object.entries(patch)) out[key] = key in base ? merge(base[key], value) : value;
  return out as T;
}

/** A namespace report without what varies from run to run: timings and per-query milliseconds. */
function stable(report: NamespaceReport): Json {
  const copy: Json = { ...report };
  delete copy['timing'];
  delete copy['snapshotBytes'];
  delete copy['gitProcesses'];
  copy['search'] = { queries: report.search.queries.map((query) => ({ ok: query.ok, hits: query.hits, truncated: query.truncated })) };
  return copy;
}

function checkProcesses(ns: NamespaceReport): void {
  const p = ns.gitProcesses;
  assert.equal(p.oneShot, 5);
  assert.ok(p.batch >= 1);
  assert.equal(p.refresh + p.sampling, p.oneShot + p.batch);
  assert.equal(p.closed, p.oneShot + p.batch);
  assert.equal(p.failedStarts, 0);
  assert.equal(p.active, 0);
}

const expected = (namespace: 'bl' | 'appdev', patch: unknown): Json => merge(stable(zeroReport(namespace, 'ready', 0, 0, 0)), patch);

const BL = {
  pages: 9,
  raw: { total: 1, ratePct: 11.11, byReason: { 'frontmatter-unsupported': 1 } },
  skipped: { symlinks: 1, submodules: 1 },
  links: { targets: { page: 6, missing: 2, external: 1 }, internalResolutionPct: 75 },
  missingShapes: { 'md-path-not-found': 1, 'title-like': 1 },
  topics: { count: 8, candidates: 8 },
  backlinks: { edges: 6, pagesWithInbound: 4, orphanPages: 5 },
  sample: {
    pages: 9,
    getPage: { ok: 9, parsed: 8, rawByReason: { 'frontmatter-unsupported': 1 } },
    getBacklinks: { ok: 9, withBacklinks: 4, total: 6 },
    resolveAlias: { ok: 9, resolved: 9, resolvedToSelf: 9 },
  },
};

const APPDEV = {
  pages: 4,
  links: { targets: { page: 5, missing: 1 }, internalResolutionPct: 83.33 },
  missingShapes: { 'title-like': 1 },
  topics: { count: 1, candidates: 1 },
  backlinks: { edges: 5, pagesWithInbound: 4, orphanPages: 0 },
  sample: {
    pages: 4,
    getPage: { ok: 4, parsed: 4 },
    getBacklinks: { ok: 4, withBacklinks: 4, total: 5 },
    resolveAlias: { ok: 4, resolved: 4, resolvedToSelf: 4 },
  },
};

/** `quokkaharbor` is on exactly one page of each namespace; the other query matches nothing. */
const WITH_QUERIES = { search: { queries: [{ ok: true, hits: 1, truncated: false }, { ok: true, hits: 0, truncated: false }] } };

let scratch: Scratch;
let corpus: SyntheticCorpus;
let configPath: string;
let queriesPath: string;
let childEnv: NodeJS.ProcessEnv;
let childCwd: string;
let json: ToolRun;
let table: ToolRun;
let report: Report;
let forbidden: Set<string>;
let extraForbidden: string[];

function git(gitDir: string, ...args: string[]): string {
  return execFileSync('git', [`--git-dir=${gitDir}`, ...args], { env: isolatedGitEnv(), encoding: 'utf8' });
}

/** Regular `.md` blobs below `prefix`, counted by Git itself. */
function pagesIn(gitDir: string, prefix: string): number {
  return git(gitDir, 'ls-tree', '-r', '-z', '--full-tree', 'main')
    .split('\0')
    .filter((entry) => entry.startsWith('100644 blob ') && (entry.split('\t')[1] as string).startsWith(prefix) && entry.endsWith('.md')).length;
}

const parse = (run: ToolRun): Report => JSON.parse(run.stdout) as Report;
const namespaceOf = (value: Report, name: 'bl' | 'appdev'): NamespaceReport => value.namespaces.find((ns) => ns.namespace === name) as NamespaceReport;
const profileOf = (index: 0 | 1): Record<string, unknown> => corpus.profiles[index] as Record<string, unknown>;

function put(name: string, content: string): string {
  const path = join(scratch.root, name);
  writeFileSync(path, content);
  return path;
}

before(async () => {
  scratch = createScratch('wiki-validate-e2e');
  corpus = buildCorpus(join(scratch.root, 'repos'));
  for (const name of ['home-7c1e', 'tmp-7c1e', 'cwd-7c1e', 'private-7c1e']) mkdirSync(join(scratch.root, name));
  childCwd = join(scratch.root, 'cwd-7c1e');
  childEnv = { PATH: process.env['PATH'] ?? '', HOME: join(scratch.root, 'home-7c1e'), TMPDIR: join(scratch.root, 'tmp-7c1e') };
  configPath = writeJson(join(scratch.root, 'private-7c1e', 'sources.json'), { version: 1, sources: corpus.profiles });
  queriesPath = writeJson(join(scratch.root, 'private-7c1e', 'queries.json'), { version: 1, queries: QUERY_TEXTS });

  json = await runTool(['--config', configPath, '--queries', queriesPath, '--json'], { cwd: childCwd, env: childEnv });
  table = await runTool(['--config', configPath, '--queries', queriesPath], { cwd: childCwd, env: childEnv });
  report = parse(json);
  forbidden = await privateStrings(corpus.profiles);
  extraForbidden = [scratch.root, configPath, queriesPath, ...QUERY_TEXTS, 'example.invalid', 'private-7c1e', 'sources.json'];
});
after(() => scratch.cleanup());

describe('aggregates for the synthetic corpus', () => {
  test('the tool succeeds silently and prints one JSON report', () => {
    assert.equal(json.code, 0);
    assert.equal(toolStderr(json.stderr), '');
    assert.equal(json.stdout.at(-1), '\n');
    assert.equal(report.reportVersion, 2);
    assert.equal(report.indexRulesVersion, INDEX_RULES_VERSION);
    assert.equal(report.sourcesUnavailable, 0);
    assert.ok(report.peakRssBytes > 10_000_000, 'peak resident set size of the tool process');
    assert.deepEqual(report.namespaces.map((ns) => ns.namespace), ['bl', 'appdev']);
  });

  test('bl: counts, raw reasons, skipped entries, link kinds, shapes, topics, backlinks, sampling and Git processes', () => {
    assert.deepEqual(stable(namespaceOf(report, 'bl')), expected('bl', { ...BL, ...WITH_QUERIES }));
  });

  test('appdev: the root prefix, directory topics and namespace-scoped links', () => {
    assert.deepEqual(stable(namespaceOf(report, 'appdev')), expected('appdev', { ...APPDEV, ...WITH_QUERIES }));
  });

  test('the figures agree with what Git says is in the repositories', () => {
    const bl = namespaceOf(report, 'bl');
    const appdev = namespaceOf(report, 'appdev');
    assert.equal(bl.pages, pagesIn(corpus.repos.bl.gitDir, ''));
    assert.equal(appdev.pages, pagesIn(corpus.repos.appdev.gitDir, 'notes/'));
    // Five one-shot plumbing commands. Batch starts may vary with idle expiry and retirement;
    // process cardinality is checked by observed launch/close conservation, never page count.
    for (const ns of [bl, appdev]) checkProcesses(ns);

  });

  test('the serialised snapshot size is the size of the stored snapshot', async () => {
    assert.equal(namespaceOf(report, 'bl').snapshotBytes, (await indexInProcess(profileOf(0))).bytes);
    assert.equal(namespaceOf(report, 'appdev').snapshotBytes, (await indexInProcess(profileOf(1))).bytes);
  });

  test('timings are measured: refresh took time, percentiles are ordered, every query has an entry', () => {
    for (const ns of report.namespaces) {
      assert.ok(ns.timing.refreshMs > 0);
      for (const spread of [ns.timing.getPageMs, ns.timing.getBacklinksMs, ns.timing.resolveAliasMs]) assert.ok(spread.p50 <= spread.p95 && spread.p95 <= spread.max);
      assert.ok(ns.timing.getPageMs.max > 0, 'a page read takes time');
      assert.equal(ns.search.queries.length, QUERY_TEXTS.length);
    }
  });

  test('--namespace restricts the run and, without --queries, search timing is skipped', async () => {
    const run = await runTool(['--config', configPath, '--namespace', 'appdev', '--json'], { cwd: childCwd, env: childEnv });
    assert.equal(run.code, 0);
    const only = parse(run);
    assert.deepEqual(only.namespaces.map((ns) => ns.namespace), ['appdev']);
    assert.deepEqual(only.namespaces[0]?.search.queries, []);
    assert.deepEqual(stable(namespaceOf(only, 'appdev')), expected('appdev', APPDEV));
  });

  test('the table mode prints the same figures, omits all-zero rows and says so', () => {
    assert.equal(table.code, 0);
    assert.equal(toolStderr(table.stderr), '');
    const text = table.stdout;
    assert.ok(text.startsWith(`wiki source validation (aggregates only), report v2, index rules v${INDEX_RULES_VERSION}\n`));
    assert.match(text, /\nmetric +bl +appdev\n/);
    assert.match(text, /\npages +9 +4\n/);
    assert.match(text, /\nlinks\.internalResolutionPct +75 +83\.33\n/);
    assert.match(text, /\ngitProcesses\.oneShot +5 +5\n/);
    assert.doesNotMatch(text, /nullOmissions|topics\.capped|oversize/);
    assert.match(text, /\nrows that are zero for every namespace are omitted; --json lists all of them\n$/);
  });
});

describe('privacy: nothing but numbers and fixed words', () => {
  test('the collection of private strings is real, so an empty result below means something', () => {
    for (const value of [
      'guides/onboarding.md', 'Retry Policy', 'Getting Started', 'Duplicate Alias', 'ambiguity', 'policies', 'aliases', 'related', 'main', 'notes', 'No Such Page', 'architecture',
      REMOTE, corpus.repos.bl.commit, corpus.repos.appdev.commit, corpus.repos.bl.gitDir,
    ]) {
      assert.ok(forbidden.has(value), value);
    }
    assert.ok(forbidden.size > 60);
  });

  test('the detector sees whole words and paths and ignores fragments of fixed words', () => {
    assert.ok(occurs('x guides/onboarding.md y', 'guides/onboarding.md'));
    assert.ok(occurs('"main"', 'main'));
    assert.ok(!occurs('remaining', 'main'));
    assert.ok(!occurs('indexRulesVersion', 'index'));
    assert.deepEqual(leaks(['Retry Policy'], ['a Retry Policy b']), ['Retry Policy']);
    assert.deepEqual(leaks(['Retry Policy', 'ab'], ['no match here', 'ab ab']), [], 'short strings are not searched');
  });

  test('the strings excluded from substring search are fixed words of the report', () => {
    assert.ok(REPORT_KEYS.includes('title'));
    assert.match(table.stdout, /\bindex rules\b/);
  });

  test('no path, title, alias, field, topic label, commit id, repository URL, gitDir, query or config path in stdout or stderr, in either mode', () => {
    assert.deepEqual(leaks(forbidden, [json.stdout, json.stderr, table.stdout, table.stderr], extraForbidden), []);
  });

  test('the JSON holds exactly the declared keys and only fixed strings', () => {
    const { keys, strings } = vocabulary(report);
    assert.deepEqual([...keys].sort(), [...REPORT_KEYS].sort());
    assert.deepEqual([...strings].sort(), ['appdev', 'bl', 'configured', 'ready']);
    for (const value of strings) assert.ok(REPORT_STRINGS.includes(value));
    for (const ns of report.namespaces) assert.equal(ns.ref, 'configured', 'the ref is reported only as "configured"');
  });

  test('the table holds exactly rows of the JSON, with numbers, yes/no, dashes and fixed words as cells', () => {
    const rows = rowPaths(report.namespaces[0]);
    rows.delete('namespace');
    const lines = table.stdout.trimEnd().split('\n');
    assert.equal(lines[0], `wiki source validation (aggregates only), report v2, index rules v${INDEX_RULES_VERSION}`);
    assert.match(lines[1] as string, /^sources unavailable: \d+, peak rss bytes: \d+$/);
    assert.match(lines[2] as string, /^metric +bl +appdev$/);
    assert.match(lines.at(-1) as string, /^rows that are zero for every namespace are omitted; --json lists all of them$/);
    const body = lines.slice(3, -1);
    assert.ok(body.length > 30);
    for (const line of body) {
      const match = /^(\S+) +(\S+) +(\S+)$/.exec(line);
      assert.ok(match !== null, `three columns: ${line.length} characters`);
      assert.ok(rows.has(match[1] as string), 'a row of the report');
      for (const cell of [match[2], match[3]]) assert.match(cell as string, /^(?:\d+(?:\.\d+)?|yes|no|-|configured|ready|unavailable|stale|building)$/);
    }
  });
});

describe('sources that are unavailable', () => {
  const cases: [string, (profile: Json) => Json, number][] = [
    ['a repository directory that does not exist', (p) => ({ ...p, gitDir: join(scratch.root, `${SENTINEL}-missing.git`) }), 0],
    ['a remote that is not the configured one', (p) => ({ ...p, expectedRemote: `https://example.invalid/${SENTINEL}/other.git` }), 2],
    ['a branch that does not exist', (p) => ({ ...p, ref: `${SENTINEL}-branch` }), 3],
    ['a root prefix with nothing below it', (p) => ({ ...p, rootPrefix: `${SENTINEL}-prefix` }), 5],
  ];
  for (const [name, change, processes] of cases) {
    test(`${name}: exit 3, zeroed aggregates with the observed Git process count, nothing from the profile in the output`, async () => {
      const path = writeJson(join(scratch.root, `unavailable-${processes}.json`), { version: 1, sources: [change(profileOf(1))] });
      const run = await runTool(['--config', path, '--json'], { cwd: childCwd, env: childEnv });
      assert.equal(run.code, 3);
      assert.equal(toolStderr(run.stderr), UNAVAILABLE_LINE);
      const out = parse(run);
      assert.equal(out.sourcesUnavailable, 1);
      const only = namespaceOf(out, 'appdev');
      assert.equal(only.state, 'unavailable');
      assert.equal(only.gitProcesses.refresh, processes);
      assert.equal(only.gitProcesses.closed, processes);
      assert.equal(only.gitProcesses.active, 0);
      assert.deepEqual(stable(only), stable(zeroReport('appdev', 'unavailable', 0, 0, 0)));
      assert.deepEqual(leaks(forbidden, [run.stdout, run.stderr], [SENTINEL, path, scratch.root]), []);
    });
  }

  test('one unavailable source does not hide the others: exit 3 with the available namespace in full', async () => {
    const broken = { ...profileOf(1), gitDir: join(scratch.root, `${SENTINEL}-gone.git`) };
    const path = writeJson(join(scratch.root, 'mixed.json'), { version: 1, sources: [corpus.profiles[0], broken] });
    const run = await runTool(['--config', path, '--queries', queriesPath, '--json'], { cwd: childCwd, env: childEnv });
    assert.equal(run.code, 3);
    assert.equal(toolStderr(run.stderr), UNAVAILABLE_LINE);
    const out = parse(run);
    assert.equal(out.sourcesUnavailable, 1);
    assert.deepEqual(stable(namespaceOf(out, 'bl')), expected('bl', { ...BL, ...WITH_QUERIES }));
    assert.equal(namespaceOf(out, 'appdev').state, 'unavailable');
    assert.deepEqual(leaks(forbidden, [run.stdout, run.stderr], [SENTINEL, path, scratch.root]), []);
    const text = await runTool(['--config', path], { cwd: childCwd, env: childEnv });
    assert.equal(text.code, 3);
    assert.match(text.stdout, /\nstate +ready +unavailable\n/);
  });
});

describe('read-only: nothing is written and the sources do not change', () => {
  const snapshotOfRepos = () =>
    [corpus.repos.bl, corpus.repos.appdev].map((repo) => ({
      head: git(repo.gitDir, 'rev-parse', 'refs/heads/main'),
      tree: git(repo.gitDir, 'ls-tree', '-r', '--full-tree', 'main'),
      files: fingerprintTree(repo.gitDir),
    }));

  test('Git sees the same commits and trees before and after, and every file of the scratch tree is byte-identical', async () => {
    const reposBefore = snapshotOfRepos();
    const treeBefore = fingerprintTree(scratch.root);
    const run = await runTool(['--config', configPath, '--queries', queriesPath, '--json'], { cwd: childCwd, env: childEnv });
    assert.equal(run.code, 0);
    assert.deepEqual(snapshotOfRepos(), reposBefore);
    assert.equal(reposBefore[0]?.head.trim(), corpus.repos.bl.commit);
    assert.equal(fingerprintTree(scratch.root), treeBefore, 'no file anywhere in the scratch tree was created, changed or removed');
    for (const dir of ['home-7c1e', 'tmp-7c1e', 'cwd-7c1e']) assert.deepEqual(readdirSync(join(scratch.root, dir)), [], `${dir} stays empty`);
  });

  test('a run under the Node permission model with no write grant at all succeeds with the same figures', async () => {
    const run = await runTool(['--config', configPath, '--queries', queriesPath, '--json'], {
      cwd: childCwd,
      env: childEnv,
      nodeArgs: ['--permission', `--allow-fs-read=${WIKI_ROOT}`, `--allow-fs-read=${scratch.root}`, '--allow-child-process'],
    });
    assert.equal(run.code, 0, run.stderr);
    const out = parse(run);
    assert.deepEqual(stable(namespaceOf(out, 'bl')), expected('bl', { ...BL, ...WITH_QUERIES }));
    assert.deepEqual(stable(namespaceOf(out, 'appdev')), expected('appdev', { ...APPDEV, ...WITH_QUERIES }));
  });
});

describe('invalid input through the real entry point', () => {
  const cases: [string, () => string[]][] = [
    ['no arguments', () => []],
    ['a config that is not JSON', () => ['--config', put('text.json', `${SENTINEL} not json`)]],
    ['a config with an unknown top-level key', () => ['--config', writeJson(join(scratch.root, 'extra.json'), { version: 1, sources: corpus.profiles, [SENTINEL]: 1 })]],
    ['a profile with an unknown key', () => ['--config', writeJson(join(scratch.root, 'profile.json'), { version: 1, sources: [{ ...profileOf(0), [SENTINEL]: 1 }] })]],
    ['a profile with a relative gitDir', () => ['--config', writeJson(join(scratch.root, 'relative.json'), { version: 1, sources: [{ ...profileOf(0), gitDir: `${SENTINEL}/repo.git` }] })]],
    ['a query with a control character', () => ['--config', configPath, '--queries', writeJson(join(scratch.root, 'query.json'), { version: 1, queries: [`${SENTINEL}\u0001`] })]],
    ['a symlinked config', () => {
      const link = join(scratch.root, `${SENTINEL}-link.json`);
      symlinkSync(configPath, link);
      return ['--config', link];
    }],
    ['an oversized config', () => ['--config', put(`${SENTINEL}-big.json`, ' '.repeat(MAX_INPUT_BYTES + 1))]],
  ];
  for (const [name, args] of cases) {
    test(`${name}: exit 2, empty stdout, one fixed line on stderr, no value from the input`, async () => {
      const run = await runTool(args(), { cwd: childCwd, env: childEnv });
      assert.equal(run.code, 2);
      assert.equal(run.stdout, '');
      assert.match(toolStderr(run.stderr), /^wiki-validate: invalid (?:arguments|config file|queries file)/);
      assert.doesNotMatch(run.stderr, /\bat \S+ \(|node:internal|\.ts:\d+/, 'no stack trace');
      assert.deepEqual(leaks(forbidden, [run.stdout, run.stderr], [SENTINEL, scratch.root, ...QUERY_TEXTS]), []);
    });
  }
});

describe('a repository that exercises every counter', () => {
  let shape: ShapeRepo;
  let out: Report;
  let ns: NamespaceReport;
  let run: ToolRun;
  let shapeConfig: string;
  let excerptsAtCap: number;

  before(async () => {
    shape = buildShapeRepo(join(scratch.root, 'shape'));
    shapeConfig = writeJson(join(scratch.root, 'shape.json'), { version: 1, sources: [shapeProfile(shape.repo)] });
    run = await runTool(['--config', shapeConfig, '--queries', queriesPath, '--json'], { cwd: childCwd, env: childEnv });
    out = parse(run);
    ns = namespaceOf(out, 'bl');
    excerptsAtCap = (await indexInProcess(shapeProfile(shape.repo))).snapshot.pages.filter((page) => page.excerpt.length >= 4096).length;
  });

  test('pages, raw reasons, null omissions, skipped entries, oversize, the out-link cap and long excerpts', () => {
    assert.equal(run.code, 0, run.stderr);
    assert.equal(shape.paths.length, SHAPE_PAGES);
    assert.equal(ns.pages, SHAPE_PAGES);
    assert.deepEqual(ns.raw, { total: 3, ratePct: Math.round((3 / SHAPE_PAGES) * 10000) / 100, byReason: { 'frontmatter-unsupported': 1, 'markdown-unsupported': 1, 'not-text': 1 } });
    assert.equal(ns.nullOmissions, 5, 'three null fields and two null list items');
    assert.deepEqual(ns.skipped, { symlinks: 1, submodules: 1, other: 0, invalidPaths: 0 });
    assert.equal(ns.oversize, 1, 'a blob of one byte more than the contract cap');
    assert.equal(ns.outLinkCaps, 1, 'one page with 1001 distinct targets');
    assert.ok(excerptsAtCap >= 1, 'the long page fills its excerpt');
    assert.equal(ns.excerptsAtCap, excerptsAtCap);
  });

  test('link targets by kind, the resolution percentage, every missing-target shape and the ambiguity histogram', () => {
    assert.deepEqual(ns.links, { targets: { page: 1, missing: 6, ambiguous: 2, external: 1002 }, internalResolutionPct: 11.11 });
    assert.deepEqual(ns.missingShapes, { 'non-page-extension': 1, 'md-path-not-found': 1, 'path-like': 1, 'slug-like': 1, 'title-like': 1, other: 1 });
    assert.deepEqual(ns.ambiguousCandidates, { '2': 1, '3': 1, '4': 0, '5-9': 0, '10-24': 0, '25-49': 0, cap: 0 });
    assert.deepEqual(ns.backlinks, { edges: 1, pagesWithInbound: 1, orphanPages: SHAPE_PAGES - 1 });
  });

  test('topics are capped at the contract limit and the tool says so', () => {
    const candidates = 1 + 2 + TAG_PAGES * TAGS_PER_PAGE + 1;
    assert.deepEqual(ns.topics, { count: 500, candidates, capped: true, truncatedPageLists: 1 });
  });

  test('sampling takes every Nth page up to 200 and the sample is read through the service', () => {
    const sampled = shape.paths.filter((_, i) => i % 2 === 0);
    assert.equal(sampled.length, Math.ceil(SHAPE_PAGES / 2));
    assert.ok(sampled.length <= 200);
    const raw = (reason: string) => sampled.filter((path) => shape.rawPages[path] === reason).length;
    const none = { 'invalid-input': 0, 'not-found': 0, unavailable: 0, internal: 0 };
    assert.equal(ns.sample.pages, sampled.length);
    assert.deepEqual(ns.sample.getPage, {
      ok: sampled.length,
      parsed: sampled.length - raw('frontmatter-unsupported') - raw('markdown-unsupported') - raw('not-text'),
      rawByReason: { 'frontmatter-unsupported': raw('frontmatter-unsupported'), 'markdown-unsupported': raw('markdown-unsupported'), 'not-text': raw('not-text') },
      failures: none,
    });
    const linked = sampled.includes('twin-a.md') ? 1 : 0;
    assert.deepEqual(ns.sample.getBacklinks, { ok: sampled.length, withBacklinks: linked, total: linked, truncated: 0, failures: none });
    assert.deepEqual(ns.sample.resolveAlias, { ok: sampled.length, resolved: sampled.length, resolvedToSelf: sampled.length, ambiguous: 0, missing: 0, failures: none });
    assert.deepEqual(ns.sample.mismatches, { raw: 0, title: 0, byteLength: 0, outLinks: 0 });
    checkProcesses(ns);
    assert.equal(ns.contractFailures, 0);
  });

  test('no private string of this repository reaches the output either', () => {
    const strings = [...shape.strings, shape.repo.gitDir, shape.repo.commit, shape.repo.tree, shapeConfig, scratch.root, REMOTE, ...QUERY_TEXTS];
    assert.ok(strings.length > 600);
    assert.deepEqual(leaks(strings, [run.stdout, run.stderr]), []);
    assert.deepEqual([...vocabulary(out).keys].sort(), [...REPORT_KEYS].sort());
  });
});
