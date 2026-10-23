'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { REPOSITORY, WORKFLOW } = require('./identity.cjs');

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

function stageRelease(environment = process.env) {
  const arch = environment.HQ_PACKAGE_ARCH;
  if (!['arm64', 'x64'].includes(arch)) throw new Error('Invalid release architecture');
  const basename = `hq-darwin-${arch}`;
  const archive = findUnique('release-input', `${basename}.zip`), manifestFile = findUnique('release-input', `${basename}.json`);
  const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
  const bytes = fs.readFileSync(archive);
  if (manifest.sourceSha !== environment.GITHUB_SHA || manifest.releaseTag !== environment.GITHUB_REF_NAME || manifest.runId !== environment.GITHUB_RUN_ID || manifest.runAttempt !== Number(environment.GITHUB_RUN_ATTEMPT) || manifest.workflow !== WORKFLOW || manifest.repository?.id !== REPOSITORY.id || manifest.repository?.ownerId !== REPOSITORY.ownerId || manifest.architecture !== arch || manifest.archive?.name !== `${basename}.zip` || manifest.archive.size !== bytes.length || manifest.archive.sha256 !== createHash('sha256').update(bytes).digest('hex')) throw new Error('Downloaded release artifact identity differs');
  const bundle = fs.readFileSync(environment.ATTESTATION_BUNDLE);
  const parsed = JSON.parse(bundle);
  if (!parsed.dsseEnvelope || !parsed.verificationMaterial) throw new Error('Attestation action did not return a JSON Sigstore bundle');
  fs.mkdirSync('release-assets');
  fs.copyFileSync(archive, path.join('release-assets', `${basename}.zip`), fs.constants.COPYFILE_EXCL);
  fs.copyFileSync(manifestFile, path.join('release-assets', `${basename}.json`), fs.constants.COPYFILE_EXCL);
  fs.writeFileSync(path.join('release-assets', `${basename}.sigstore.json`), bundle, { flag: 'wx' });
}

if (require.main === module) stageRelease();
module.exports = { findUnique, stageRelease };
