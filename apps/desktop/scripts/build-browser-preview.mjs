import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmod, lstat, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build, version as viteVersion } from 'vite';
import ts from 'typescript';
import { browserPreviewConfig } from '../vite.browser-preview.config.ts';
import { CAPABILITIES, ENTRIES } from '../src/preview/capabilities.ts';
import { canonicalJSON, safeBundlePath, validateManifest } from '../src/preview/bundle.ts';

const repository = fileURLToPath(new URL('../../..', import.meta.url));
const git = (...args) => execFileSync('git', args, { cwd: repository, encoding: 'utf8' }).trim();
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const revision = git('rev-parse', 'HEAD');
if (git('status', '--porcelain', '--untracked-files=all')) throw new Error('Refusing to build from a dirty source tree.');
const args = process.argv.slice(2);

async function inventory(root, prefix = '') {
  const files = [];
  for (const name of await readdir(join(root, prefix))) {
    const path = prefix ? `${prefix}/${name}` : name;
    if (!safeBundlePath(path)) throw new Error(`Unsafe output path: ${path}`);
    const stat = await lstat(join(root, path));
    if (stat.isSymbolicLink()) throw new Error(`Symlink in output: ${path}`);
    if (stat.isDirectory()) files.push(...await inventory(root, path));
    else if (stat.isFile()) {
      const bytes = await readFile(join(root, path));
      files.push({ path, sha256: sha256(bytes), bytes: bytes.length });
    } else throw new Error(`Nonregular output: ${path}`);
  }
  return files.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
}

function sourceClosure() {
  return { name: 'browser-preview-source-closure', async generateBundle(_options, bundle) {
    // Rolldown exposes no plugin-context watch-file enumeration. Cover source-only
    // dependencies conservatively, including CSS imports and inlined assets.
    const supplementalSourceRoots = [
      'apps/desktop/src', 'apps/desktop/preview', 'apps/desktop/scripts',
      'modules/work', 'modules/social', 'modules/wiki/contract',
      'packages/contracts', 'packages/hq-ui',
    ];
    const inputs = new Set([
      'package.json', 'package-lock.json', 'tsconfig.json', 'apps/desktop/package.json',
      'apps/desktop/vite.browser-preview.config.ts', 'apps/desktop/scripts/build-browser-preview.mjs',
      'apps/desktop/preview/gallery-project.json', 'apps/desktop/src/preview/capabilities.ts',
      'apps/desktop/src/preview/bundle.ts',
    ]);
    const dependencies = new Set();
    const virtualModules = new Set();
    const modulePath = id => {
      if (id.startsWith('\0')) { virtualModules.add(id.replaceAll(repository, '<repository>')); return null; }
      const path = relative(repository, id.split('?')[0]).replaceAll('\\', '/');
      if (path.startsWith('../') || isAbsolute(path)) throw new Error('Preview input outside repository');
      if (path.startsWith('node_modules/')) { dependencies.add(path); return null; }
      inputs.add(path);
      return path;
    };
    const graph = [];
    for (const id of this.getModuleIds()) {
      const info = this.getModuleInfo(id);
      if (info.isExternal) throw new Error(`Unbundled preview dependency: ${id}`);
      const path = modulePath(id);
      if (path) graph.push({ path, imports: [...info.importedIds, ...info.dynamicallyImportedIds].map(modulePath).filter(Boolean).sort() });
    }
    for (const item of Object.values(bundle)) {
      if (item.type === 'asset') for (const id of item.originalFileNames) modulePath(isAbsolute(id) ? id : resolve(this.environment.config.root, id));
    }
    for (const path of git('ls-files', '-z', '--', ...supplementalSourceRoots).split('\0').filter(Boolean)) inputs.add(path);
    // Package exports and compiler options participate in resolution even when they emit no module.
    for (const path of [...inputs]) {
      let directory = dirname(join(repository, path));
      while (directory.startsWith(repository + '/') || directory === repository) {
        for (const name of ['package.json', 'tsconfig.json']) {
          const candidate = join(directory, name);
          try { if ((await lstat(candidate)).isFile()) inputs.add(relative(repository, candidate)); }
          catch (error) { if (error.code !== 'ENOENT') throw error; }
        }
        if (directory === repository) break;
        directory = dirname(directory);
      }
    }
    const files = [];
    const typeOnlyImports = [];
    for (const path of [...inputs].sort()) {
      const bytes = await readFile(join(repository, path));
      files.push({ path, sha256: sha256(bytes), bytes: bytes.length });
      if (!/\.[cm]?[jt]sx?$/.test(path)) continue;
      const source = ts.createSourceFile(path, bytes.toString('utf8'), ts.ScriptTarget.Latest, true);
      const record = (node, specifier) => typeOnlyImports.push({
        importer: path, specifier, line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1,
        classification: 'erased-type-only; not a browser module resolution or emitted input',
      });
      const visit = node => {
        if (ts.isImportDeclaration(node) && node.importClause) {
          const clause = node.importClause;
          const bindings = clause.namedBindings;
          if (clause.isTypeOnly || (!clause.name && bindings && ts.isNamedImports(bindings)
            && bindings.elements.length > 0 && bindings.elements.every(item => item.isTypeOnly))) record(node, node.moduleSpecifier.text);
        } else if (ts.isExportDeclaration(node) && node.moduleSpecifier && (node.isTypeOnly
          || (node.exportClause && ts.isNamedExports(node.exportClause) && node.exportClause.elements.length > 0
            && node.exportClause.elements.every(item => item.isTypeOnly)))) record(node, node.moduleSpecifier.text);
        else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) && ts.isStringLiteral(node.argument.literal)) record(node, node.argument.literal.text);
        ts.forEachChild(node, visit);
      };
      visit(source);
    }
    this.emitFile({ type: 'asset', fileName: 'source-closure.json', source: canonicalJSON({
      schema: 'hq-preview-source-closure/v1', revision,
      coverage: {
        moduleGraph: 'all resolved modules and their imports',
        assetProvenance: 'emitted asset originalFileNames',
        watchFiles: 'unavailable in the pinned Rolldown plugin API; not observed',
        supplementalSourceRoots,
        supplementalInputs: 'all tracked files under declared source roots; conservative superset, not runtime edges',
      },
      files, graph: graph.sort((a, b) => a.path.localeCompare(b.path)),
      lockedDependencyModules: [...dependencies].sort(), virtualModules: [...virtualModules].sort(), typeOnlyImports,
    }) + '\n' });
  } };
}

