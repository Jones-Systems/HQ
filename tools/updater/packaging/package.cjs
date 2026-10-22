'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { PRODUCT, SYNTHETIC, WORKFLOW, REPOSITORY, ELECTRON_VERSION, LIMITS, buildReceipt, positiveInteger } = require('./identity.cjs');
const { inspectRegistry, readRegistry } = require('./compatibility.cjs');

function command(executable, args, options = {}) { return execFileSync(executable, args, { encoding: 'utf8', maxBuffer: 4 * 1024 ** 2, ...options }); }
function json(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
function writeJson(file, value) { fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx', mode: 0o644 }); }
function contained(parent, child) { const relative = path.relative(parent, child); return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative)); }

function copySource(source, destination, boundary = source, parents = new Set()) {
  const info = fs.lstatSync(source);
  const real = fs.realpathSync(source);
  if (!contained(fs.realpathSync(boundary), real) || parents.has(real)) throw new Error(`Source link escapes or cycles: ${source}`);
  if (info.isSymbolicLink()) return copySource(real, destination, boundary, parents);
  if (info.isDirectory()) {
    fs.mkdirSync(destination, { recursive: true });
    const next = new Set([...parents, real]);
    for (const name of fs.readdirSync(source).sort()) if (!['node_modules', '.git', '.DS_Store'].includes(name)) copySource(path.join(source, name), path.join(destination, name), boundary, next);
  } else if (info.isFile()) {
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(source, destination, fs.constants.COPYFILE_EXCL);
    fs.chmodSync(destination, info.mode & 0o777);
  } else throw new Error(`Unsupported package file: ${source}`);
}

