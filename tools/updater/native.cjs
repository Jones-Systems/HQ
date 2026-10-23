'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const cp = require('node:child_process');
const { promisify } = require('node:util');
const { ensure, UpdateError, object, integer, text, inside, readJson, readBuildReceipt, canonical, validateProcess, sameProcess, assertNoSymlink, syncDirectory, MAX_EXPANDED_BYTES, MAX_FILE_COUNT, SYNTHETIC_ID } = require('./contract.cjs');

const { requirement, verifySignatureDetails, verifyDesignatedRequirement } = require('./signing.cjs');

const INVENTORY_PATH = path.join(__dirname, 'process-inventory');
const MAX_INVENTORY_BYTES = 4 * 1024 * 1024;
const MAX_INVENTORY_PROCESSES = 32768;

function parseProcessInventory(output, observerPid) {
  try {
    ensure(typeof output === 'string' && Buffer.byteLength(output, 'utf8') <= MAX_INVENTORY_BYTES, 'Invalid process inventory output.');
    const value = object(JSON.parse(output), ['schemaVersion', 'complete', 'boot', 'processes'], 'process inventory');
    ensure(value.schemaVersion === 1 && value.complete === true && Array.isArray(value.processes) && value.processes.length > 0 && value.processes.length <= MAX_INVENTORY_PROCESSES, 'Incomplete process inventory.');
    const timestamp = (value, label) => text(value, /^[1-9][0-9]{0,15}:[0-9]{6}$/, label, 23);
    timestamp(value.boot, 'inventory boot identity');
    integer(observerPid, 1, 0x7fffffff, 'inventory observer PID');
    const seen = new Set();
    const processes = [];
    let observed = false;
    for (const row of value.processes) {
      object(row, ['pid', 'ppid', 'start', 'boot', 'executable'], 'inventory process');
      const identity = validateProcess({ pid: row.pid, start: row.start, boot: row.boot, executable: row.executable });
      integer(row.ppid, 0, 0x7fffffff, 'inventory parent PID');
      timestamp(row.start, 'inventory process start');
      ensure(row.boot === value.boot && !seen.has(row.pid), 'Inconsistent process inventory.');
      seen.add(row.pid);
      if (row.pid === observerPid) {
        // Only this completed observation child is exempt; names cannot exempt another live process.
        ensure(row.ppid === process.pid && row.executable === INVENTORY_PATH, 'Inventory observer identity differs.');
        observed = true;
      } else processes.push({ ...identity, ppid: row.ppid });
    }
    ensure(observed, 'Inventory observer identity is missing.');
    return { complete: true, boot: value.boot, processes };
  } catch (cause) {
    throw new UpdateError('recovery-required', 'Process inventory is incomplete; activation is held.', { cause });
  }
}

