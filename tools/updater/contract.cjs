'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { validateSigning, PRODUCTION_REF, productionReleaseTag } = require('./signing.cjs');

const MAX_ARCHIVE_BYTES = 1024 ** 3;
const MAX_EXPANDED_BYTES = 3 * 1024 ** 3;
const MAX_FILE_COUNT = 100000;
const MAX_RETAINED_OPERATIONS = 2;
const BUILD_KEYS = ['schemaVersion', 'product', 'version', 'buildSequence', 'sourceSha', 'sourceTree', 'channel', 'compatibilityEpoch', 'electronVersion', 'appName', 'bundleId', 'architecture'];
const MANIFEST_KEYS = [...BUILD_KEYS, 'repository', 'platform', 'releaseTag', 'workflow', 'runId', 'runAttempt', 'event', 'publishedAt', 'signing', 'archive', 'attestation'];
const PRODUCTION_ID = 'org.jones-systems.hq.local';
const SYNTHETIC_ID = 'org.jones-systems.hq.updater-test';

class UpdateError extends Error {
  constructor(code, message, options) {
    super(message, options);
    this.name = 'UpdateError';
    this.code = code;
  }
}
function ensure(condition, message, code = 'invalid') {
  if (!condition) throw new UpdateError(code, message);
}
function object(value, keys, label) {
  ensure(value !== null && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype, `Invalid ${label}.`);
  const actual = Object.keys(value).sort();
  ensure(actual.length === keys.length && actual.every((key, i) => key === [...keys].sort()[i]), `Invalid ${label} fields.`);
  return value;
}
function text(value, pattern, label, maximum = 200) {
  ensure(typeof value === 'string' && value.length > 0 && value.length <= maximum && pattern.test(value), `Invalid ${label}.`);
}
function integer(value, minimum, maximum, label) {
  ensure(Number.isSafeInteger(value) && value >= minimum && value <= maximum, `Invalid ${label}.`);
}
function absolute(value, label) {
  text(value, /^[^\0\r\n]+$/, label, 4096);
  ensure(path.isAbsolute(value) && path.resolve(value) === value && value !== path.parse(value).root, `Invalid ${label}.`);
  return value;
}
function inside(root, value) {
  return value === root || value.startsWith(root + path.sep);
}
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
function digest(value) { return crypto.createHash('sha256').update(canonical(value)).digest('hex'); }
function immutable(value) {
  if (value !== null && typeof value === 'object') {
    Object.values(value).forEach(immutable);
    Object.freeze(value);
  }
  return value;
}
function clone(value) { return JSON.parse(JSON.stringify(value)); }
function signingKeys(value, keys) { return Object.hasOwn(value ?? {}, 'signingPolicy') ? [...keys, 'signingPolicy'] : keys; }
function validateBuildFields(value, { synthetic = false } = {}) {
  if (Object.hasOwn(value, 'signingPolicy')) {
    try { validateSigning(value.signingPolicy, value.bundleId); } catch { ensure(false, 'Invalid production signing policy.'); }
  }
  ensure(value.schemaVersion === 1 && value.product === 'hq', 'Unsupported product or schema.');
  text(value.version, /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/, 'version');
  integer(value.buildSequence, 1, Number.MAX_SAFE_INTEGER, 'build sequence');
  text(value.sourceSha, /^[a-f0-9]{40}$/, 'source commit');
  text(value.sourceTree, /^[a-f0-9]{40}$/, 'source tree');
  ensure(value.channel === 'preview' || value.channel === 'stable', 'Invalid channel.');
  text(value.compatibilityEpoch, /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/, 'compatibility epoch');
  ensure(value.compatibilityEpoch !== 'unknown', 'A build must declare its compatibility epoch.');
  text(value.electronVersion, /^\d+\.\d+\.\d+$/, 'Electron version');
  ensure(value.appName === (synthetic ? 'HQ Updater Test' : 'HQ'), 'Unexpected application name.');
  ensure(value.bundleId === (synthetic ? SYNTHETIC_ID : PRODUCTION_ID), 'Unexpected bundle identity.');
  ensure(value.architecture === 'arm64' || value.architecture === 'x64', 'Unsupported architecture.');
}
function validateBuildReceipt(value, options) {
  object(value, signingKeys(value, BUILD_KEYS), 'build receipt');
  validateBuildFields(value, options);
  return immutable(clone(value));
}
function validateManifest(value, options) {
  object(value, signingKeys(value, value?.signingPolicy ? [...MANIFEST_KEYS, 'sourceRef'] : MANIFEST_KEYS), 'manifest');
  validateBuildFields(value, options);
  object(value.repository, ['name', 'id', 'ownerId'], 'repository');
  ensure(value.repository.name === 'Jones-Systems/HQ', 'Unexpected repository.');
  integer(value.repository.id, 1, Number.MAX_SAFE_INTEGER, 'repository ID');
  integer(value.repository.ownerId, 1, Number.MAX_SAFE_INTEGER, 'repository owner ID');
  ensure(value.platform === 'darwin' && value.event === 'push' && value.signing === (value.signingPolicy ? 'developer-id' : 'adhoc'), 'Unsupported package.');
  ensure(value.workflow === '.github/workflows/hq-desktop-package.yml', 'Unexpected workflow.');
  text(value.releaseTag, /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/, 'release tag');
  text(value.runId, /^[1-9][0-9]{0,19}$/, 'workflow run');
  integer(value.runAttempt, 1, 1000, 'run attempt');
  if (value.signingPolicy) ensure(value.sourceRef === PRODUCTION_REF && value.releaseTag === productionReleaseTag(value.runId), 'Unexpected production source or release identity.');
  else ensure(!value.releaseTag.startsWith('hq-desktop-signed-'), 'Production release tags cannot carry ad-hoc packages.');
  text(value.publishedAt, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/, 'publication time');
  ensure(Number.isFinite(Date.parse(value.publishedAt)), 'Invalid publication time.');
  object(value.archive, ['name', 'size', 'sha256', 'expandedSize', 'fileCount'], 'archive');
  text(value.archive.name, /^[A-Za-z0-9][A-Za-z0-9._-]*\.(?:zip|tar\.gz)$/, 'archive name');
  integer(value.archive.size, 1, MAX_ARCHIVE_BYTES, 'archive size');
  integer(value.archive.expandedSize, 1, MAX_EXPANDED_BYTES, 'expanded size');
  integer(value.archive.fileCount, 1, MAX_FILE_COUNT, 'archive entry count');
  text(value.archive.sha256, /^[a-f0-9]{64}$/, 'archive digest');
  text(value.attestation, /^[A-Za-z0-9][A-Za-z0-9._-]*\.json$/, 'attestation asset');
  return immutable(clone(value));
}
function receiptOf(manifest) { return Object.fromEntries(signingKeys(manifest, BUILD_KEYS).map(key => [key, manifest[key]])); }
function candidateId(manifest, options) { return digest(validateManifest(manifest, options)); }
function validateLegacy(value) {
  object(value, ['kind', 'bootstrapSha256', 'packageSha256', 'mainSha256'], 'legacy identity');
  ensure(value.kind === 'legacy', 'Invalid legacy identity.');
  for (const key of ['bootstrapSha256', 'packageSha256', 'mainSha256']) text(value[key], /^[a-f0-9]{64}$/, key);
  return immutable(clone(value));
}
function validateInstallation(value) {
  object(value, ['schemaVersion', 'product', 'installationId', 'targetPath', 'stateRoot', 'userData', 'sessionData', 'appName', 'bundleId', 'channel', 'compatibilityEpoch', 'profileCreation', 'synthetic', 'installed'], 'installation record');
  ensure(value.schemaVersion === 1 && value.product === 'hq' && typeof value.synthetic === 'boolean', 'Invalid installation schema.');
  text(value.installationId, /^[a-zA-Z0-9][a-zA-Z0-9_-]{7,127}$/, 'installation ID');
  for (const key of ['targetPath', 'stateRoot', 'userData', 'sessionData']) absolute(value[key], key);
  ensure(value.targetPath.endsWith('.app'), 'Installation target must be an app bundle.');
  ensure(!inside(value.targetPath, value.stateRoot) && !inside(value.stateRoot, value.targetPath), 'State and bundle paths overlap.');
  for (const pin of [value.userData, value.sessionData]) {
    ensure(!inside(value.targetPath, pin) && !inside(pin, value.targetPath) && !inside(value.stateRoot, pin) && !inside(pin, value.stateRoot), 'Profile and updater paths overlap.');
  }
  ensure(value.appName === (value.synthetic ? 'HQ Updater Test' : 'HQ') && value.bundleId === (value.synthetic ? SYNTHETIC_ID : PRODUCTION_ID), 'Invalid installation application identity.');
  ensure(['preview', 'stable'].includes(value.channel), 'Invalid installation channel.');
  text(value.compatibilityEpoch, /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/, 'installation epoch');
  ensure(['allowed-until-first-health', 'forbidden'].includes(value.profileCreation), 'Invalid profile creation policy.');
  if (value.installed?.kind === 'legacy') {
    validateLegacy(value.installed);
    ensure(value.compatibilityEpoch === 'unknown' && value.profileCreation === 'forbidden', 'Legacy profile compatibility is unknown.');
  } else {
    validateBuildReceipt(value.installed, { synthetic: value.synthetic });
    ensure(value.installed.channel === value.channel && value.installed.compatibilityEpoch === value.compatibilityEpoch && value.installed.appName === value.appName, 'Installation identity mismatch.');
  }
  return immutable(clone(value));
}
function validatePreparedCandidate(value, options) {
  object(value, ['schemaVersion', 'candidateId', 'manifest', 'bundlePath'], 'prepared candidate');
  ensure(value.schemaVersion === 1, 'Invalid candidate schema.');
  const manifest = validateManifest(value.manifest, options);
  ensure(value.candidateId === candidateId(manifest, options), 'Candidate identity mismatch.', 'stale-candidate');
  absolute(value.bundlePath, 'candidate bundle path');
  ensure(value.bundlePath.endsWith('.app'), 'Candidate must be an app bundle.');
  return immutable(clone(value));
}
function validateProcess(value) {
  object(value, ['pid', 'start', 'boot', 'executable'], 'process identity');
  integer(value.pid, 1, 0x7fffffff, 'process ID');
  text(value.start, /^[^\0\r\n]+$/, 'process start', 128);
  text(value.boot, /^[^\0\r\n]+$/, 'boot identity', 128);
  absolute(value.executable, 'process executable');
  return immutable(clone(value));
}
function sameProcess(a, b) { return a !== null && b !== null && ['pid', 'start', 'boot', 'executable'].every(key => a[key] === b[key]); }
function transactionPaths(record, operationId) {
  const stem = path.join(path.dirname(record.targetPath), `.${path.basename(record.targetPath)}.update-${operationId}`);
  return { stagePath: `${stem}.stage.app`, priorPath: `${stem}.prior.app`, failedPath: `${stem}.failed.app` };
}
function recordPath(targetPath) { absolute(targetPath, 'target path'); return path.join(path.dirname(targetPath), `.${path.basename(targetPath)}.installation.json`); }
async function readJson(file, { fs: io = fs, maxBytes = 1024 * 1024 } = {}) {
  const handle = await io.open(file, require('node:fs').constants.O_RDONLY | require('node:fs').constants.O_NOFOLLOW);
  let contents;
  try {
    const stat = await handle.stat();
    ensure(stat.isFile() && stat.size <= maxBytes, 'Invalid updater record.');
    contents = await handle.readFile('utf8');
  } finally { await handle.close(); }
  try { return JSON.parse(contents); } catch (cause) {
    if (cause instanceof SyntaxError) throw new UpdateError('invalid', 'Updater JSON is malformed.', { cause });
    throw cause;
  }
}
async function syncDirectory(directory, { fs: io = fs } = {}) {
  const handle = await io.open(directory, 'r');
  try { await handle.sync(); } catch (error) {
    if (!['EINVAL', 'ENOTSUP', 'EOPNOTSUPP'].includes(error.code)) throw error;
  } finally { await handle.close(); }
}
async function atomicWrite(file, value, { fs: io = fs, checkpoint = async () => {} } = {}) {
  const temporary = `${file}.${crypto.randomBytes(16).toString('hex')}.tmp`;
  let handle;
  let renamed = false;
  let failure;
  try {
    handle = await io.open(temporary, 'wx', 0o600);
    await handle.writeFile(`${canonical(value)}\n`, 'utf8');
    await handle.sync();
    await checkpoint('atomic-file-synced', file);
    await handle.close();
    handle = undefined;
    await io.rename(temporary, file);
    renamed = true;
    await checkpoint('atomic-renamed', file);
    await syncDirectory(path.dirname(file), { fs: io });
    await checkpoint('atomic-directory-synced', file);
  } catch (error) {
    failure = error;
    if (renamed) error.unknownEffect = true;
    throw error;
  } finally {
    if (handle) await handle.close().catch(() => {});
    if (!renamed) await io.unlink(temporary).catch(error => {
      if (error.code !== 'ENOENT') { if (failure) failure.cleanupError = error; else throw error; }
    });
  }
}
async function readBuildReceipt(bundlePath, options = {}) {
  return validateBuildReceipt(await readJson(path.join(bundlePath, 'Contents/Resources/app/build-receipt.json'), options), options);
}
async function optionalJson(file, options) {
  try { return await readJson(file, options); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
async function assertNoSymlink(file, { fs: io = fs, missingLeaf = false } = {}) {
  const root = path.parse(absolute(file, 'filesystem path')).root;
  const parts = file.slice(root.length).split(path.sep);
  let current = root;
  for (let i = 0; i < parts.length; i++) {
    current = path.join(current, parts[i]);
    let stat;
    try { stat = await io.lstat(current); } catch (error) {
      if (error.code === 'ENOENT' && missingLeaf && i === parts.length - 1) return;
      throw error;
    }
    ensure(!stat.isSymbolicLink(), 'An updater path is a symbolic link.', 'recovery-required');
    if (i < parts.length - 1) ensure(stat.isDirectory(), 'Invalid updater parent.', 'recovery-required');
  }
}

module.exports = { UpdateError, ensure, object, text, integer, absolute, inside, canonical, digest, clone, immutable, validateBuildReceipt, validateManifest, validateLegacy, validateInstallation, validatePreparedCandidate, validateProcess, sameProcess, receiptOf, candidateId, recordPath, readJson, optionalJson, atomicWrite, syncDirectory, readBuildReceipt, assertNoSymlink, MAX_ARCHIVE_BYTES, MAX_EXPANDED_BYTES, MAX_FILE_COUNT, MAX_RETAINED_OPERATIONS, transactionPaths, PRODUCTION_ID, SYNTHETIC_ID };
