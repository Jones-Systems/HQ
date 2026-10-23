'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { EventEmitter } = require('node:events');
const { PRODUCT, SYNTHETIC, REPOSITORY, WORKFLOW, buildReceipt } = require('../identity.cjs');
const { populateApplication, copyRuntimeDependencies, archiveMetrics, manifestFor } = require('../package.cjs');
const { assertReleaseContext } = require('../release-guard.cjs');
const { withOwnedDirectory } = require('../owned-directory.cjs');

const scratch = path.resolve(__dirname, '../.scratch');
const receipt = overrides => buildReceipt({ sourceSha: 'a'.repeat(40), sourceTree: 'b'.repeat(40), version: '0.1.0', buildSequence: 17, channel: 'preview', compatibilityEpoch: `hq1-${'c'.repeat(64)}`, architecture: 'arm64', ...overrides });
const put = (root, name, value) => { const file = path.join(root, name); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, typeof value === 'string' ? value : JSON.stringify(value)); };
const load = (root, name) => JSON.parse(fs.readFileSync(path.join(root, name), 'utf8'));

test('packaged layout carries exact receipt, nested hosts, bootstrap and transitive runtime dependencies', async () => {
  await withOwnedDirectory(scratch, 'layout-', async root => {
    const source = path.join(root, 'source'), target = path.join(root, 'app');
    put(source, 'package.json', { name: 'hq', productName: 'HQ', version: '0.1.0', dependencies: { verifier: '1.2.3' } });
    put(source, 'apps/desktop/package.json', { dependencies: { '@hq/contracts': '0.1.0' } });
    for (const name of ['apps/desktop/dist/index.html', 'apps/desktop/dist-electron/main.js', 'apps/desktop/dist-electron/preload.cjs', 'apps/desktop/dist-electron/design-host/modules/design/app/storage/node.js', 'apps/desktop/dist-electron/wiki-host/apps/desktop/electron/wiki-runtime.mjs', 'tools/updater/bootstrap.cjs']) put(source, name, name);
    put(source, 'tools/updater/process-inventory', 'injected native executable fixture; never run');
    fs.chmodSync(path.join(source, 'tools/updater/process-inventory'), 0o755);
    put(source, 'tools/updater/contract.cjs', 'module.exports = {};');
    put(source, 'tools/updater/test/secret-fixture.test.cjs', 'not shipped');
    put(source, 'tools/updater/packaging/not-runtime.cjs', 'not shipped');
    put(source, 'node_modules/verifier/package.json', { name: 'verifier', version: '1.2.3', dependencies: { transport: '2.0.0' } });
    put(source, 'node_modules/verifier/index.js', 'require("transport")');
    put(source, 'node_modules/transport/package.json', { name: 'transport', version: '2.0.0' });
    put(source, 'node_modules/transport/index.js', 'module.exports = 2;');
    put(source, 'packages/contracts/package.json', { name: '@hq/contracts', version: '0.1.0' });
    fs.mkdirSync(path.join(source, 'node_modules/@hq'), { recursive: true });
    fs.symlinkSync('../../packages/contracts', path.join(source, 'node_modules/@hq/contracts'));
    const built = receipt();
    populateApplication(source, target, built);
    assert.deepEqual(load(target, 'build-receipt.json'), built);
    assert.equal(load(target, 'package.json').name, PRODUCT.name);
    assert.equal(load(target, 'package.json').productName, PRODUCT.productName);
    assert.equal(load(target, 'package.json').main, 'local-bootstrap.cjs');
    assert.match(fs.readFileSync(path.join(target, 'local-bootstrap.cjs'), 'utf8'), /import\('\.\/apps\/desktop\/dist-electron\/main\.js'\)/);
    assert.equal(load(target, 'node_modules/verifier/node_modules/transport/package.json').version, '2.0.0');
    assert.equal(fs.lstatSync(path.join(target, 'node_modules/@hq/contracts')).isDirectory(), true);
    assert.equal(fs.existsSync(path.join(target, 'tools/updater/test')), false);
    assert.equal(fs.existsSync(path.join(target, 'tools/updater/packaging')), false);
    assert.equal(fs.readFileSync(path.join(target, 'tools/updater/process-inventory'), 'utf8'), 'injected native executable fixture; never run');
    assert.equal(fs.statSync(path.join(target, 'tools/updater/process-inventory')).mode & 0o111, 0o111);
    assert.equal(fs.existsSync(path.join(target, 'apps/desktop/dist-electron/wiki-host/apps/desktop/electron/wiki-runtime.mjs')), true);
    assert.equal(fs.existsSync(path.join(target, 'apps/desktop/dist-electron/design-host/modules/design/app/storage/node.js')), true);
  });
});

