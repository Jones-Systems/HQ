'use strict';

async function main() {
  let report = () => false;
  try { report = require('./native-diagnostics.cjs').fixtureReporter(__dirname, 'installer'); } catch {}
  let failureStage = 'setup-error';
  try {
    report('entered');
    const { readJson, validateInstallation, ensure } = require('../tools/updater/contract.cjs');
    const { prepareInstallation, activatePrepared } = require('../tools/updater/installer.cjs');

    failureStage = 'input-error';
    ensure(process.argv.length === 3, 'Synthetic installation requires one exact input file');
    const input = await readJson(process.argv[2]);
    report('input-read');
    const record = validateInstallation(input.record);
    ensure(record.synthetic, 'Native fixture cannot install a production identity');
    report('input-validated');

    failureStage = 'prepare-error';
    report('prepare-started');
    const prepared = await prepareInstallation({ record, candidate: input.candidate, mode: 'fresh' });
    report('prepared');

    failureStage = 'activation-error';
    report('activation-started');
    await activatePrepared(prepared.record);
    report('activated');
  } catch (error) {
    report(failureStage, error);
    throw error;
  }
}

main().then(() => { process.exitCode = 0; }).catch(error => { process.stderr.write(`${error.stack}\n`); process.exitCode = 1; });