function resolveDependency(root, from, name) {
  if (!/^(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+$/i.test(name)) throw new Error('Invalid runtime dependency name');
  for (let directory = from; contained(root, directory); directory = path.dirname(directory)) {
    const candidate = path.join(directory, 'node_modules', name);
    if (fs.existsSync(path.join(candidate, 'package.json'))) {
      const real = fs.realpathSync(candidate);
      if (!contained(root, real)) throw new Error(`Runtime dependency escapes source root: ${name}`);
      return real;
    }
    if (directory === root) break;
  }
  throw new Error(`Missing installed runtime dependency: ${name}`);
}

function copyRuntimeDependencies(root, appRoot) {
  const roots = [root, path.join(root, 'apps/desktop')];
  const inventory = [];
  const copy = (name, from, destinationParent, visible) => {
    const source = resolveDependency(root, from, name);
    if (visible.get(name) === source) return;
    const destination = path.join(destinationParent, 'node_modules', name);
    const pkg = json(path.join(source, 'package.json'));
    if (pkg.name !== name || typeof pkg.version !== 'string') throw new Error(`Invalid installed dependency: ${name}`);
    if (fs.existsSync(destination)) {
      if (json(path.join(destination, 'package.json')).version !== pkg.version) throw new Error(`Conflicting runtime dependency: ${name}`);
      return;
    }
    copySource(source, destination);
    inventory.push({ name, version: pkg.version, path: path.relative(appRoot, destination).split(path.sep).join('/') });
    const next = new Map(visible).set(name, source);
    const dependencies = { ...pkg.dependencies, ...pkg.optionalDependencies, ...pkg.peerDependencies };
    for (const dependency of Object.keys(dependencies).sort()) {
      if ((pkg.optionalDependencies?.[dependency] || pkg.peerDependenciesMeta?.[dependency]?.optional) && !dependencyAvailable(root, source, dependency)) continue;
      copy(dependency, source, destination, next);
    }
  };
  for (const from of roots) for (const name of Object.keys(json(path.join(from, 'package.json')).dependencies ?? {}).sort()) copy(name, from, appRoot, new Map());
  return inventory;
}

function dependencyAvailable(root, from, name) { try { resolveDependency(root, from, name); return true; } catch { return false; } }

function populateApplication(root, appRoot, receipt) {
  const identity = receipt.bundleId === SYNTHETIC.bundleId ? SYNTHETIC : PRODUCT;
  const required = ['apps/desktop/dist/index.html', 'apps/desktop/dist-electron/main.js', 'apps/desktop/dist-electron/preload.cjs', 'apps/desktop/dist-electron/design-host/modules/design/app/storage/node.js', 'apps/desktop/dist-electron/wiki-host/apps/desktop/electron/wiki-runtime.mjs', 'tools/updater/bootstrap.cjs', 'tools/updater/process-inventory'];
  for (const relative of required) if (!fs.statSync(path.join(root, relative)).isFile()) throw new Error(`Missing compiled package input: ${relative}`);
  const inventory = fs.lstatSync(path.join(root, 'tools/updater/process-inventory'));
  if (!inventory.isFile() || !(inventory.mode & 0o100)) throw new Error('Compiled native process inventory must be a regular executable');
  fs.mkdirSync(appRoot, { recursive: false });
  copySource(path.join(root, 'apps/desktop/dist'), path.join(appRoot, 'apps/desktop/dist'));
  copySource(path.join(root, 'apps/desktop/dist-electron'), path.join(appRoot, 'apps/desktop/dist-electron'));
  fs.mkdirSync(path.join(appRoot, 'tools/updater'), { recursive: true });
  for (const entry of fs.readdirSync(path.join(root, 'tools/updater'), { withFileTypes: true })) {
    if (entry.name === 'packaging' || entry.name === 'test' || entry.name === 'tests' || /\.(test|spec)\./.test(entry.name)) continue;
    copySource(path.join(root, 'tools/updater', entry.name), path.join(appRoot, 'tools/updater', entry.name));
  }
  fs.copyFileSync(path.join(__dirname, 'local-bootstrap.cjs'), path.join(appRoot, 'local-bootstrap.cjs'), fs.constants.COPYFILE_EXCL);
  const runtimeDependencies = copyRuntimeDependencies(root, appRoot);
  writeJson(path.join(appRoot, 'package.json'), { name: identity.name, productName: identity.productName, version: receipt.version, private: true, type: 'module', main: 'local-bootstrap.cjs', dependencies: json(path.join(root, 'package.json')).dependencies ?? {} });
  writeJson(path.join(appRoot, 'build-receipt.json'), receipt);
  writeJson(path.join(appRoot, 'runtime-dependencies.json'), runtimeDependencies);
  return runtimeDependencies;
}

function plistSet(file, key, value, run = command) { run('/usr/bin/plutil', ['-replace', key, typeof value === 'number' ? '-integer' : '-string', String(value), file]); }

function stampBundle(bundle, receipt, run = command) {
  const identity = receipt.bundleId === SYNTHETIC.bundleId ? SYNTHETIC : PRODUCT;
  const plist = path.join(bundle, 'Contents/Info.plist');
  const oldExecutable = run('/usr/bin/plutil', ['-extract', 'CFBundleExecutable', 'raw', '-o', '-', plist]).trim();
  if (!['Electron', PRODUCT.productName, SYNTHETIC.productName].includes(oldExecutable)) throw new Error('Unexpected Electron executable');
  if (oldExecutable !== identity.productName) fs.renameSync(path.join(bundle, 'Contents/MacOS', oldExecutable), path.join(bundle, 'Contents/MacOS', identity.productName));
  const values = { CFBundleName: identity.productName, CFBundleDisplayName: identity.productName, CFBundleExecutable: identity.productName, CFBundleIdentifier: identity.bundleId, CFBundleShortVersionString: receipt.version.split('-')[0], CFBundleVersion: String(receipt.buildSequence), HQSourceCommit: receipt.sourceSha, HQSourceTree: receipt.sourceTree, HQVersion: receipt.version, HQBuildSequence: receipt.buildSequence, HQChannel: receipt.channel, HQCompatibilityEpoch: receipt.compatibilityEpoch, HQElectronVersion: receipt.electronVersion, HQArchitecture: receipt.architecture };
  for (const [key, value] of Object.entries(values)) plistSet(plist, key, value, run);
  const frameworks = path.join(bundle, 'Contents/Frameworks');
  for (const name of fs.readdirSync(frameworks).filter(name => /^(?:Electron|HQ|HQ Updater Test) Helper(?: \([A-Za-z]+\))?\.app$/.test(name))) {
    const helper = path.join(frameworks, name);
    const helperPlist = path.join(helper, 'Contents/Info.plist');
    const oldName = run('/usr/bin/plutil', ['-extract', 'CFBundleExecutable', 'raw', '-o', '-', helperPlist]).trim();
    const suffix = / Helper(.*)\.app$/.exec(name)[1];
    const nextName = `${identity.productName} Helper${suffix}`;
    if (oldName !== nextName) fs.renameSync(path.join(helper, 'Contents/MacOS', oldName), path.join(helper, 'Contents/MacOS', nextName));
    for (const [key, value] of Object.entries({ CFBundleName: nextName, CFBundleDisplayName: nextName, CFBundleExecutable: nextName, CFBundleIdentifier: `${identity.bundleId}.helper${suffix.replace(/[^a-z]/gi, '').toLowerCase()}` })) plistSet(helperPlist, key, value, run);
    if (name !== `${nextName}.app`) fs.renameSync(helper, path.join(frameworks, `${nextName}.app`));
  }
}

function signAndVerify(bundle, architecture, run = command) {
  const plist = path.join(bundle, 'Contents/Info.plist');
  const executable = run('/usr/bin/plutil', ['-extract', 'CFBundleExecutable', 'raw', '-o', '-', plist]).trim();
  const arches = run('/usr/bin/lipo', ['-archs', path.join(bundle, 'Contents/MacOS', executable)]).trim();
  if (arches !== (architecture === 'x64' ? 'x86_64' : architecture)) throw new Error('Electron architecture mismatch');
  const inventory = path.join(bundle, 'Contents/Resources/app/tools/updater/process-inventory');
  if (run('/usr/bin/lipo', ['-archs', inventory]).trim() !== (architecture === 'x64' ? 'x86_64' : architecture)) throw new Error('Native process inventory architecture mismatch');
  run('/usr/bin/codesign', ['--force', '--sign', '-', '--timestamp=none', inventory]);
  run('/usr/bin/codesign', ['--verify', '--strict', '--verbose=2', inventory]);
  run('/usr/bin/codesign', ['--force', '--deep', '--sign', '-', '--timestamp=none', '--preserve-metadata=entitlements', bundle]);
  run('/usr/bin/codesign', ['--verify', '--deep', '--strict', '--verbose=2', bundle]);
  const result = require('node:child_process').spawnSync('/usr/bin/codesign', ['--display', '--verbose=4', bundle], { encoding: 'utf8' });
  if (result.error || result.status !== 0) throw new Error('Cannot read strict code signature');
  if (!/^Signature=adhoc$/m.test(result.stderr)) throw new Error('Expected ad-hoc code signature');
}

function archiveMetrics(archive) {
  const bytes = fs.readFileSync(archive);
  if (bytes.length > LIMITS.archive || bytes.length < 22) throw new Error('Archive size is outside limits');
  let end = -1;
  for (let index = bytes.length - 22; index >= Math.max(0, bytes.length - 65557); index--) if (bytes.readUInt32LE(index) === 0x06054b50 && index + 22 + bytes.readUInt16LE(index + 20) === bytes.length) { end = index; break; }
  if (end < 0 || bytes.readUInt16LE(end + 4) !== 0 || bytes.readUInt16LE(end + 6) !== 0) throw new Error('Unsupported ZIP archive');
  const count = bytes.readUInt16LE(end + 10), offset = bytes.readUInt32LE(end + 16), length = bytes.readUInt32LE(end + 12);
  if (!count || count === 65535 || count > LIMITS.entries || offset + length !== end || bytes.readUInt16LE(end + 8) !== count) throw new Error('Unsupported ZIP directory');
  let at = offset, expandedSize = 0;
  for (let index = 0; index < count; index++) {
    if (at + 46 > end || bytes.readUInt32LE(at) !== 0x02014b50) throw new Error('Invalid ZIP directory entry');
    const nameLength = bytes.readUInt16LE(at + 28), extraLength = bytes.readUInt16LE(at + 30), commentLength = bytes.readUInt16LE(at + 32);
    const name = bytes.subarray(at + 46, at + 46 + nameLength).toString('utf8');
    if (!(name === 'HQ.app/' || name.startsWith('HQ.app/')) || name.split('/').includes('..') || name.includes('\\')) throw new Error('Unexpected archive root');
    if (bytes.readUInt16LE(at + 8) & 1 || ![0, 8].includes(bytes.readUInt16LE(at + 10)) || bytes.readUInt32LE(at + 24) === 0xffffffff) throw new Error('Unsupported ZIP entry');
    expandedSize += bytes.readUInt32LE(at + 24);
    at += 46 + nameLength + extraLength + commentLength;
  }
  if (at !== end || expandedSize > LIMITS.expanded) throw new Error('Archive expansion is outside limits');
  return { size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), expandedSize, fileCount: count };
}

