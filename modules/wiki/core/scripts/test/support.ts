// Shared helpers of the validation tool's tests: run the tool as a child process, build synthetic
// repositories, enumerate every private-looking string of a synthetic source and check that none occurs
// in the tool's output. Synthetic content only: invented names and text, no corpus bytes.

import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  createMemoryIndexStore,
  createNodeGitObjectSource,
  createWikiHost,
  parseSnapshot,
  profileIndexKey,
  validateSourceProfile,
  type IndexSnapshot,
  type SourceProfile,
} from '../../src/index.ts';
import { createBareRepo, profileFor, type RepoFile, type SyntheticRepo } from '../../test/support.ts';

export const TOOL = join(import.meta.dirname, '..', 'validate-sources.ts');
export const WIKI_ROOT = join(import.meta.dirname, '..', '..', '..');

export interface ToolRun {
  readonly code: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

export interface ToolOptions {
  readonly cwd?: string;
  readonly env?: NodeJS.ProcessEnv;
  /** Arguments for `node` itself, before the script. */
  readonly nodeArgs?: readonly string[];
}

/** Run the tool as a child process with `process.execPath` and collect its output. */
export function runTool(args: readonly string[], options: ToolOptions = {}): Promise<ToolRun> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [...(options.nodeArgs ?? []), TOOL, ...args], {
      cwd: options.cwd,
      env: options.env ?? { PATH: process.env['PATH'] ?? '' },
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 180_000,
    });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    child.stdout.on('data', (chunk: Buffer) => out.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => err.push(chunk));
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stdout: Buffer.concat(out).toString('utf8'), stderr: Buffer.concat(err).toString('utf8') }));
  });
}

export function writeJson(path: string, value: unknown): string {
  writeFileSync(path, JSON.stringify(value));
  return path;
}

export function makeDir(path: string): string {
  mkdirSync(path, { recursive: true });
  return path;
}

// ---- the shape corpus: one repository that exercises every counter ----

export const BULK_PAGES = 200;
export const TAG_PAGES = 9;
export const TAGS_PER_PAGE = 60;
/** Pages of the shape repository: the hub, three twins, five odd pages, the long page, the tag pages and the bulk pages. */
export const SHAPE_PAGES = 1 + 3 + 5 + 1 + TAG_PAGES + BULK_PAGES;

export interface ShapeRepo {
  readonly repo: SyntheticRepo;
  /** Paths of every page in the index. */
  readonly paths: readonly string[];
  /** Pages whose raw reason is expected, by path. */
  readonly rawPages: Readonly<Record<string, 'frontmatter-unsupported' | 'markdown-unsupported' | 'not-text'>>;
  /** Every title, alias, tag and field name the files contain. */
  readonly strings: readonly string[];
}

