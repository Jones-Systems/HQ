'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { PRODUCT, ELECTRON_VERSION } = require('./identity.cjs');

const REGISTRY_PATH = 'tools/updater/packaging/compatibility-registry.json';
const OMIT = new Set(['node_modules', 'dist', 'dist-electron', 'test', 'tests', 'fixtures', 'harness', 'demo', '.git']);
const SOURCE = /\.(?:[cm]?[jt]s|tsx)$/;
const PERSISTENCE = /\b(?:writeFile(?:Sync)?|createWriteStream|appendFile(?:Sync)?|localStorage|indexedDB|userData|sessionData)\b/;

function filesUnder(root, relative) {
  if (path.isAbsolute(relative) || relative.split('/').some(part => part === '..' || part === '')) throw new Error('Invalid registry path');
  const absolute = path.join(root, relative);
  const info = fs.lstatSync(absolute);
  if (info.isSymbolicLink()) throw new Error(`Registry source is a symlink: ${relative}`);
  if (info.isFile()) return [relative];
  if (!info.isDirectory()) throw new Error(`Invalid registry source: ${relative}`);
  return fs.readdirSync(absolute).sort().flatMap(name => OMIT.has(name) || /\.(?:test|spec)\./.test(name) ? [] : filesUnder(root, `${relative}/${name}`)).filter(name => SOURCE.test(name));
}

function sourceDigest(root, roots, anchors = {}) {
  const files = [...new Set(roots.flatMap(relative => filesUnder(root, relative)))].sort();
  if (!files.length) throw new Error('Empty compatibility source registration');
  const hash = createHash('sha256');
  for (const file of files) {
    let bytes = fs.readFileSync(path.join(root, file));
    if (anchors[file]) {
      const text = bytes.toString('utf8');
      const selected = anchors[file].map(pattern => {
        const matches = [...new Set(text.match(new RegExp(pattern, 'g')) ?? [])].sort();
        if (!matches.length) throw new Error(`Profile layout anchor is missing: ${file}`);
        return matches;
      });
      const persistenceEntries = text.match(/\b(?:writeFile(?:Sync)?|createWriteStream|appendFile(?:Sync)?|localStorage|indexedDB)\b|app\.setPath\([^\n;]+\)/g) ?? [];
      bytes = Buffer.from(JSON.stringify({ selected, persistenceEntries }));
    }
    hash.update(file).update('\0').update(createHash('sha256').update(bytes).digest('hex')).update('\n');
  }
  return { digest: hash.digest('hex'), files };
}

function epochFor(registry) {
  return `hq1-${createHash('sha256').update(JSON.stringify({ identity: registry.identity, profileLayouts: registry.profileLayouts, stores: registry.stores.map(({ id, roots, anchors, sha256 }) => ({ id, roots, anchors, sha256 })) })).digest('hex')}`;
}

function inspectRegistry(root, registry) {
  if (registry.schemaVersion !== 1 || !Array.isArray(registry.stores) || !Array.isArray(registry.nonProfileSources)) throw new Error('Invalid compatibility registry');
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  if (pkg.name !== PRODUCT.name || pkg.productName !== PRODUCT.productName || pkg.devDependencies?.electron !== ELECTRON_VERSION) throw new Error('Package identity or pinned Electron version changed');
  const identity = { packageName: PRODUCT.name, appName: PRODUCT.productName, bundleId: PRODUCT.bundleId, electronMajor: Number(ELECTRON_VERSION.split('.')[0]) };
  if (JSON.stringify(registry.identity) !== JSON.stringify(identity)) throw new Error('Compatibility identity changed without registry update');
  if (JSON.stringify(registry.profileLayouts) !== JSON.stringify({ userData: 'installation-record.userData/v1', sessionData: 'installation-record.sessionData/v1' })) throw new Error('Unrecognized profile layout');
  const required = ['profile-binding', 'wiki', 'sources-catalog', 'design-store-compare', 'jones-profiles-credentials', 'service-config', 'renderer-storage'];
  if (new Set(registry.stores.map(entry => entry.id)).size !== registry.stores.length || required.some(id => !registry.stores.some(entry => entry.id === id))) throw new Error('Missing compatibility store');
  const registered = new Set();
  const drift = [];
  for (const entry of [...registry.stores, ...registry.nonProfileSources]) {
    if (!entry.id || !Array.isArray(entry.roots) || !entry.roots.length || !/^[a-f0-9]{64}$/.test(entry.sha256)) throw new Error('Invalid source registration');
    if (registry.nonProfileSources.includes(entry) && !entry.reason) throw new Error('Non-profile source needs its ownership reason');
    const current = sourceDigest(root, entry.roots, entry.anchors);
    current.files.forEach(file => registered.add(file));
    if (current.digest !== entry.sha256) drift.push(entry.id);
  }
  // This conservative inventory catches new persistence entry points; review still owns indirect writers.
  const unregistered = ['apps', 'modules', 'packages'].flatMap(relative => filesUnder(root, relative)).filter(file => PERSISTENCE.test(fs.readFileSync(path.join(root, file), 'utf8')) && !registered.has(file));
  if (unregistered.length) throw new Error(`Register new profile writers or explain non-profile ownership: ${unregistered.join(', ')}`);
  if (drift.length) throw new Error(`Compatibility source drift; review and refresh the registry (epoch changes): ${drift.join(', ')}`);
  return { compatibilityEpoch: epochFor(registry), registeredSources: registered.size };
}

function readRegistry(root) { return JSON.parse(fs.readFileSync(path.join(root, REGISTRY_PATH), 'utf8')); }

if (require.main === module) {
  const root = path.resolve(__dirname, '../../..');
  const registry = readRegistry(root);
  if (process.argv.length === 3 && process.argv[2] === '--refresh-reviewed-registry') {
    for (const entry of [...registry.stores, ...registry.nonProfileSources]) entry.sha256 = sourceDigest(root, entry.roots, entry.anchors).digest;
    inspectRegistry(root, registry);
    fs.writeFileSync(path.join(root, REGISTRY_PATH), `${JSON.stringify(registry, null, 2)}\n`);
  } else if (process.argv.length !== 2) throw new Error('Use no arguments, or --refresh-reviewed-registry after reviewing every source change');
  process.stdout.write(`${JSON.stringify(inspectRegistry(root, registry))}\n`);
}

module.exports = { REGISTRY_PATH, sourceDigest, epochFor, inspectRegistry, readRegistry, filesUnder };
