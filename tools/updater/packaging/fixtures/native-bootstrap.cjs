'use strict';

const { fixtureReporter } = require('./native-diagnostics.cjs');

async function run(options) {
  const report = fixtureReporter(__dirname, 'bootstrap');
  report('entered');
  try {
    const result = await require('../tools/updater/bootstrap.cjs').run({
      ...options,
      importMain: () => { report('import-main'); return options.importMain(); },
    });
    report('completed');
    return result;
  } catch (error) { report('error', error); throw error; }
}
module.exports = { run };
