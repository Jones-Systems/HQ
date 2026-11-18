// Builds the synthetic committed-Git corpus: the checked-in fixture text under ../fixtures/corpus becomes one bare
// repository per namespace with a single commit (fixed identity and dates, isolated Git config), plus a few non-page
// tree entries. The tests then read it only through the core's committed-object adapter. Synthetic content only.

import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { WikiNamespace } from '../../contract/src/index.ts';

export const CORPUS_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'corpus');
export const REMOTE = 'https://example.invalid/synthetic/wiki.git';
export const FIXED_EPOCH = 1767323045; // 2026-01-02T03:04:05Z
export const FIXED_ISO = '2026-01-02T03:04:05Z';
export const CLOCK_MS = Date.UTC(2026, 0, 3, 4, 5, 6, 250);

export interface TreeFile {
  readonly path: string;
  readonly content: Uint8Array;
  readonly mode: '100644' | '120000';
}

function env(): NodeJS.ProcessEnv {
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
  };
}

function git(args: readonly string[], input?: Uint8Array): string {
  return execFileSync('git', [...args], { env: env(), encoding: 'utf8', ...(input === undefined ? {} : { input }) }).trim();
}

/** Every regular file below `dir`, as `/`-separated paths relative to it, sorted. */
export function readFixtureTree(dir: string): TreeFile[] {
  const files: TreeFile[] = [];
  const walk = (current: string): void => {
    for (const entry of readdirSync(current).sort()) {
      const full = join(current, entry);
      if (statSync(full).isDirectory()) walk(full);
      else files.push({ path: relative(dir, full).split(sep).join('/'), content: readFileSync(full), mode: '100644' });
    }
  };
  walk(dir);
  return files;
}

interface Node {
  readonly files: Map<string, { mode: string; oid: string }>;
  readonly gitlinks: Map<string, string>;
  readonly dirs: Map<string, Node>;
}

const node = (): Node => ({ files: new Map(), gitlinks: new Map(), dirs: new Map() });

function writeTree(gitDir: string, tree: Node): string {
  const lines: string[] = [];
  for (const [name, entry] of tree.files) lines.push(`${entry.mode} blob ${entry.oid}\t${name}`);
  for (const [name, oid] of tree.gitlinks) lines.push(`160000 commit ${oid}\t${name}`);
  for (const [name, child] of tree.dirs) lines.push(`040000 tree ${writeTree(gitDir, child)}\t${name}`);
  return git([`--git-dir=${gitDir}`, 'mktree', '--missing'], Buffer.from(lines.join('\n') + '\n'));
}

export interface CommittedRepo {
  readonly gitDir: string;
  readonly commit: string;
}

/** One bare repository with a single commit on `main`. `gitlinks` are submodule-style entries with made-up ids. */
export function commitRepo(root: string, name: string, files: readonly TreeFile[], gitlinks: readonly string[] = []): CommittedRepo {
  const gitDir = join(root, `${name}.git`);
  mkdirSync(gitDir, { recursive: true });
  git(['init', '--bare', '--quiet', '--initial-branch=main', gitDir]);
  git([`--git-dir=${gitDir}`, 'config', 'remote.origin.url', REMOTE]);
  const top = node();
  const place = (path: string, apply: (target: Node, leaf: string) => void): void => {
    const segments = path.split('/');
    let current = top;
    for (const segment of segments.slice(0, -1)) {
      let child = current.dirs.get(segment);
      if (child === undefined) {
        child = node();
        current.dirs.set(segment, child);
      }
      current = child;
    }
    apply(current, segments[segments.length - 1] as string);
  };
  for (const file of files) {
    const oid = git([`--git-dir=${gitDir}`, 'hash-object', '-w', '--stdin'], file.content);
    place(file.path, (target, leaf) => target.files.set(leaf, { mode: file.mode, oid }));
  }
  for (const path of gitlinks) place(path, (target, leaf) => target.gitlinks.set(leaf, 'c'.repeat(40)));
  const tree = writeTree(gitDir, top);
  const commit = git([`--git-dir=${gitDir}`, 'commit-tree', tree, '-m', 'synthetic fixture'], undefined);
  git([`--git-dir=${gitDir}`, 'update-ref', 'refs/heads/main', commit]);
  return { gitDir, commit };
}

export interface SyntheticCorpus {
  readonly repos: Readonly<Record<WikiNamespace, CommittedRepo>>;
  /** Data-only source profiles, one per namespace, pointing at the committed repositories. */
  readonly profiles: readonly Record<string, unknown>[];
}

/** Both namespaces: `bl` at the repository root, `appdev` under `rootPrefix: notes`. */
export function buildCorpus(root: string): SyntheticCorpus {
  const blFiles = readFixtureTree(join(CORPUS_ROOT, 'bl'));
  // Non-page tree entries the adapter must skip: a symlink (never followed) and a submodule-style link.
  blFiles.push({ path: 'link-to-index.md', content: Buffer.from('index.md'), mode: '120000' });
  blFiles.push({ path: 'assets/diagram.bin', content: Buffer.from([0, 1, 2, 3]), mode: '100644' });
  const bl = commitRepo(root, 'bl', blFiles, ['vendor/submodule']);
  const appdev = commitRepo(root, 'appdev', readFixtureTree(join(CORPUS_ROOT, 'appdev')));
  const common = { expectedRemote: REMOTE, ref: 'main', pageExtensions: ['.md'], fieldMappings: { title: 'title', aliases: ['aliases'], topics: ['tags'], relationships: ['related'] } };
  return {
    repos: { bl, appdev },
    profiles: [
      { namespace: 'bl', gitDir: bl.gitDir, rootPrefix: '', topicMode: 'field', ...common },
      { namespace: 'appdev', gitDir: appdev.gitDir, rootPrefix: 'notes', topicMode: 'directory', ...common },
    ],
  };
}

/** Move `main` to a new commit with the same tree (a later commit for the host to discover). Returns the new commit id. */
export function advanceMain(gitDir: string, message: string): string {
  const parent = git([`--git-dir=${gitDir}`, 'rev-parse', 'refs/heads/main']);
  const tree = git([`--git-dir=${gitDir}`, 'rev-parse', `${parent}^{tree}`]);
  const commit = git([`--git-dir=${gitDir}`, 'commit-tree', tree, '-p', parent, '-m', message]);
  git([`--git-dir=${gitDir}`, 'update-ref', 'refs/heads/main', commit, parent]);
  return commit;
}

/** `git rev-parse` of `main`, as an independent check of what the host pinned. */
export function mainOf(gitDir: string): string {
  return git([`--git-dir=${gitDir}`, 'rev-parse', 'refs/heads/main']);
}