/** A `bl` repository whose pages exercise ambiguous, missing (every shape), raw, null, cap and oversize cases. */
export function buildShapeRepo(root: string): ShapeRepo {
  const files: RepoFile[] = [];
  const strings: string[] = ['title', 'aliases', 'tags', 'empty', 'tilde', 'word'];
  const add = (path: string, content: string | Uint8Array): void => {
    files.push({ path, content });
  };
  add(
    'hub.md',
    [
      '---',
      'title: Hub Page',
      'tags: [alpha]',
      '---',
      '# Hub Page',
      '',
      'Pair: [[Twin Name]]. Trio: [[Triple Name]].',
      'Slug: [[missing-slug-target]]. Words: [[Missing Title Words]]. Odd: [[???]].',
      'Gone: [gone](docs/gone.md). Figure: [figure](assets/figure.png). Deep: [deep](nowhere/deeper/path).',
      'Present: [twin](twin-a.md). Outside: [site](https://example.invalid/a).',
      '',
    ].join('\n'),
  );
  add('twin-a.md', '---\ntitle: Twin A\naliases: [Twin Name, Triple Name]\n---\nFirst twin.\n');
  add('twin-b.md', '---\ntitle: Twin B\naliases: [Twin Name, Triple Name]\n---\nSecond twin.\n');
  add('twin-c.md', '---\ntitle: Twin C\naliases: [Triple Name]\n---\nThird twin.\n');
  add('nulls.md', '---\ntitle: Nulls Page\nempty:\ntilde: ~\nword: null\ntags:\n  - first\n  - null\n  -\n  - second\n---\nNull values are omitted.\n');
  add('raw-markdown.md', `${'> '.repeat(40)}too deep\n`);
  add('raw-front.md', '---\ntitle: &anchor Anchored\n---\nUnsupported front matter.\n');
  add('binary.md', Buffer.from([0x23, 0x20, 0x00, 0x01, 0x02]));
  add('many-links.md', `# Many links\n\n${Array.from({ length: 1001 }, (_, i) => `[n${i}](https://example.invalid/n/${i})`).join('\n')}\n`);
  add('long-body.md', `# Long Body\n\n${'word '.repeat(1500)}\n`);
  add('big.md', Buffer.alloc(2 * 1024 * 1024 + 1, 0x61));
  for (let page = 0; page < TAG_PAGES; page++) {
    const tags = Array.from({ length: TAGS_PER_PAGE }, (_, i) => `t${String(page * TAGS_PER_PAGE + i).padStart(4, '0')}`);
    strings.push(...tags);
    add(`tags-${page}.md`, `---\ntitle: Tag Page ${page}\ntags: [${tags.join(', ')}]\n---\nMany topics.\n`);
  }
  for (let i = 1; i <= BULK_PAGES; i++) add(`bulk-${String(i).padStart(3, '0')}.md`, `---\ntitle: Bulk ${i}\ntags: [bulk]\n---\nBulk page ${i}.\n`);
  files.push({ path: 'link-elsewhere.md', content: 'hub.md', mode: '120000' });
  strings.push('Hub Page', 'Twin A', 'Twin B', 'Twin C', 'Twin Name', 'Triple Name', 'Nulls Page', 'alpha', 'first', 'second', 'bulk', 'Missing Title Words', 'missing-slug-target');

  const repo = createBareRepo(root, 'shapes', { files, gitlinks: ['vendor/sub'] });
  const paths = files.filter((f) => f.path.endsWith('.md') && f.path !== 'big.md' && f.mode !== '120000').map((f) => f.path);
  return {
    repo,
    paths: paths.sort(),
    rawPages: { 'raw-markdown.md': 'markdown-unsupported', 'raw-front.md': 'frontmatter-unsupported', 'binary.md': 'not-text' },
    strings: [...strings, ...paths, 'docs/gone.md', 'assets/figure.png', 'nowhere/deeper/path'],
  };
}

export function shapeProfile(repo: SyntheticRepo): Record<string, unknown> {
  return profileFor('bl', { gitDir: repo.gitDir });
}

// ---- private strings and the vocabulary of the output ----

export interface Indexed {
  readonly profile: SourceProfile;
  readonly host: ReturnType<typeof createWikiHost>;
  readonly snapshot: IndexSnapshot;
  /** Byte length of the serialised snapshot, as the in-memory store holds it. */
  readonly bytes: number;
}

/** Index one synthetic profile in this process with the same real host and Git adapter the tool uses. */
export async function indexInProcess(input: Record<string, unknown>): Promise<Indexed> {
  const checked = validateSourceProfile(input);
  if (!checked.ok) throw new Error('synthetic profile must be valid');
  const profile = checked.value;
  const store = createMemoryIndexStore();
  const host = createWikiHost({ profiles: [profile], sources: { [profile.namespace]: createNodeGitObjectSource(profile) }, store, clock: { now: () => Date.UTC(2026, 0, 3) } });
  await host.refresh();
  const entry = [...store.entries].find(([key]) => key.startsWith(`${profile.namespace}/`));
  if (entry === undefined) throw new Error('synthetic source must index');
  const snapshot = parseSnapshot(JSON.parse(entry[1]) as unknown, {
    namespace: profile.namespace,
    commit: entry[0].slice(profile.namespace.length + 1),
    profileKey: profileIndexKey(profile),
  });
  if (snapshot === null) throw new Error('synthetic snapshot must parse');
  return { profile, host, snapshot, bytes: Buffer.byteLength(entry[1]) };
}

/** The commit, object ids and values of every page of the synthetic profiles, read through the real host. */
export async function privateStrings(profiles: readonly Record<string, unknown>[]): Promise<Set<string>> {
  const found = new Set<string>();
  for (const input of profiles) {
    const { profile, host, snapshot } = await indexInProcess(input);
    // Page extensions are generic configuration (and `.md` is part of the table's row labels), not corpus data.
    for (const value of [profile.gitDir, profile.expectedRemote, profile.ref, profile.rootPrefix, ...Object.values(profile.fieldMappings).flat()]) {
      if (typeof value === 'string' && value !== '') found.add(value);
    }
    found.add(snapshot.commit);
    found.add(snapshot.commitTime);
    const topics = await host.service.listTopics({ namespace: profile.namespace });
    if (topics.ok) for (const topic of topics.value.topics) found.add(topic.label).add(topic.id);
    for (const page of snapshot.pages) {
      found.add(page.path);
      found.add(page.oid);
      found.add(page.title);
      for (const name of [...page.names, ...page.topics]) found.add(name);
      for (const link of page.links) {
        if (link.kind === 'missing') found.add(link.label);
        else if (link.kind === 'external') found.add(link.url);
        else if (link.kind === 'page') found.add(link.key.path);
        else for (const candidate of link.candidates) found.add(candidate.path);
      }
      const live = await host.service.getPage({ key: { namespace: profile.namespace, path: page.path } });
      if (!live.ok) continue;
      for (const field of live.value.fields) {
        found.add(field.name);
        for (const item of Array.isArray(field.value) ? field.value : [field.value]) if (typeof item === 'string') found.add(item);
      }
      for (const link of live.value.outLinks) found.add(link.text);
    }
  }
  return found;
}

/**
 * Strings that are also fixed words of the report: the `title` key and the word `index` of the table header.
 * They are covered by the structural vocabulary check, not by substring search.
 */
export const SHARED_WORDS: readonly string[] = ['title', 'index'];

const WORD_CHARACTER = /[A-Za-z0-9_]/;

/** Whether `needle` occurs in `haystack`, as a whole word when it starts or ends with a word character. */
export function occurs(haystack: string, needle: string): boolean {
  let from = 0;
  for (;;) {
    const at = haystack.indexOf(needle, from);
    if (at < 0) return false;
    const before = at === 0 ? '' : (haystack[at - 1] as string);
    const after = haystack[at + needle.length] ?? '';
    const startsWord = WORD_CHARACTER.test(needle[0] as string);
    const endsWord = WORD_CHARACTER.test(needle[needle.length - 1] as string);
    if (!(startsWord && WORD_CHARACTER.test(before)) && !(endsWord && WORD_CHARACTER.test(after))) return true;
    from = at + 1;
  }
}

/** Strings from `forbidden` (length >= 3) that occur in any of `outputs`. */
export function leaks(forbidden: Iterable<string>, outputs: readonly string[], extra: readonly string[] = []): string[] {
  const hits: string[] = [];
  for (const value of [...forbidden, ...extra]) {
    if (value.length < 3 || SHARED_WORDS.includes(value)) continue;
    if (outputs.some((output) => occurs(output, value))) hits.push(value);
  }
  return hits;
}

/** Every key and every string leaf of a JSON value. */
export function vocabulary(value: unknown, keys = new Set<string>(), strings = new Set<string>()): { keys: Set<string>; strings: Set<string> } {
  if (Array.isArray(value)) for (const item of value) vocabulary(item, keys, strings);
  else if (typeof value === 'object' && value !== null) {
    for (const [key, item] of Object.entries(value)) {
      keys.add(key);
      vocabulary(item, keys, strings);
    }
  } else if (typeof value === 'string') strings.add(value);
  return { keys, strings };
}

/** The dotted paths of a JSON report, as the table prints them (without the namespace identity row). */
export function rowPaths(value: unknown, prefix = '', out = new Set<string>()): Set<string> {
  if (Array.isArray(value)) value.forEach((item, i) => rowPaths(item, `${prefix}[${i}]`, out));
  else if (typeof value === 'object' && value !== null) for (const [key, item] of Object.entries(value)) rowPaths(item, prefix === '' ? key : `${prefix}.${key}`, out);
  else out.add(prefix);
  return out;
}
