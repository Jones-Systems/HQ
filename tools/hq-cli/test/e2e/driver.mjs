import { run } from '../../src/cli.ts';
const [instant, ...args] = process.argv.slice(2);
const { result, exitCode } = await run(args, { clock: () => new Date(instant) });
process.stdout.write(JSON.stringify(result) + '\n');
process.exitCode = exitCode;
