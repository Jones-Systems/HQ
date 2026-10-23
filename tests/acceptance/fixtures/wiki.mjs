import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export const SYNTHETIC_REMOTE = 'https://example.invalid/synthetic/wiki.git';
export async function createWikiCorpus(runtime, repo, profile) {
  const root = join(runtime.root, 'wiki-corpus');
  await mkdir(root);
  const env = { PATH: process.env.PATH, HOME: root, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_TERMINAL_PROMPT: '0', GIT_AUTHOR_NAME: 'Synthetic Author', GIT_AUTHOR_EMAIL: 'author@example.invalid',
    GIT_COMMITTER_NAME: 'Synthetic Committer', GIT_COMMITTER_EMAIL: 'committer@example.invalid',
    GIT_AUTHOR_DATE: '1767323045 +0000', GIT_COMMITTER_DATE: '1767323045 +0000' };
  const git = async (args, input) => {
    const child = runtime.spawn('git', args, { cwd: root, env, stdio: ['pipe', 'pipe', 'pipe'] });
    let output = '', diagnostic = '';
    child.stdout.on('data', chunk => { output = (output + chunk).slice(-65536); });
    child.stderr.on('data', chunk => { diagnostic = (diagnostic + chunk).slice(-4096); });
    child.stdin.on('error', () => {});
    child.stdin.end(input);
    await child.done;
    await runtime.stop(child);
    if (child.launchError || child.exitCode !== 0) throw new Error(`Synthetic Git failed: ${diagnostic}`, { cause: child.launchError });
    return output.trim();
  };
  const sources = [], commits = {};
  for (const namespace of ['bl', 'appdev']) {
    const gitDir = join(root, `${namespace}.git`);
    await git(['init', '--bare', '--quiet', '--initial-branch=main', gitDir]);
    // Inert provenance metadata required by the landed reader; never contacted.
    await git([`--git-dir=${gitDir}`, 'config', 'remote.origin.url', SYNTHETIC_REMOTE]);
    async function tree(directory) {
      const entries = [];
      for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
        if (entry.isDirectory()) entries.push(`040000 tree ${await tree(join(directory, entry.name))}\t${entry.name}`);
        else if (entry.isFile()) entries.push(`100644 blob ${await git([`--git-dir=${gitDir}`, 'hash-object', '-w', '--stdin'], await readFile(join(directory, entry.name)))}\t${entry.name}`);
        else throw new Error('Synthetic source contains unsupported file type');
      }
      return git([`--git-dir=${gitDir}`, 'mktree'], entries.join('\n') + '\n');
    }
    const treeId = await tree(join(repo, 'modules/wiki/app/fixtures/corpus', namespace));
    const commit = await git([`--git-dir=${gitDir}`, 'commit-tree', treeId, '-m', 'synthetic acceptance corpus']);
    await git([`--git-dir=${gitDir}`, 'update-ref', 'refs/heads/main', commit]);
    commits[namespace] = commit;
    sources.push({ namespace, gitDir, expectedRemote: SYNTHETIC_REMOTE, ref: 'main',
      rootPrefix: namespace === 'bl' ? '' : 'notes', topicMode: namespace === 'bl' ? 'field' : 'directory',
      pageExtensions: ['.md'], fieldMappings: { title: 'title', aliases: ['aliases'], topics: ['tags'], relationships: ['related'] } });
  }
  await mkdir(join(profile, 'wiki'), { recursive: true });
  await writeFile(join(profile, 'wiki/config.json'), JSON.stringify({ version: 1, sources }));
  return { commits, sources };
}
