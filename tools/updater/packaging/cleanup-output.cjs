'use strict';

const fs = require('node:fs');
const path = require('node:path');

function cleanupOutput(environment = process.env) {
  const output = environment.HQ_PACKAGE_OUTPUT;
  if (!output || !path.isAbsolute(output) || path.resolve(output) !== output) throw new Error('Exact package output is required');
  const marker = path.join(output, '.hq-package-owner.json');
  if (!fs.existsSync(marker)) return;
  if (fs.lstatSync(output).isSymbolicLink() || fs.lstatSync(marker).isSymbolicLink()) throw new Error('Package cleanup identity changed');
  const owner = JSON.parse(fs.readFileSync(marker, 'utf8'));
  if (owner.output !== output || owner.sourceSha !== environment.GITHUB_SHA || String(owner.buildSequence) !== environment.GITHUB_RUN_ID || owner.architecture !== environment.HQ_PACKAGE_ARCH) throw new Error('Package output belongs to another invocation');
  fs.rmSync(output, { recursive: true, force: false });
  if (fs.existsSync(output)) throw new Error('Package cleanup did not complete');
}

if (require.main === module) cleanupOutput();
module.exports = { cleanupOutput };
