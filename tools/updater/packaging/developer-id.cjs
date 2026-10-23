'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { withOwnedDirectory } = require('./owned-directory.cjs');
const { packageApplication } = require('./package.cjs');
const { REPOSITORY, WORKFLOW } = require('./identity.cjs');
const { TEAM_ID } = require('../signing.cjs');

const SECRET_NAMES = ['MACOS_SIGNING_CERTIFICATE_P12_BASE64', 'MACOS_SIGNING_CERTIFICATE_PASSWORD', 'APPLE_NOTARY_API_KEY_P8_BASE64', 'APPLE_NOTARY_KEY_ID', 'APPLE_NOTARY_ISSUER_ID'];
function assertSigningContext(env, event) {
  const branch = event.repository?.default_branch;
  if (env.GITHUB_REPOSITORY !== REPOSITORY.name || String(event.repository?.id) !== String(REPOSITORY.id) || String(event.repository?.owner?.id) !== String(REPOSITORY.ownerId) || env.GITHUB_EVENT_NAME !== 'workflow_dispatch' || !branch || env.GITHUB_REF !== `refs/heads/${branch}` || env.GITHUB_WORKFLOW_REF !== `${REPOSITORY.name}/${WORKFLOW}@refs/heads/${branch}` || env.GITHUB_WORKFLOW_SHA !== env.GITHUB_SHA || env.HQ_SIGNING_MODE !== 'developer-id') throw new Error('Production signing requires the exact trusted default-branch workflow');
}
function cleanEnvironment(env) { return Object.fromEntries(Object.entries(env).filter(([key]) => !SECRET_NAMES.includes(key))); }
function selectIdentity(output) {
  const matches = [...output.matchAll(/\b([A-Fa-f0-9]{40}) "Developer ID Application: [^"\n]+ \(2CUPSQS986\)"/g)];
  if (matches.length !== 1) throw new Error(`One Developer ID Application identity for team ${TEAM_ID} is required`);
  return matches[0][1];
}
function run(file, args, env) {
  const result = spawnSync(file, args, { env, encoding: 'utf8', maxBuffer: 1024 ** 2 });
  if (result.error || result.status !== 0) throw new Error(`Signing setup command failed: ${path.basename(file)}`);
  return result.stdout;
}
async function main(env = process.env) {
  assertSigningContext(env, JSON.parse(fs.readFileSync(env.GITHUB_EVENT_PATH, 'utf8')));
  if (process.platform !== 'darwin' || !path.isAbsolute(env.RUNNER_TEMP ?? '') || !path.isAbsolute(env.HQ_PACKAGE_OUTPUT ?? '')) throw new Error('A native runner and absolute owned output paths are required');
  if (SECRET_NAMES.some(name => typeof env[name] !== 'string' || !env[name] || env[name].length > 1024 ** 2)) throw new Error('Production signing credentials are unavailable; no ad-hoc fallback');
  const sanitized = cleanEnvironment(env);
  const secrets = Object.fromEntries(SECRET_NAMES.map(name => [name, env[name]]));
  for (const name of SECRET_NAMES) delete process.env[name];
  const parent = fs.realpathSync(env.RUNNER_TEMP);
  await withOwnedDirectory(parent, 'hq-signing-', async scratch => {
    fs.chmodSync(scratch, 0o700);
    const keychain = path.join(scratch, 'signing.keychain-db');
    const notaryKey = path.join(scratch, 'notary.p8');
    const key = Buffer.from(secrets.APPLE_NOTARY_API_KEY_P8_BASE64, 'base64');
    if (!key.toString('utf8').includes('-----BEGIN PRIVATE KEY-----')) throw new Error('Invalid notarization key encoding');
    fs.writeFileSync(notaryKey, key, { mode: 0o600, flag: 'wx' });
    let failure;
    try {
      run('/usr/bin/xcrun', ['swift', path.join(__dirname, 'import-signing-identity.swift'), keychain], { ...sanitized, CLANG_MODULE_CACHE_PATH: path.join(scratch, 'module-cache'), SWIFT_MODULECACHE_PATH: path.join(scratch, 'module-cache'), MACOS_SIGNING_CERTIFICATE_P12_BASE64: secrets.MACOS_SIGNING_CERTIFICATE_P12_BASE64, MACOS_SIGNING_CERTIFICATE_PASSWORD: secrets.MACOS_SIGNING_CERTIFICATE_PASSWORD });
      fs.chmodSync(keychain, 0o600);
      // The isolated keychain has an intentionally empty, non-secret password.
      run('/usr/bin/security', ['set-key-partition-list', '-S', 'apple-tool:,apple:', '-s', '-k', '', keychain], sanitized);
      const identity = selectIdentity(run('/usr/bin/security', ['find-identity', '-v', '-p', 'codesigning', keychain], sanitized));
      return packageApplication({ root: path.resolve(__dirname, '../../..'), output: env.HQ_PACKAGE_OUTPUT, sourceSha: env.GITHUB_SHA, architecture: env.HQ_PACKAGE_ARCH, buildSequence: Number(env.GITHUB_RUN_ID), channel: 'preview', signing: { mode: 'developer-id', identity, keychain, notaryKey, notaryKeyId: secrets.APPLE_NOTARY_KEY_ID, notaryIssuerId: secrets.APPLE_NOTARY_ISSUER_ID } });
    } catch (error) { failure = error; throw error; }
    finally {
      try { if (fs.existsSync(keychain)) run('/usr/bin/security', ['delete-keychain', keychain], sanitized); }
      catch (error) { if (!failure) throw error; process.stderr.write('Ephemeral keychain cleanup failed after original failure.\n'); }
    }
  });
}
if (require.main === module) main().catch(() => { process.stderr.write('Developer ID packaging failed; no unsigned fallback or credential details emitted.\n'); process.exitCode = 1; });
module.exports = { assertSigningContext, selectIdentity, cleanEnvironment, main };
