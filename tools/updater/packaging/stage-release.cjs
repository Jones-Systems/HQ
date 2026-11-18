'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { REPOSITORY } = require('./identity.cjs');
const { validateManifest } = require('../contract.cjs');
const { PRODUCTION_REF } = require('../signing.cjs');
const { assertReleaseContext, releaseContext } = require('./release-guard.cjs');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

function findUnique(root, basename) {
  const found = [];
  function visit(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error('Unexpected release artifact symlink');
      if (entry.isDirectory()) visit(file);
      else if (entry.name === basename) found.push(file);
    }
  }
  visit(root);
  if (found.length !== 1) throw new Error(`Expected one release artifact: ${basename}`);
  return found[0];
}

function verifyReleaseFiles(root, arch, context) {
  if (!['arm64', 'x64'].includes(arch)) throw new Error('Invalid release architecture');
  const tag = assertReleaseContext(context), basename = `hq-darwin-${arch}`;
  const archive = findUnique(root, `${basename}.zip`), manifestFile = findUnique(root, `${basename}.json`);
  const manifest = validateManifest(JSON.parse(fs.readFileSync(manifestFile, 'utf8')));
  const bytes = fs.readFileSync(archive);
  if (manifest.sourceSha !== context.sourceSha || manifest.releaseTag !== tag || manifest.runId !== context.runId || manifest.runAttempt !== Number(context.runAttempt) || manifest.repository.id !== REPOSITORY.id || manifest.repository.ownerId !== REPOSITORY.ownerId || manifest.architecture !== arch || manifest.archive.name !== `${basename}.zip` || manifest.archive.size !== bytes.length || manifest.archive.sha256 !== hash(bytes) || manifest.signing !== (context.ref === PRODUCTION_REF ? 'developer-id' : 'adhoc')) throw new Error('Downloaded release artifact identity differs');
  return { archive, manifestFile, manifest };
}
function stageRelease(environment = process.env) {
  const arch = environment.HQ_PACKAGE_ARCH, basename = `hq-darwin-${arch}`;
  const { archive, manifestFile } = verifyReleaseFiles('release-input', arch, releaseContext(environment));
  const bundle = fs.readFileSync(environment.ATTESTATION_BUNDLE), parsed = JSON.parse(bundle);
  if (!parsed.dsseEnvelope || !parsed.verificationMaterial) throw new Error('Attestation action did not return a JSON Sigstore bundle');
  fs.mkdirSync('release-assets');
  fs.copyFileSync(archive, path.join('release-assets', `${basename}.zip`), fs.constants.COPYFILE_EXCL);
  fs.copyFileSync(manifestFile, path.join('release-assets', `${basename}.json`), fs.constants.COPYFILE_EXCL);
  fs.writeFileSync(path.join('release-assets', `${basename}.sigstore.json`), bundle, { flag: 'wx' });
}
function api(endpoint, method = 'GET', body) {
  const args = ['api', '--include', '--method', method, endpoint, ...(body ? ['--input', '-'] : [])];
  const result = spawnSync('gh', args, { encoding: 'utf8', input: body ? JSON.stringify(body) : undefined, maxBuffer: 4 * 1024 ** 2 });
  const output = (result.stdout ?? '').replaceAll('\r\n', '\n');
  const status = /^HTTP\/[\d.]+ (\d{3})\b/.exec(output);
  if (result.error || !status || !output.includes('\n\n')) throw new Error('GitHub effect is unknown; inspect before retry');
  const code = Number(status[1]);
  if (result.status !== 0 && code !== 404) throw new Error('GitHub request failed; inspect before retry');
  return { status: code, body: JSON.parse(output.slice(output.indexOf('\n\n') + 2)) };
}
function exactTag(response, tag, sha) {
  if (response.status !== 200 || response.body?.ref !== `refs/tags/${tag}` || response.body?.object?.type !== 'commit' || response.body?.object?.sha !== sha) throw new Error('Release tag does not identify the exact attested commit');
}
function publishProduction(context = releaseContext(), root = 'release-assets', request = api, createRelease = (tag, files) => spawnSync('gh', ['release', 'create', tag, '--repo', REPOSITORY.name, '--verify-tag', '--target', context.sourceSha, '--prerelease', '--title', tag, '--notes', 'HQ Developer ID preview for Team 2CUPSQS986. Authenticate both archive and manifest with the included Sigstore provenance before installation. See INSTALL.txt. Updates preserve the pinned profile and activate on an accepted next launch.', ...files], { encoding: 'utf8', maxBuffer: 4 * 1024 ** 2 })) {
  const tag = assertReleaseContext(context);
  if (context.ref !== PRODUCTION_REF) throw new Error('Only production main pushes use this publisher');
  const files = [];
  for (const arch of ['arm64', 'x64']) {
    const { archive, manifestFile } = verifyReleaseFiles(root, arch, context);
    const attestation = findUnique(root, `hq-darwin-${arch}.sigstore.json`);
    const envelope = JSON.parse(fs.readFileSync(attestation, 'utf8'));
    if (!envelope.dsseEnvelope || !envelope.verificationMaterial) throw new Error('Missing release attestation');
    files.push(archive, manifestFile, attestation);
  }
  files.push(path.join(__dirname, 'INSTALL.txt'), path.join(__dirname, 'install-hq.command'));
  const expected = new Map(files.map(file => [path.basename(file), { size: fs.statSync(file).size, digest: `sha256:${hash(fs.readFileSync(file))}` }]));
  const repository = `repos/${REPOSITORY.name}`;
  const tagPath = `${repository}/git/ref/tags/${tag}`, releasePath = `${repository}/releases/tags/${tag}`;
  // Existing tags/releases include possibly completed prior effects; never overwrite or retry them here.
  if (request(tagPath).status !== 404 || request(releasePath).status !== 404) throw new Error('Release identity already exists or is unknown; reconcile before retry');
  const created = request(`${repository}/git/refs`, 'POST', { ref: `refs/tags/${tag}`, sha: context.sourceSha });
  if (created.status !== 201) throw new Error('Tag creation is unknown; inspect before retry');
  exactTag(request(tagPath), tag, context.sourceSha);
  const result = createRelease(tag, files);
  const release = request(releasePath);
  exactTag(request(tagPath), tag, context.sourceSha);
  if (release.status !== 200 || release.body?.tag_name !== tag || release.body.draft !== false || release.body.prerelease !== true || !Array.isArray(release.body.assets) || release.body.assets.length !== expected.size) throw new Error('Release publication is incomplete or unknown; inspect before retry');
  for (const [name, metadata] of expected) {
    const matches = release.body.assets.filter(asset => asset.name === name);
    if (matches.length !== 1 || matches[0].size !== metadata.size || matches[0].digest !== metadata.digest) throw new Error('Published release assets differ; retain evidence and stop');
  }
  return { tag, sourceSha: context.sourceSha, verified: true, responseLost: Boolean(result.error || result.status !== 0) };
}
if (require.main === module) {
  if (process.argv[2] === 'publish-production' && process.argv.length === 3) process.stdout.write(`${JSON.stringify(publishProduction())}\n`);
  else if (process.argv.length === 2) stageRelease();
  else throw new Error('Unexpected release command');
}
module.exports = { findUnique, verifyReleaseFiles, stageRelease, exactTag, publishProduction };
