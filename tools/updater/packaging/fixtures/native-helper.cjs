'use strict';

const { spawn } = require('node:child_process');
const path = require('node:path');
const { fixtureReporter } = require('../../synthetic-native/native-diagnostics.cjs');
const report = fixtureReporter(path.resolve(__dirname, '../../synthetic-native'), 'helper');

async function main() {
  report('entered');
  const { createNativeAdapter } = require('./native.cjs');
  const { readJson, validateInstallation, recordPath, ensure } = require('./contract.cjs');
  const { runHelper } = require('./helper-implementation.cjs');
  const args = process.argv.slice(2);
  ensure(args.length === 4 && args[0] === '--record' && args[2] === '--operation', 'Invalid synthetic helper invocation');
  const record = validateInstallation(await readJson(args[1]));
  ensure(record.synthetic && recordPath(record.targetPath) === args[1], 'Synthetic helper cannot operate a production installation');
  const native = createNativeAdapter({ spawn: (file, argv, options) => spawn(file, options.env.ELECTRON_RUN_AS_NODE === '1' ? argv : [...argv, '--use-mock-keychain'], options) });
  const result = await runHelper({ record, operationId: args[3], adapters: { native } });
  report('completed');
  return result;
}

main().catch(error => { report('error', error); process.exitCode = 1; });
