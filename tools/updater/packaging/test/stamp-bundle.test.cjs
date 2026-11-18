'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PRODUCT, SYNTHETIC, buildReceipt } = require('../identity.cjs');
const { stampBundle } = require('../package.cjs');
const { withOwnedDirectory } = require('../owned-directory.cjs');

const scratch = path.resolve(__dirname, '../.scratch');
const receipt = synthetic => buildReceipt({ sourceSha: 'a'.repeat(40), sourceTree: 'b'.repeat(40), version: '0.1.0', buildSequence: 17, channel: 'preview', compatibilityEpoch: `hq1-${'c'.repeat(64)}`, architecture: 'arm64', synthetic });
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const write = (file, value) => fs.writeFileSync(file, JSON.stringify(value));

function fixture(root, productName, explicitExecutable, suffixes = ['', ' (GPU)', ' (Renderer)', ' (Plugin)']) {
  const bundle = path.join(root, 'fixture.app');
  const frameworks = path.join(bundle, 'Contents/Frameworks');
  fs.mkdirSync(path.join(bundle, 'Contents/MacOS'), { recursive: true });
  fs.mkdirSync(frameworks);
  fs.writeFileSync(path.join(bundle, 'Contents/MacOS', productName), 'main fixture; never run', { mode: 0o755 });
  write(path.join(bundle, 'Contents/Info.plist'), { CFBundleExecutable: productName });
  for (const suffix of suffixes) {
    const name = `${productName} Helper${suffix}`;
    const helper = path.join(frameworks, `${name}.app`);
    fs.mkdirSync(path.join(helper, 'Contents/MacOS'), { recursive: true });
    fs.writeFileSync(path.join(helper, 'Contents/MacOS', name), 'helper fixture; never run', { mode: 0o755 });
    write(path.join(helper, 'Contents/Info.plist'), { CFBundleName: name, CFBundleIdentifier: 'fixture.helper', LSUIElement: true, ...(explicitExecutable ? { CFBundleExecutable: name } : {}) });
  }
  // JSON models plist contents at the injected command boundary; no native tool runs.
  const run = (executable, args) => {
    assert.equal(executable, '/usr/bin/plutil');
    const file = args.at(-1), metadata = read(file);
    if (args[0] === '-extract') {
      assert.deepEqual(args.slice(2, -1), ['raw', '-o', '-']);
      if (!Object.hasOwn(metadata, args[1])) throw new Error(`No value at key path: ${args[1]}`);
      return `${metadata[args[1]]}\n`;
    }
    if (args[0] === '-convert') {
      assert.deepEqual(args.slice(1, -1), ['json', '-o', '-']);
      return JSON.stringify(metadata);
    }
    assert.equal(args[0], '-replace');
    metadata[args[1]] = args[2] === '-integer' ? Number(args[3]) : args[3];
    write(file, metadata);
    return '';
  };
  return { bundle, frameworks, run, suffixes };
}

function assertStamped(input, productName, identity) {
  assert.equal(read(path.join(input.bundle, 'Contents/Info.plist')).CFBundleExecutable, identity.productName);
  assert.equal(fs.readFileSync(path.join(input.bundle, 'Contents/MacOS', identity.productName), 'utf8'), 'main fixture; never run');
  assert.deepEqual(fs.readdirSync(input.frameworks).sort(), input.suffixes.map(suffix => `${identity.productName} Helper${suffix}.app`).sort());
  for (const suffix of input.suffixes) {
    const nextName = `${identity.productName} Helper${suffix}`;
    const helper = path.join(input.frameworks, `${nextName}.app`);
    assert.deepEqual(read(path.join(helper, 'Contents/Info.plist')), {
      CFBundleName: nextName, CFBundleDisplayName: nextName, CFBundleExecutable: nextName,
      CFBundleIdentifier: `${identity.bundleId}.helper${suffix.replace(/[^a-z]/gi, '').toLowerCase()}`, LSUIElement: true,
    });
    assert.equal(fs.readFileSync(path.join(helper, 'Contents/MacOS', nextName), 'utf8'), 'helper fixture; never run');
    assert.equal(fs.existsSync(path.join(helper, 'Contents/MacOS', `${productName} Helper${suffix}`)), false);
  }
}

test('stamps upstream Electron helpers whose plist omits CFBundleExecutable', async () => {
  await withOwnedDirectory(scratch, 'helper-upstream-', async root => {
    const input = fixture(root, 'Electron', false);
    stampBundle(input.bundle, receipt(false), input.run);
    assertStamped(input, 'Electron', PRODUCT);
  });
});

test('restamps explicit HQ helper identities for the synthetic native clone', async () => {
  await withOwnedDirectory(scratch, 'helper-synthetic-', async root => {
    const input = fixture(root, PRODUCT.productName, true);
    stampBundle(input.bundle, receipt(true), input.run);
    assertStamped(input, PRODUCT.productName, SYNTHETIC);
  });
});

test('helper metadata or executable uncertainty stops stamping without a guessed rename', async () => {
  for (const fault of ['name-mismatch', 'executable-mismatch', 'malformed', 'read-denied', 'missing', 'not-executable', 'symlink']) {
    await withOwnedDirectory(scratch, 'helper-refusal-', async root => {
      const input = fixture(root, 'Electron', true, [' (GPU)']);
      const helper = path.join(input.frameworks, 'Electron Helper (GPU).app');
      const plist = path.join(helper, 'Contents/Info.plist');
      const executable = path.join(helper, 'Contents/MacOS/Electron Helper (GPU)');
      const metadata = read(plist);
      if (fault === 'name-mismatch') write(plist, { ...metadata, CFBundleName: 'Another Helper' });
      if (fault === 'executable-mismatch') write(plist, { ...metadata, CFBundleExecutable: '../elsewhere' });
      if (fault === 'malformed') fs.writeFileSync(plist, '{');
      if (fault === 'missing') fs.unlinkSync(executable);
      if (fault === 'not-executable') fs.chmodSync(executable, 0o644);
      if (fault === 'symlink') {
        fs.renameSync(executable, path.join(root, 'sentinel'));
        fs.symlinkSync(path.join(root, 'sentinel'), executable);
      }
      const run = (tool, args) => {
        if (fault === 'read-denied' && args.at(-1) === plist) throw new Error('Injected plist read denied');
        return input.run(tool, args);
      };
      assert.throws(() => stampBundle(input.bundle, receipt(false), run), undefined, fault);
      assert.equal(fs.existsSync(helper), true, fault);
      assert.equal(fs.existsSync(path.join(input.frameworks, 'HQ Helper (GPU).app')), false, fault);
      if (fault !== 'missing') assert.equal(fs.readFileSync(executable, 'utf8'), 'helper fixture; never run', fault);
    });
  }
});