test('packaging refuses a missing or non-executable native process inventory before creating output', async () => {
  await withOwnedDirectory(scratch, 'native-input-', async root => {
    const source = path.join(root, 'source');
    put(source, 'package.json', { name: 'hq', version: '0.1.0' });
    put(source, 'apps/desktop/package.json', {});
    for (const name of ['apps/desktop/dist/index.html', 'apps/desktop/dist-electron/main.js', 'apps/desktop/dist-electron/preload.cjs', 'apps/desktop/dist-electron/design-host/modules/design/app/storage/node.js', 'apps/desktop/dist-electron/wiki-host/apps/desktop/electron/wiki-runtime.mjs', 'tools/updater/bootstrap.cjs']) put(source, name, name);
    const absentTarget = path.join(root, 'absent-helper');
    assert.throws(() => populateApplication(source, absentTarget, receipt()), /process-inventory|native process inventory/);
    assert.equal(fs.existsSync(absentTarget), false);
    put(source, 'tools/updater/process-inventory', 'not executable');
    fs.chmodSync(path.join(source, 'tools/updater/process-inventory'), 0o644);
    const disabledTarget = path.join(root, 'disabled-helper');
    assert.throws(() => populateApplication(source, disabledTarget, receipt()), /native process inventory/);
    assert.equal(fs.existsSync(disabledTarget), false);
  });
});

test('runtime dependency tree preserves conflicting nested versions and rejects a missing required package', async () => {
  await withOwnedDirectory(scratch, 'dependencies-', async root => {
    const source = path.join(root, 'source'), app = path.join(root, 'app');
    put(source, 'package.json', { dependencies: { first: '1', second: '1' } });
    put(source, 'apps/desktop/package.json', {});
    for (const [name, version] of [['first', '1'], ['second', '1']]) put(source, `node_modules/${name}/package.json`, { name, version, dependencies: { shared: '*' } });
    put(source, 'node_modules/first/node_modules/shared/package.json', { name: 'shared', version: '1' });
    put(source, 'node_modules/shared/package.json', { name: 'shared', version: '2' });
    copyRuntimeDependencies(source, app);
    assert.equal(load(app, 'node_modules/first/node_modules/shared/package.json').version, '1');
    assert.equal(load(app, 'node_modules/second/node_modules/shared/package.json').version, '2');
    put(source, 'package.json', { dependencies: { absent: '1' } });
    assert.throws(() => copyRuntimeDependencies(source, path.join(root, 'missing')), /Missing installed runtime dependency/);
  });
});

test('build identity cannot silently become a synthetic or renamed production app', () => {
  const production = receipt();
  assert.equal(production.appName, 'HQ');
  assert.equal(production.bundleId, PRODUCT.bundleId);
  assert.equal(receipt({ synthetic: true }).bundleId, SYNTHETIC.bundleId);
  assert.throws(() => receipt({ buildSequence: 0 }), /build sequence/);
  assert.throws(() => receipt({ architecture: 'universal' }), /target/);
  assert.throws(() => receipt({ sourceSha: 'not-a-commit' }), /source identity/);
});

