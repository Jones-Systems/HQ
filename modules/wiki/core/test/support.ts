// Shared test support: synthetic sources (in memory and as real bare repositories), profiles and a
// host factory. Synthetic content only: invented names and text, no corpus bytes.

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { WikiNamespace, WikiResult } from '../../contract/src/index.ts';
import { createMemoryIndexStore, createWikiHost, type Clock, type GitObjectSource, type Pin, type SourceResult, type TreeEntry } from '../src/index.ts';

export const FIXED_EPOCH = 1767323045; // 2026-01-02T03:04:05Z
export const FIXED_ISO = '2026-01-02T03:04:05Z';
export const CLOCK_MS = Date.UTC(2026, 0, 3, 4, 5, 6, 250);
export const REMOTE = 'https://example.invalid/synthetic/wiki.git';

export const clock: Clock = { now: () => CLOCK_MS };

export function must<T>(result: WikiResult<T>): T {
  if (!result.ok) throw new Error(`expected ok, got ${result.error.code}/${result.error.reason}: ${result.error.message}`);
  return result.value;
}

export function sha1Blob(content: Uint8Array): string {
  const header = Buffer.from(`blob ${content.length}\0`);
  return createHash('sha1').update(header).update(content).digest('hex');
}

export interface MemoryFile {
  readonly content: string | Uint8Array;
  readonly mode?: string;
}

export interface MemorySourceOptions {
  readonly files: Readonly<Record<string, string | Uint8Array | MemoryFile>>;
  readonly ref?: string;
  readonly commit?: string;
}

export interface MemorySource extends GitObjectSource {
  /** Mutable: make every call fail as if the source were gone. */
  down: boolean;
  /** Replace the file set and (optionally) the pinned commit, as a later commit would. */
  replace(files: MemorySourceOptions['files'], commit: string): void;
  readonly blobReads: string[];
  readonly listings: string[];
  pinCalls: number;
}

function normalise(file: string | Uint8Array | MemoryFile): MemoryFile {
  return typeof file === 'string' || file instanceof Uint8Array ? { content: file } : file;
}

export function commitOf(seed: string): string {
  return createHash('sha1').update(`commit:${seed}`).digest('hex');
}

/** A GitObjectSource over an in-memory file map. Blob ids are real Git blob hashes. */
export function memorySource(options: MemorySourceOptions): MemorySource {
  let files = options.files;
  let commit = options.commit ?? commitOf('one');
  const blobs = new Map<string, Uint8Array>();
  const source: MemorySource = {
    down: false,
    blobReads: [],
    listings: [],
    pinCalls: 0,
    replace(next, nextCommit) {
      files = next;
      commit = nextCommit;
    },
    resolvePin(): Promise<SourceResult<Pin>> {
      source.pinCalls++;
      if (source.down) return Promise.resolve({ ok: false, reason: 'unavailable' });
      return Promise.resolve({ ok: true, value: { ref: options.ref ?? 'main', commit, commitTime: FIXED_ISO } });
    },
    listTree(requested) {
      source.listings.push(requested);
      if (source.down || requested !== commit) return Promise.resolve({ ok: false, reason: 'unavailable' });
      const entries: TreeEntry[] = [];
      blobs.clear();
      for (const [path, raw] of Object.entries(files)) {
        const file = normalise(raw);
        const bytes = typeof file.content === 'string' ? Buffer.from(file.content, 'utf8') : file.content;
        const oid = sha1Blob(bytes);
        blobs.set(oid, bytes);
        entries.push({ path, mode: file.mode ?? '100644', oid, size: bytes.length });
      }
      return Promise.resolve({ ok: true, value: { entries, skipped: { symlinks: 0, submodules: 0, other: 0, invalidPaths: 0 } } });
    },
    readBlob(oid, maxBytes) {
      source.blobReads.push(oid);
      if (source.down) return Promise.resolve({ ok: false, reason: 'unavailable' });
      const bytes = blobs.get(oid);
      if (bytes === undefined) return Promise.resolve({ ok: false, reason: 'not-found' });
      if (bytes.length > maxBytes) return Promise.resolve({ ok: false, reason: 'too-large' });
      return Promise.resolve({ ok: true, value: bytes });
    },
  };
  return source;
}

export function profileFor(namespace: WikiNamespace, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    namespace,
    gitDir: '/synthetic/does-not-matter.git',
    expectedRemote: REMOTE,
    ref: 'main',
    rootPrefix: '',
    pageExtensions: ['.md'],
    fieldMappings: { title: 'title', aliases: ['aliases'], topics: ['tags'], relationships: ['related'] },
    topicMode: 'field',
    ...overrides,
  };
}

export interface TestHost {
  readonly host: ReturnType<typeof createWikiHost>;
  readonly store: ReturnType<typeof createMemoryIndexStore>;
  readonly sources: Partial<Record<WikiNamespace, MemorySource>>;
}

/** A host over in-memory sources. `files` per namespace; refresh() must still be called. */
export function memoryHost(
  files: Partial<Record<WikiNamespace, MemorySourceOptions['files']>>,
  profileOverrides: Partial<Record<WikiNamespace, Record<string, unknown>>> = {},
): TestHost {
  const sources: Partial<Record<WikiNamespace, MemorySource>> = {};
  const profiles: unknown[] = [];
  for (const ns of ['bl', 'appdev'] as const) {
    const set = files[ns];
    if (set === undefined) continue;
    sources[ns] = memorySource({ files: set, commit: commitOf(ns) });
    profiles.push(profileFor(ns, profileOverrides[ns]));
  }
  const store = createMemoryIndexStore();
  const host = createWikiHost({ profiles, sources, store, clock });
  return { host, store, sources };
}