if (args.length === 1 && args[0] === '--verify-production') {
  let checkedModules = 0;
  const output = await build({
    configFile: join(repository, 'apps/desktop/vite.config.ts'),
    build: { write: false },
    plugins: [{ name: 'exclude-browser-preview', generateBundle(_options, bundle) {
      for (const item of Object.values(bundle)) {
        if (item.type === 'chunk') for (const id of Object.keys(item.modules)) {
          checkedModules += 1;
          if (id.replaceAll('\\', '/').includes('/src/preview/')) throw new Error(`Preview module in production: ${id}`);
        }
      }
    } }],
  });
  const generated = (Array.isArray(output) ? output : [output]).flatMap(result => result.output);
  const production = join(repository, 'apps/desktop/dist');
  const actual = await inventory(production);
  if (actual.length !== generated.length) throw new Error('Production output inventory differs from the verified build.');
  for (const item of generated) {
    const bytes = item.type === 'chunk' ? item.code : item.source;
    if (/jones-preview-session|jones-preview-bundle|data-preview-badge|__PREVIEW_REVISION__/.test(String(bytes))) throw new Error('Preview marker in production.');
    if (sha256(bytes) !== actual.find(file => file.path === item.fileName)?.sha256) throw new Error(`Production artifact differs: ${item.fileName}`);
  }
  console.log(JSON.stringify({ productionPreviewExcluded: true, revision, checkedModules, files: actual.length }));
} else {
  if (args.length !== 2 || args[0] !== '--out' || !isAbsolute(args[1])) throw new Error('Usage: node apps/desktop/scripts/build-browser-preview.mjs --out /absolute/new-bundle | --verify-production');
  const out = resolve(args[1]);
  const rel = relative(repository, out);
  if (!rel.startsWith('..' + '/') && rel !== '..') throw new Error('Bundle output must be outside the source repository.');
  await mkdir(dirname(out), { recursive: true });
  await mkdir(out); // Exclusive allocation: never overwrite or empty an existing output.
  let sealed = false;
  try {
    await build({ ...browserPreviewConfig(revision, out), configFile: false, plugins: [sourceClosure()] });
    if (git('rev-parse', 'HEAD') !== revision || git('status', '--porcelain', '--untracked-files=all')) throw new Error('Source changed during the build.');
    const manifest = {
      schema: 'jones-preview-bundle/v1', product: 'hq-desktop', target: 'browser',
      source: { repository: 'Jones-Systems/HQ', revision, dirty: false },
      build: { node: process.version, tool: `vite@${viteVersion}`,
        lockfileSha256: sha256(await readFile(join(repository, 'package-lock.json'))),
        configSha256: sha256(await readFile(join(repository, 'apps/desktop/vite.browser-preview.config.ts'))) },
      fixture: { id: 'hq-examples', version: 1 },
      environment: { storage: 'memory', polyfills: ['crypto.randomUUID:insecure-context'] },
      layout: { width: 1280, minWidth: 760 }, entries: ENTRIES, capabilities: CAPABILITIES,
      files: await inventory(out),
    };
    validateManifest(manifest);
    const canonical = canonicalJSON(manifest);
    await writeFile(join(out, 'preview-bundle.json'), canonical + '\n', { flag: 'wx' });
    sealed = true;
    for (const file of [...manifest.files, { path: 'preview-bundle.json' }]) await chmod(join(out, file.path), 0o444);
    const directories = new Set([out]);
    for (const file of manifest.files) {
      let parent = dirname(join(out, file.path));
      while (parent !== out) { directories.add(parent); parent = dirname(parent); }
    }
    for (const directory of [...directories].sort((a, b) => b.length - a.length)) await chmod(directory, 0o555);
    console.log(JSON.stringify({ bundle: out, revision, bundleSha256: sha256(canonical), files: manifest.files.length }));
  } finally {
    if (!sealed) await rm(out, { recursive: true, force: true });
  }
}
