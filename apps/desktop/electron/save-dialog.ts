import { randomUUID } from 'node:crypto';
import { open, rename, unlink } from 'node:fs/promises';
import { dirname, join } from 'node:path';

export interface SaveRequest { readonly defaultPath: string; readonly filters: readonly { readonly name: string; readonly extensions: readonly string[] }[] }
export type ChooseSave = (request: SaveRequest) => Promise<string | null>;
export type SaveBytes = (bytes: Uint8Array, request: SaveRequest) => Promise<{ saved: boolean }>;

/** The selected path and same-directory temporary file remain main-only. */
export function createSaveDialog(choose: ChooseSave): SaveBytes {
  return async (bytes, request) => {
    const destination = await choose(request);
    if (destination === null) return { saved: false };
    const temporary = join(dirname(destination), `.hq-export-${randomUUID()}`);
    let created = false;
    try {
      const file = await open(temporary, 'wx', 0o600);
      created = true;
      try { await file.writeFile(bytes); await file.sync(); }
      finally { await file.close(); }
      await rename(temporary, destination);
      created = false;
      return { saved: true };
    } finally { if (created) await unlink(temporary); }
  };
}