// ---- real synthetic bare repositories ----

export interface RepoFile {
  readonly path: string;
  readonly content: string | Uint8Array;
  readonly mode?: '100644' | '100755' | '120000';
}

export interface RepoOptions {
  readonly files: readonly RepoFile[];
  readonly remote?: string | null;
  readonly branch?: string;
  /** Submodule-style gitlink entries (mode 160000) with a made-up commit id. */
  readonly gitlinks?: readonly string[];
}

export interface SyntheticRepo {
  readonly gitDir: string;
  readonly commit: string;
  readonly tree: string;
}

export function isolatedGitEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  return {
    PATH: process.env['PATH'] ?? '',
    HOME: '/nonexistent',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_TERMINAL_PROMPT: '0',
    GIT_AUTHOR_NAME: 'Synthetic Author',
    GIT_AUTHOR_EMAIL: 'author@example.invalid',
    GIT_COMMITTER_NAME: 'Synthetic Committer',
    GIT_COMMITTER_EMAIL: 'committer@example.invalid',
    GIT_AUTHOR_DATE: `${FIXED_EPOCH} +0000`,
    GIT_COMMITTER_DATE: `${FIXED_EPOCH} +0000`,
    ...extra,
  };
}

function git(args: readonly string[], input?: Uint8Array | string, extraEnv: Record<string, string> = {}): string {
  const options: { env: NodeJS.ProcessEnv; encoding: 'utf8'; input?: Uint8Array | string; maxBuffer: number } = {
    env: isolatedGitEnv(extraEnv),
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  };
  if (input !== undefined) options.input = input;
  return execFileSync('git', [...args], options).trim();
}

interface TreeNode {
  readonly files: Map<string, { mode: string; oid: string }>;
  readonly dirs: Map<string, TreeNode>;
  readonly gitlinks: Map<string, string>;
}

function emptyNode(): TreeNode {
  return { files: new Map(), dirs: new Map(), gitlinks: new Map() };
}

function writeTree(gitDir: string, node: TreeNode): string {
  const lines: string[] = [];
  for (const [name, entry] of node.files) lines.push(`${entry.mode} blob ${entry.oid}\t${name}`);
  for (const [name, oid] of node.gitlinks) lines.push(`160000 commit ${oid}\t${name}`);
  for (const [name, child] of node.dirs) lines.push(`040000 tree ${writeTree(gitDir, child)}\t${name}`);
  return git([`--git-dir=${gitDir}`, 'mktree', '--missing'], lines.join('\n') + '\n');
}

/** Create a bare repository with one commit on `branch` using fixed-date plumbing and isolated config. */
export function createBareRepo(root: string, name: string, options: RepoOptions): SyntheticRepo {
  const gitDir = join(root, `${name}.git`);
  mkdirSync(gitDir, { recursive: true });
  git(['init', '--bare', '--quiet', '--initial-branch=main', gitDir]);
  if (options.remote !== null) git([`--git-dir=${gitDir}`, 'config', 'remote.origin.url', options.remote ?? REMOTE]);
  const rootNode = emptyNode();
  const place = (path: string, apply: (node: TreeNode, leaf: string) => void) => {
    const segments = path.split('/');
    let node = rootNode;
    for (const segment of segments.slice(0, -1)) {
      let child = node.dirs.get(segment);
      if (child === undefined) {
        child = emptyNode();
        node.dirs.set(segment, child);
      }
      node = child;
    }
    apply(node, segments[segments.length - 1] as string);
  };
  for (const file of options.files) {
    const bytes = typeof file.content === 'string' ? Buffer.from(file.content, 'utf8') : file.content;
    const oid = execFileSync('git', [`--git-dir=${gitDir}`, 'hash-object', '-w', '--stdin'], { env: isolatedGitEnv(), input: bytes, encoding: 'utf8' }).trim();
    place(file.path, (node, leaf) => node.files.set(leaf, { mode: file.mode ?? '100644', oid }));
  }
  for (const path of options.gitlinks ?? []) place(path, (node, leaf) => node.gitlinks.set(leaf, 'c'.repeat(40)));
  const tree = writeTree(gitDir, rootNode);
  const commit = git([`--git-dir=${gitDir}`, 'commit-tree', tree, '-m', 'synthetic'], undefined);
  git([`--git-dir=${gitDir}`, 'update-ref', `refs/heads/${options.branch ?? 'main'}`, commit]);
  return { gitDir, commit, tree };
}

/** Byte-level fingerprint of a directory tree: names, sizes, mtimes and content hashes. */
export function fingerprintTree(root: string): string {
  const lines: string[] = [];
  const walk = (dir: string, rel: string) => {
    for (const entry of readdirSync(dir).sort()) {
      const full = join(dir, entry);
      const info = statSync(full);
      const path = rel === '' ? entry : `${rel}/${entry}`;
      if (info.isDirectory()) {
        lines.push(`d ${path}`);
        walk(full, path);
      } else {
        lines.push(`f ${path} ${info.size} ${info.mtimeMs} ${createHash('sha256').update(readFileSync(full)).digest('hex')}`);
      }
    }
  };
  walk(root, '');
  return createHash('sha256').update(lines.join('\n')).digest('hex');
}

export function writeExecutable(path: string, body: string): void {
  writeFileSync(path, body, { mode: 0o755 });
}