function createNativeAdapter({ fs: io = fs, execFile = promisify(cp.execFile), spawn = cp.spawn, platform = process.platform, architecture = process.arch } = {}) {
  function supported() { ensure(platform === 'darwin', 'Native activation is unavailable on this platform.', 'unavailable'); }
  async function execute(file, args) {
    supported();
    const pending = execFile(file, args, { encoding: 'utf8', timeout: 30000, maxBuffer: MAX_INVENTORY_BYTES, env: { PATH: '/usr/bin:/bin:/usr/sbin:/sbin', LC_ALL: 'C' } });
    const observerPid = pending.child?.pid;
    return { ...await pending, observerPid };
  }
  async function processTable() {
    supported();
    let observation;
    try { observation = await execute(INVENTORY_PATH, []); } catch (cause) {
      throw new UpdateError('recovery-required', 'Process inventory is unavailable; activation is held.', { cause });
    }
    return parseProcessInventory(observation.stdout, observation.observerPid);
  }
  async function identity(pid = process.pid) {
    const table = await processTable();
    const row = table.processes.find(item => item.pid === pid);
    ensure(row, 'Process identity is unavailable.', 'recovery-required');
    return validateProcess({ pid: row.pid, start: row.start, boot: row.boot, executable: row.executable });
  }
  async function observe(expected) {
    let table;
    try { table = await processTable(); } catch { return 'unknown'; }
    if (table.boot !== expected.boot) return 'stale';
    const found = table.processes.find(item => item.pid === expected.pid);
    if (!found) return 'dead';
    return sameProcess(expected, found) ? 'live' : 'stale';
  }
  function runtimePath(bundlePath, receipt) {
    return path.join(bundlePath, 'Contents/MacOS', receipt?.bundleId === SYNTHETIC_ID ? 'HQ Updater Test' : 'HQ');
  }
  async function verifyBundle(bundlePath, expected) {
    try { return await verifyBundleContents(bundlePath, expected); } catch (cause) {
      if (Number.isInteger(cause.code) && cause.code > 0 && !cause.killed && !cause.signal) throw new UpdateError('integrity', 'Native bundle verification rejected the bundle contents.', { cause });
      throw cause;
    }
  }
  async function verifyBundleContents(bundlePath, expected) {
    supported();
    await assertNoSymlink(bundlePath, { fs: io });
    const synthetic = expected.bundleId === SYNTHETIC_ID;
    const receipt = await readBuildReceipt(bundlePath, { fs: io, synthetic });
    ensure(canonical(receipt) === canonical(expected), 'Bundle receipt differs from the accepted build.', 'integrity');
    const pkg = await readJson(path.join(bundlePath, 'Contents/Resources/app/package.json'), { fs: io });
    ensure(pkg.name === (synthetic ? 'hq-updater-test' : 'hq') && pkg.productName === receipt.appName, 'Package application identity differs.', 'integrity');
    const plist = async key => String((await execute('/usr/libexec/PlistBuddy', ['-c', `Print :${key}`, path.join(bundlePath, 'Contents/Info.plist')])).stdout).trim();
    ensure(await plist('CFBundleIdentifier') === receipt.bundleId && await plist('CFBundleExecutable') === receipt.appName && await plist('CFBundleName') === receipt.appName, 'Native application identity differs.', 'integrity');
    const arch = String((await execute('/usr/bin/lipo', ['-archs', runtimePath(bundlePath, receipt)])).stdout).trim();
    ensure(arch === (receipt.architecture === 'x64' ? 'x86_64' : 'arm64'), 'Bundle architecture differs.', 'integrity');
    await execute('/usr/bin/codesign', ['--verify', '--deep', '--strict', bundlePath]);
    const signature = await execute('/usr/bin/codesign', ['--display', '--verbose=4', bundlePath]);
    const details = String(signature.stderr || signature.stdout);
    try {
      verifySignatureDetails(details, receipt.bundleId, Boolean(receipt.signingPolicy));
      if (receipt.signingPolicy) {
        await execute('/usr/bin/codesign', ['--verify', '--deep', '--strict', '-R', `=${requirement(receipt.bundleId)}`, bundlePath]);
        const designated = await execute('/usr/bin/codesign', ['--display', '-r-', bundlePath]);
        verifyDesignatedRequirement(String(designated.stderr || designated.stdout), receipt.bundleId);
        await execute('/usr/bin/xcrun', ['stapler', 'validate', bundlePath]);
        await execute('/usr/sbin/spctl', ['--assess', '--type', 'execute', '--verbose=2', bundlePath]);
      }
    } catch (cause) {
      if (cause.killed || cause.signal || (cause.code && typeof cause.code !== 'number')) throw cause;
      throw new UpdateError('integrity', 'Code signing admission failed.', { cause });
    }
    return receipt;
  }
  async function legacyIdentity(bundlePath) {
    await assertNoSymlink(bundlePath, { fs: io });
    const files = { bootstrapSha256: 'local-bootstrap.cjs', packageSha256: 'package.json', mainSha256: 'apps/desktop/dist-electron/main.js' };
    const result = { kind: 'legacy' };
    for (const [key, file] of Object.entries(files)) {
      const filename = path.join(bundlePath, 'Contents/Resources/app', file);
      await assertNoSymlink(filename, { fs: io });
      const bytes = await io.readFile(filename);
      ensure(bytes.length <= 16 * 1024 * 1024, 'Legacy source metadata exceeds its bound.', 'invalid');
      result[key] = crypto.createHash('sha256').update(bytes).digest('hex');
    }
    return result;
  }
  async function verifyLegacy(bundlePath, expected, record) {
    ensure(canonical(await legacyIdentity(bundlePath)) === canonical(expected), 'Legacy source identity changed.', 'stale-candidate');
    const pkg = await readJson(path.join(bundlePath, 'Contents/Resources/app/package.json'), { fs: io });
    ensure(pkg.name === (record.synthetic ? 'hq-updater-test' : 'hq') && pkg.productName === record.appName, 'Legacy application metadata differs.', 'incompatible');
    const id = String((await execute('/usr/libexec/PlistBuddy', ['-c', 'Print :CFBundleIdentifier', path.join(bundlePath, 'Contents/Info.plist')])).stdout).trim();
    ensure(id === record.bundleId, 'Legacy bundle identity differs.', 'incompatible');
    return expected;
  }
  async function checkTarget(record, requiredBytes) {
    supported();
    await assertNoSymlink(path.dirname(record.targetPath), { fs: io });
    await assertNoSymlink(record.targetPath, { fs: io, missingLeaf: true });
    const parent = await io.stat(path.dirname(record.targetPath));
    ensure(parent.uid === process.getuid(), 'Target directory is not owned by this user.', 'permission');
    await io.access(path.dirname(record.targetPath), require('node:fs').constants.W_OK);
    try {
      const target = await io.lstat(record.targetPath);
      ensure(target.isDirectory() && target.uid === process.getuid(), 'Target bundle ownership differs.', 'permission');
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    const space = await io.statfs(path.dirname(record.targetPath));
    ensure(Number(space.bavail) * Number(space.bsize) >= requiredBytes, 'Insufficient installation space.', 'space');
    ensure(architecture === record.installed.architecture || record.installed.kind === 'legacy', 'Native architecture differs.', 'incompatible');
  }
  async function inspectTree(bundlePath, { synchronize = false } = {}) {
    let bytes = 0;
    let entries = 0;
    async function visit(filename) {
      const stat = await io.lstat(filename);
      ensure(++entries <= MAX_FILE_COUNT, 'Bundle has too many entries.', 'integrity');
      if (stat.isSymbolicLink()) {
        const target = await io.realpath(filename);
        ensure(inside(bundlePath, target), 'Bundle symlink escapes the bundle.', 'integrity');
      } else if (stat.isDirectory()) {
        for (const name of await io.readdir(filename)) await visit(path.join(filename, name));
        if (synchronize) await syncDirectory(filename, { fs: io });
      } else {
        ensure(stat.isFile() && stat.nlink === 1, 'Bundle contains a special file or hard link.', 'integrity');
        bytes += stat.size;
        ensure(bytes <= MAX_EXPANDED_BYTES, 'Bundle exceeds expanded-size limit.', 'integrity');
        if (synchronize) {
          const handle = await io.open(filename, 'r');
          try { await handle.sync(); } finally { await handle.close(); }
        }
      }
    }
    await visit(bundlePath);
    return { bytes, entries };
  }
  async function copyBundle(source, destination, expected) {
    object(expected, ['dev', 'ino', 'uid'], 'created stage identity');
    ensure(Object.values(expected).every(part => typeof part === 'string' && /^[0-9]{1,24}$/.test(part)) && expected.uid === String(process.getuid()), 'Created stage identity is unavailable.', 'recovery-required');
    const constants = require('node:fs').constants;
    const handle = await io.open(destination, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    try {
      async function sameDestination() {
        await assertNoSymlink(destination, { fs: io });
        for (const stat of [await handle.stat({ bigint: true }), await io.lstat(destination, { bigint: true })]) {
          ensure(stat.isDirectory() && ['dev', 'ino', 'uid'].every(key => String(stat[key]) === expected[key]), 'Created stage directory changed during copy.', 'recovery-required');
        }
      }
      await sameDestination();
      ensure((await io.readdir(destination)).length === 0, 'Created stage directory is not empty.', 'recovery-required');
      await inspectTree(source);
      await sameDestination();
      ensure((await io.readdir(destination)).length === 0, 'Created stage directory changed before copying.', 'recovery-required');
      for (const name of await io.readdir(source)) {
        await sameDestination();
        await io.cp(path.join(source, name), path.join(destination, name), { recursive: true, errorOnExist: true, force: false, dereference: false, verbatimSymlinks: true, filter: async () => { await sameDestination(); return true; } });
      }
      await sameDestination();
      await inspectTree(destination, { synchronize: true });
      await sameDestination();
      await syncDirectory(path.dirname(destination), { fs: io });
    } finally { await handle.close(); }
  }
  async function spawnDetached(executable, args, environment) {
    return new Promise((resolve, reject) => {
      let child;
      try { child = spawn(executable, args, { detached: true, stdio: 'ignore', env: environment }); } catch (cause) { reject(new UpdateError('recovery-required', 'Process launch result is unknown.', { cause })); return; }
      child.once('error', cause => { const error = new UpdateError('recovery-required', 'Process launch failed; inspect before retry.', { cause }); error.unknownEffect = true; reject(error); });
      child.once('spawn', () => { child.unref(); resolve({ pid: child.pid }); });
    });
  }
  function environment() {
    const result = {};
    for (const key of ['HOME', 'USER', 'LOGNAME', 'TMPDIR', 'LANG']) if (process.env[key]) result[key] = process.env[key];
    return { ...result, PATH: '/usr/bin:/bin:/usr/sbin:/sbin' };
  }
  async function spawnHelper(record, candidate, operationId) {
    const executable = runtimePath(candidate.bundlePath, candidate.manifest);
    const helper = path.join(candidate.bundlePath, 'Contents/Resources/app/tools/updater/helper.cjs');
    return spawnDetached(executable, [helper, '--record', require('./contract.cjs').recordPath(record.targetPath), '--operation', operationId], { ...environment(), ELECTRON_RUN_AS_NODE: '1' });
  }
  async function launch(record, journal) {
    return spawnDetached(runtimePath(record.targetPath, journal.candidate.manifest), [`--hq-update-operation=${journal.operationId}`, `--hq-update-sequence=${journal.sequence}`], environment());
  }
  return { platform, architecture, supported, identity, observe, processTable, runtimePath, verifyBundle, verifyLegacy, legacyIdentity, checkTarget, copyBundle, inspectTree, spawnHelper, launch };
}
module.exports = { createNativeAdapter };