function tinyZip(entries) {
  let offset = 0;
  const locals = [], central = [];
  for (const [name, content] of entries) {
    const filename = Buffer.from(name), bytes = Buffer.from(content);
    const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50); local.writeUInt16LE(20, 4); local.writeUInt32LE(bytes.length, 18); local.writeUInt32LE(bytes.length, 22); local.writeUInt16LE(filename.length, 26);
    const header = Buffer.alloc(46); header.writeUInt32LE(0x02014b50); header.writeUInt16LE(20, 6); header.writeUInt32LE(bytes.length, 20); header.writeUInt32LE(bytes.length, 24); header.writeUInt16LE(filename.length, 28); header.writeUInt32LE(offset, 42);
    locals.push(local, filename, bytes); central.push(header, filename); offset += local.length + filename.length + bytes.length;
  }
  const directory = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

test('archive metrics include directory and symlink bytes and reject a sidecar root', async () => {
  await withOwnedDirectory(scratch, 'zip-', async root => {
    const file = path.join(root, 'hq.zip');
    const bytes = tinyZip([['HQ.app/', ''], ['HQ.app/Contents/file', 'abc'], ['HQ.app/Contents/link', 'file']]);
    fs.writeFileSync(file, bytes);
    assert.deepEqual(archiveMetrics(file), { size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), expandedSize: 7, fileCount: 3 });
    fs.writeFileSync(file, tinyZip([['__MACOSX/extra', 'abc']]));
    assert.throws(() => archiveMetrics(file), /archive root/);
    fs.writeFileSync(file, tinyZip([['HQ.app/../outside', 'abc']]));
    assert.throws(() => archiveMetrics(file), /archive root/);
  });
});

test('manifest binds exact fixed assets and positive workflow run identity', () => {
  const archive = { size: 12, sha256: 'd'.repeat(64), expandedSize: 45, fileCount: 3 };
  const metadata = { releaseTag: 'hq-desktop-0.1.0-preview.17', runId: '17', runAttempt: 1, event: 'push', publishedAt: '2026-10-22T00:00:00.000Z' };
  const manifest = manifestFor(receipt(), archive, metadata);
  assert.deepEqual(manifest.repository, REPOSITORY);
  assert.equal(manifest.workflow, WORKFLOW);
  assert.equal(manifest.archive.name, 'hq-darwin-arm64.zip');
  assert.equal(manifest.attestation, 'hq-darwin-arm64.sigstore.json');
  assert.equal(manifest.signing, 'adhoc');
  assert.throws(() => manifestFor(receipt(), archive, { ...metadata, runId: '18' }), /workflow run ID/);
  assert.throws(() => manifestFor(receipt(), archive, { ...metadata, event: 'pull_request' }), /release event/);
});

test('release guard requires exact integrated source and same tag workflow identity', () => {
  const context = { repository: REPOSITORY.name, repositoryId: REPOSITORY.id, ownerId: REPOSITORY.ownerId, event: 'push', ref: 'refs/tags/hq-desktop-0.1.0-preview.17', sourceSha: 'a'.repeat(40), tagSha: 'a'.repeat(40), foundationSha: 'a'.repeat(40), workflowSha: 'a'.repeat(40), workflowRef: `${REPOSITORY.name}/${WORKFLOW}@refs/tags/hq-desktop-0.1.0-preview.17`, runId: '17', runAttempt: '1' };
  assert.equal(assertReleaseContext(context), 'hq-desktop-0.1.0-preview.17');
  for (const variant of [{ event: 'pull_request' }, { foundationSha: 'b'.repeat(40) }, { tagSha: 'b'.repeat(40) }, { repositoryId: 1 }, { ownerId: 1 }, { workflowRef: `${REPOSITORY.name}/${WORKFLOW}@refs/heads/main` }]) assert.throws(() => assertReleaseContext({ ...context, ...variant }));
});

test('owned smoke scratch is removed on success/failure and never removes a concurrent root', async () => {
  let first, second;
  await withOwnedDirectory(scratch, 'first-', async root => {
    first = root;
    await assert.rejects(withOwnedDirectory(scratch, 'second-', async other => { second = other; throw new Error('original failure'); }), /original failure/);
    assert.equal(fs.existsSync(second), false);
    assert.equal(fs.existsSync(first), true);
  });
  assert.equal(fs.existsSync(first), false);
});

