'use strict';

const { spawn } = require('node:child_process');
const { createNativeAdapter } = require('./native.cjs');
const { readJson, validateInstallation, recordPath, ensure } = require('./contract.cjs');
const { runHelper } = require('./helper-implementation.cjs');

async function main() {
  const args = process.argv.slice(2);
  ensure(args.length === 4 && args[0] === '--record' && args[2] === '--operation', 'Invalid synthetic helper invocation');
  const record = validateInstallation(await readJson(args[1]));
  ensure(record.synthetic && recordPath(record.targetPath) === args[1], 'Synthetic helper cannot operate a production installation');
  const native = createNativeAdapter({ spawn: (file, argv, options) => spawn(file, options.env.ELECTRON_RUN_AS_NODE === '1' ? argv : [...argv, '--use-mock-keychain'], options) });
  return runHelper({ record, operationId: args[3], adapters: { native } });
}

main().catch(error => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