function manifestFor(receipt, archive, metadata) {
  if (!/^hq-desktop-[A-Za-z0-9._-]+$/.test(metadata.releaseTag) || metadata.event !== 'push') throw new Error('Invalid release event');
  if (String(receipt.buildSequence) !== metadata.runId) throw new Error('Build sequence must equal the workflow run ID');
  if (!Number.isFinite(Date.parse(metadata.publishedAt))) throw new Error('Invalid manifest metadata');
  return { ...receipt, repository: REPOSITORY, platform: 'darwin', releaseTag: metadata.releaseTag, workflow: WORKFLOW, runId: metadata.runId, runAttempt: positiveInteger(metadata.runAttempt, 'run attempt'), event: 'push', publishedAt: metadata.publishedAt, signing: 'adhoc', archive: { name: `hq-darwin-${receipt.architecture}.zip`, ...archive }, attestation: `hq-darwin-${receipt.architecture}.sigstore.json` };
}

function packageApplication({ root, output, sourceSha, architecture, buildSequence, channel = 'preview', releaseTag, runAttempt = 1, publishedAt = new Date().toISOString() }) {
  if (process.platform !== 'darwin' || process.arch !== architecture) throw new Error('Native matching macOS runner required');
  root = fs.realpathSync(root); output = path.resolve(output);
  if (fs.existsSync(output)) throw new Error('Package output must be absent');
  const actualSha = command('git', ['rev-parse', 'HEAD'], { cwd: root }).trim();
  if (sourceSha !== actualSha || command('git', ['status', '--porcelain', '--untracked-files=no'], { cwd: root }).trim()) throw new Error('Package source must be the exact clean tracked commit');
  const sourceTree = command('git', ['rev-parse', 'HEAD^{tree}'], { cwd: root }).trim();
  const { compatibilityEpoch } = inspectRegistry(root, readRegistry(root));
  const receipt = buildReceipt({ sourceSha, sourceTree, version: json(path.join(root, 'package.json')).version, buildSequence, channel, compatibilityEpoch, architecture });
  const electronRoot = path.join(root, 'node_modules/electron');
  if (json(path.join(electronRoot, 'package.json')).version !== ELECTRON_VERSION) throw new Error('Unexpected installed Electron version');
  fs.mkdirSync(output, { recursive: true });
  const bundle = path.join(output, 'HQ.app');
  const cleanup = () => fs.rmSync(output, { recursive: true, force: true });
  const interrupt = () => { cleanup(); process.exit(130); }, terminate = () => { cleanup(); process.exit(143); };
  process.once('SIGINT', interrupt); process.once('SIGTERM', terminate);
  try {
    writeJson(path.join(output, '.hq-package-owner.json'), { sourceSha, buildSequence, architecture, output });
    command('/usr/bin/ditto', ['--norsrc', path.join(electronRoot, 'dist/Electron.app'), bundle]);
    const defaultApp = path.join(bundle, 'Contents/Resources/default_app.asar');
    if (fs.existsSync(defaultApp)) fs.unlinkSync(defaultApp);
    populateApplication(root, path.join(bundle, 'Contents/Resources/app'), receipt);
    for (const name of ['INSTALL.txt', 'install-hq.command']) {
      fs.copyFileSync(path.join(__dirname, name), path.join(output, name), fs.constants.COPYFILE_EXCL);
      fs.copyFileSync(path.join(__dirname, name), path.join(bundle, 'Contents/Resources', name), fs.constants.COPYFILE_EXCL);
    }
    fs.chmodSync(path.join(output, 'install-hq.command'), 0o755);
    fs.chmodSync(path.join(bundle, 'Contents/Resources/install-hq.command'), 0o755);
    stampBundle(bundle, receipt);
    signAndVerify(bundle, architecture);
    const archive = path.join(output, `hq-darwin-${architecture}.zip`);
    command('/usr/bin/zip', ['-qry', archive, 'HQ.app'], { cwd: output });
    const metrics = archiveMetrics(archive);
    writeJson(path.join(output, 'package-evidence.json'), { receipt, archive: metrics, verification: 'codesign --verify --deep --strict', signing: 'adhoc' });
    if (releaseTag) writeJson(path.join(output, `hq-darwin-${architecture}.json`), manifestFor(receipt, metrics, { releaseTag, runId: String(buildSequence), runAttempt, event: 'push', publishedAt }));
    return { bundle, archive, receipt, metrics };
  } catch (error) {
    try { cleanup(); } catch (cleanupError) { process.stderr.write(`Package cleanup failed after original error: ${cleanupError.message}\n`); }
    throw error;
  } finally { process.removeListener('SIGINT', interrupt); process.removeListener('SIGTERM', terminate); }
}

if (require.main === module) {
  const root = path.resolve(__dirname, '../../..');
  if (!process.env.HQ_PACKAGE_OUTPUT) throw new Error('HQ_PACKAGE_OUTPUT must name a new task-owned directory');
  const result = packageApplication({ root, output: process.env.HQ_PACKAGE_OUTPUT, sourceSha: process.env.GITHUB_SHA, architecture: process.env.HQ_PACKAGE_ARCH, buildSequence: Number(process.env.GITHUB_RUN_ID), channel: 'preview', releaseTag: process.env.HQ_RELEASE_TAG || undefined, runAttempt: Number(process.env.GITHUB_RUN_ATTEMPT || 1) });
  process.stdout.write(`${JSON.stringify({ receipt: result.receipt, archive: result.metrics })}\n`);
}

module.exports = { copySource, copyRuntimeDependencies, populateApplication, stampBundle, signAndVerify, archiveMetrics, manifestFor, packageApplication, command, contained };