test('cleanup failure does not replace the original failure and removes signal handlers', async () => {
  const signals = new EventEmitter();
  let owned;
  try {
    await assert.rejects(withOwnedDirectory(scratch, 'cleanup-', async root => { owned = root; throw new Error('original failure'); }, { signals, remove() { throw new Error('cleanup failure'); } }), /original failure/);
    assert.equal(signals.listenerCount('SIGINT'), 0);
    assert.equal(signals.listenerCount('SIGTERM'), 0);
  } finally { if (owned) fs.rmSync(owned, { recursive: true, force: true }); }
});

module.exports = { receipt, put, tinyZip };

test('production context admits only the exact canonical default branch dispatch and one expected identity', () => {
  const { assertSigningContext, selectIdentity, cleanEnvironment } = require('../developer-id.cjs');
  const event = { repository: { default_branch: 'integrated', id: REPOSITORY.id, owner: { id: REPOSITORY.ownerId } } };
  const env = { GITHUB_REPOSITORY: REPOSITORY.name, GITHUB_EVENT_NAME: 'workflow_dispatch', GITHUB_REF: 'refs/heads/integrated', GITHUB_WORKFLOW_REF: `${REPOSITORY.name}/${WORKFLOW}@refs/heads/integrated`, GITHUB_WORKFLOW_SHA: 'a'.repeat(40), GITHUB_SHA: 'a'.repeat(40), HQ_SIGNING_MODE: 'developer-id' };
  assert.doesNotThrow(() => assertSigningContext(env, event));
  for (const change of [{ GITHUB_EVENT_NAME: 'pull_request' }, { GITHUB_EVENT_NAME: 'push' }, { GITHUB_REF: 'refs/tags/hq-desktop-test' }, { GITHUB_REF: 'refs/heads/untrusted' }, { GITHUB_WORKFLOW_SHA: 'b'.repeat(40) }, { GITHUB_REPOSITORY: 'another/HQ' }, { HQ_SIGNING_MODE: 'adhoc-development' }]) assert.throws(() => assertSigningContext({ ...env, ...change }, event));
  const identity = `1) ${'A'.repeat(40)} "Developer ID Application: Fixture (2CUPSQS986)"`;
  assert.equal(selectIdentity(identity), 'A'.repeat(40));
  for (const value of ['', identity.replace('2CUPSQS986', 'WRONGTEAM00'), `${identity}\n${identity}`]) assert.throws(() => selectIdentity(value));
  assert.deepEqual(cleanEnvironment({ KEEP: 'value', MACOS_SIGNING_CERTIFICATE_PASSWORD: 'synthetic', APPLE_NOTARY_API_KEY_P8_BASE64: 'synthetic' }), { KEEP: 'value' });
});

