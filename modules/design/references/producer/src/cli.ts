/**
 * Local command line: `node producer/src/cli.ts <config.json>`. Prints aggregate counts and digests
 * only; errors print a stable code and a field path inside a source document, never a file path.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { parseConfig } from './config.ts';
import { ProducerError } from './errors.ts';
import { runProducer } from './run.ts';

async function main(argv: readonly string[]): Promise<number> {
  const configPath = argv[0];
  if (configPath === undefined || argv.length !== 1) { process.stderr.write('{"ok":false,"code":"usage"}\n'); return 2; }
  try {
    const stat = await fs.lstat(path.resolve(configPath));
    if (!stat.isFile() || stat.size > 1024 * 1024) throw new ProducerError('config-unreadable');
    const config = parseConfig(await fs.readFile(path.resolve(configPath)));
    const report = await runProducer(config);
    process.stdout.write(`${JSON.stringify({ ok: true, ...report })}\n`);
    return 0;
  } catch (error) {
    const code = error instanceof ProducerError ? error.code : 'unexpected-error';
    const where = error instanceof ProducerError ? error.where : null;
    process.stderr.write(`${JSON.stringify({ ok: false, code, where })}\n`);
    return 1;
  }
}

process.exitCode = await main(process.argv.slice(2));
