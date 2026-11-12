// Owner-run validation of private Wiki sources. Prints aggregates only; see README.md in this directory.
//
//   node modules/wiki/core/scripts/validate-sources.ts --config <file> [--namespace bl|appdev] [--queries <file>] [--json]

import { EXIT_INTERNAL, runCli } from './cli.ts';
import { closeOwnedProcesses } from './processes.ts';

const fixedFailure = async () => {
  process.stderr.write('wiki-validate: internal error\n');
  try { await closeOwnedProcesses(); } finally { process.exit(EXIT_INTERNAL); }
};
// An unexpected failure must never print a stack: it can quote a path or a value.
process.on('uncaughtException', fixedFailure);
process.on('unhandledRejection', fixedFailure);
for (const [signal, code] of [['SIGINT', 130], ['SIGTERM', 143]] as const) {
  process.once(signal, async () => {
    try { await closeOwnedProcesses(); } finally { process.exit(code); }
  });
}

process.exitCode = await runCli(process.argv.slice(2), {
  stdout: (text) => void process.stdout.write(text),
  stderr: (text) => void process.stderr.write(text),
});