test('Developer ID signs nested code inside out with stable IDs, timestamp and hardened runtime and refuses fallback', async () => {
  const { signAndVerify, signingTargets } = require('../package.cjs');
  const { requirement, PRODUCT_ID } = require('../../signing.cjs');
  await withOwnedDirectory(scratch, 'signing-', async root => {
    const bundle = path.join(root, 'HQ.app');
    put(bundle, 'Contents/MacOS/HQ', 'fixture');
    put(bundle, 'Contents/Resources/app/tools/updater/process-inventory', 'fixture');
    put(bundle, 'Contents/Frameworks/HQ Helper.app/Contents/MacOS/HQ Helper', 'fixture');
    const native = path.join(bundle, 'Contents/Resources/app/native.node');
    fs.writeFileSync(native, Buffer.from('cffaedfe00000000', 'hex'));
    const calls = [], ids = new Map();
    const run = (file, args) => {
      calls.push([file, args]);
      if (file === '/usr/bin/lipo') return 'arm64';
      if (file === '/usr/bin/plutil') return args.includes('CFBundleIdentifier') ? (args.at(-1).includes('HQ Helper.app') ? `${PRODUCT_ID}.helper` : PRODUCT_ID) : 'HQ';
      if (args.includes('--sign')) ids.set(args.at(-1), args[args.indexOf('--identifier') + 1]);
      if (args.includes('-r-')) return `designated => ${requirement()}`;
      if (args.includes('--display')) return `Identifier=${ids.get(args.at(-1))}\nAuthority=Developer ID Application: Fixture (2CUPSQS986)\nTeamIdentifier=2CUPSQS986\nTimestamp=fixture\nCodeDirectory flags=0x10000(runtime)\n`;
      return '';
    };
    const targets = signingTargets(bundle, run);
    assert.equal(targets.at(-1).filename, bundle);
    assert.ok(targets.some(target => target.filename === native));
    signAndVerify(bundle, 'arm64', run, { mode: 'developer-id', identity: 'A'.repeat(40), keychain: '/fixture/isolated.keychain' });
    const signs = calls.filter(([, args]) => args.includes('--sign'));
    assert.equal(signs.length, targets.length);
    assert.equal(signs.at(-1)[1].at(-1), bundle);
    assert.ok(signs.every(([, args]) => args.includes('--timestamp') && args.includes('runtime') && !args.includes('--deep') && !args.includes('-')));
    assert.ok(calls.some(([, args]) => args.includes('-R') && args.includes(requirement())));
    assert.throws(() => signAndVerify(bundle, 'arm64', run, { mode: 'developer-id' }), /identity and isolated keychain/);
    assert.throws(() => signAndVerify(bundle, 'arm64', run, { mode: 'automatic' }), /explicit signing mode/);
  });
});

test('notarization must be accepted and stapled before distribution; failed submissions remove their exact temporary archive', async () => {
  const { notarizeAndStaple } = require('../package.cjs');
  await withOwnedDirectory(scratch, 'notary-', async root => {
    const bundle = path.join(root, 'HQ.app');
    put(bundle, 'Contents/file', 'fixture');
    const signing = { notaryKey: '/synthetic/key.p8', notaryKeyId: 'ABCDEFGHIJ', notaryIssuerId: '11111111-2222-3333-4444-555555555555' };
    const exercise = status => {
      const calls = [];
      const run = (file, args) => {
        calls.push([file, args]);
        if (file === '/usr/bin/ditto') fs.writeFileSync(args.at(-1), 'temporary');
        if (args[0] === 'notarytool') return JSON.stringify({ status });
        return '';
      };
      if (status === 'Accepted') notarizeAndStaple(bundle, root, signing, run);
      else assert.throws(() => notarizeAndStaple(bundle, root, signing, run), /did not accept/);
      assert.equal(fs.existsSync(path.join(root, 'notary-submission.zip')), false);
      return calls;
    };
    const accepted = exercise('Accepted');
    assert.ok(accepted.some(([, args]) => args[0] === 'stapler' && args[1] === 'validate'));
    assert.ok(accepted.some(([file]) => file === '/usr/sbin/spctl'));
    assert.ok(!exercise('Invalid').some(([, args]) => args[0] === 'stapler'));
  });
});

test('workflow keeps credentials exclusively in the protected default-branch production job', () => {
  const workflow = fs.readFileSync(path.resolve(__dirname, '../../../../.github/workflows/hq-desktop-package.yml'), 'utf8');
  const production = workflow.slice(workflow.indexOf('  developer-id:'), workflow.indexOf('  attest:'));
  assert.match(production, /environment: macos-signing/);
  assert.match(production, /github.event_name == 'workflow_dispatch'/);
  assert.match(production, /github.ref == format\('refs\/heads\/\{0\}', github.event.repository.default_branch\)/);
  assert.match(production, /ref: \$\{\{ github.sha \}\}/);
  assert.doesNotMatch(workflow.replace(production, ''), /secrets\./);
  assert.doesNotMatch(workflow, /pull_request_target/);
  assert.match(workflow, /HQ_SIGNING_MODE: adhoc-development/);
});
