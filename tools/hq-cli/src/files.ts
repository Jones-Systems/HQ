import { openSync, closeSync, readSync, writeFileSync, fsyncSync, renameSync, rmSync } from 'node:fs';
import { dirname, basename, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { CliError, usage } from './transport.ts';
export const MAX_RESULT_FILE_BYTES = 32 * 1024 * 1024;
export function readJSON(path: string, limit = 4 * 1024 * 1024): any {
  let fd: number | undefined;
  try {
    fd = openSync(path, 'r');
    const bytes = Buffer.alloc(limit + 1);
    let size = 0;
    while (size < bytes.length) { const count = readSync(fd, bytes, size, bytes.length - size, null); if (!count) break; size += count; }
    if (size > limit) throw usage('Input file exceeds its size limit.');
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, size)));
  } catch (error) {
    if (error instanceof CliError) throw error;
    throw usage(error instanceof SyntaxError ? 'Input file must contain valid JSON.' : 'Cannot read a bounded UTF-8 JSON input file.');
  }
  finally { if (fd !== undefined) closeSync(fd); }
}
export function atomicJSON(path: string, value: unknown): void {
  const temp = join(dirname(path), `.${basename(path)}.${randomUUID()}.tmp`);
  let fd: number | undefined;
  const cleanup = () => { if (fd !== undefined) { closeSync(fd); fd = undefined; } rmSync(temp, { force: true }); };
  const interrupt = () => { cleanup(); process.exit(130); };
  const terminate = () => { cleanup(); process.exit(143); };
  process.once('SIGINT', interrupt); process.once('SIGTERM', terminate);
  try {
    fd = openSync(temp, 'wx', 0o600);
    writeFileSync(fd, JSON.stringify(value) + '\n'); fsyncSync(fd); closeSync(fd); fd = undefined;
    renameSync(temp, path);
    syncDirectory(dirname(path));
  } catch { throw usage('Could not atomically write the caller-owned intent file.', 'intent_file'); }
  finally {
    cleanup();
    // A signal that arrives during this synchronous write is dispatched on a later
    // poll phase. Keep the handlers until then; removing them now would drop it.
    setImmediate(() => setImmediate(() => { process.removeListener('SIGINT', interrupt); process.removeListener('SIGTERM', terminate); }));
  }
}
// Persist the rename itself; platforms that cannot sync a directory keep file-level durability.
function syncDirectory(path: string): void {
  let fd: number | undefined;
  try { fd = openSync(path, 'r'); fsyncSync(fd); }
  catch (error) { if (!['EISDIR', 'EPERM', 'EINVAL', 'ENOTSUP'].includes((error as { code?: string }).code ?? '')) throw error; }
  finally { if (fd !== undefined) closeSync(fd); }
}
