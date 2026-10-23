import { mkdir, open, readFile, rename, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
export interface JsonStore<T> { read(): Promise<T | null>; write(value: T): Promise<void> }
export function jsonStore<T>(directory: string, name: string, codec: { encode(value: string): Buffer; decode(value: Buffer): string } = { encode: value => Buffer.from(value), decode: value => value.toString('utf8') }): JsonStore<T> {
  const target = join(directory, name);
  let poisoned = false;
  return {
    async read() {
      if (poisoned) throw Error('Persistence effect unknown');
      try { const bytes = await readFile(target); if (bytes.length > 16 * 1024 * 1024) throw Error('State oversized'); return JSON.parse(codec.decode(bytes)) as T; }
      catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
    },
    async write(value) {
      if (poisoned) throw Error('Persistence effect unknown');
      await mkdir(directory, { recursive: true, mode: 0o700 });
      const temporary = join(directory, `.${name}-${randomUUID()}`);
      let created = false, renamed = false;
      try {
        const handle = await open(temporary, 'wx', 0o600); created = true;
        try { await handle.writeFile(codec.encode(JSON.stringify(value))); await handle.sync(); } finally { await handle.close(); }
        await rename(temporary, target); created = false; renamed = true;
        const dir = await open(directory, 'r'); try { await dir.sync(); } finally { await dir.close(); }
      } catch (error) { if (renamed) poisoned = true; throw error; }
      finally { if (created) await unlink(temporary); }
    },
  };
}
