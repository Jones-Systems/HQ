'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { sourceDigest, epochFor, inspectRegistry } = require('../compatibility.cjs');
const { withOwnedDirectory } = require('../owned-directory.cjs');
const { ELECTRON_VERSION } = require('../identity.cjs');

const scratch = path.resolve(__dirname, '../.scratch');
function setup(root) {
  fs.mkdirSync(path.join(root, 'apps'), { recursive: true }); fs.mkdirSync(path.join(root, 'modules')); fs.mkdirSync(path.join(root, 'packages'));
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'hq', productName: 'HQ', devDependencies: { electron: ELECTRON_VERSION } }));
  const stores = ['profile-binding', 'wiki', 'sources-catalog', 'design-store-compare', 'jones-profiles-credentials', 'service-config', 'renderer-storage'].map(id => {
    const file = `apps/${id}.ts`;
    fs.writeFileSync(path.join(root, file), `export const schema = '${id}/v1';`);
    return { id, roots: [file], sha256: sourceDigest(root, [file]).digest };
  });
  return { schemaVersion: 1, identity: { packageName: 'hq', appName: 'HQ', bundleId: 'org.jones-systems.hq.local', electronMajor: 44 }, profileLayouts: { userData: 'installation-record.userData/v1', sessionData: 'installation-record.sessionData/v1' }, stores, nonProfileSources: [] };
}

test('persisted source drift fails until reviewed registry changes also change the epoch', async () => {
  await withOwnedDirectory(scratch, 'epoch-', async root => {
    const registry = setup(root);
    const before = inspectRegistry(root, registry).compatibilityEpoch;
    fs.appendFileSync(path.join(root, 'apps/wiki.ts'), '\nexport const configSchema = 2;');
    assert.throws(() => inspectRegistry(root, registry), /Compatibility source drift.*wiki/);
    registry.stores.find(entry => entry.id === 'wiki').sha256 = sourceDigest(root, ['apps/wiki.ts']).digest;
    const after = inspectRegistry(root, registry).compatibilityEpoch;
    assert.notEqual(after, before);
    assert.equal(after, epochFor(registry));
  });
});

test('new profile writer must register and metadata mismatch cannot silently reuse an epoch', async () => {
  await withOwnedDirectory(scratch, 'writers-', async root => {
    const registry = setup(root);
    fs.writeFileSync(path.join(root, 'apps/new-store.ts'), 'writeFile(userData, value);');
    assert.throws(() => inspectRegistry(root, registry), /Register new profile writers.*new-store/);
    registry.stores[1].roots.push('apps/new-store.ts');
    registry.stores[1].sha256 = sourceDigest(root, registry.stores[1].roots).digest;
    inspectRegistry(root, registry);
    registry.identity.electronMajor = 45;
    assert.throws(() => inspectRegistry(root, registry), /identity changed/);
  });
});

test('profile binding anchors ignore lifecycle-only edits but detect a changed path binding', async () => {
  await withOwnedDirectory(scratch, 'anchors-', async root => {
    const file = 'bootstrap.cjs';
    fs.writeFileSync(path.join(root, file), "app.setPath('userData', record.userData);\nstart();\n");
    const anchors = { [file]: ["app\\.setPath\\('userData', record\\.userData\\)"] };
    const before = sourceDigest(root, [file], anchors).digest;
    fs.appendFileSync(path.join(root, file), 'newLifecycleOperation();\n');
    assert.equal(sourceDigest(root, [file], anchors).digest, before);
    fs.writeFileSync(path.join(root, file), "app.setPath('userData', otherPath);\n");
    assert.throws(() => sourceDigest(root, [file], anchors), /anchor is missing/);
  });
});
