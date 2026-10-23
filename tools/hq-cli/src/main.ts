import { run } from './cli.ts';
export async function main(): Promise<void> {
  const { result, exitCode } = await run(process.argv.slice(2));
  process.stdout.write(JSON.stringify(result) + '\n');
  process.exitCode = exitCode;
}
