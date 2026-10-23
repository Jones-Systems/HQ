'use strict';

const { readJson, validateInstallation, ensure } = require('../tools/updater/contract.cjs');
const { prepareInstallation, activatePrepared } = require('../tools/updater/installer.cjs');

async function main() {
  ensure(process.argv.length === 3, 'Synthetic installation requires one exact input file');
  const input = await readJson(process.argv[2]);
  const record = validateInstallation(input.record);
  ensure(record.synthetic, 'Native fixture cannot install a production identity');
  const prepared = await prepareInstallation({ record, candidate: input.candidate, mode: 'fresh' });
  await activatePrepared(prepared.record);
}

main().then(() => { process.exitCode = 0; }).catch(error => { process.stderr.write(`${error.stack}\n`); process.exitCode = 1; });
