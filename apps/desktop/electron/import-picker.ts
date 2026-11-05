import { constants } from 'node:fs';
import { basename, win32 } from 'node:path';

export interface ImportPickerDialogOptions {
  properties: ('openFile' | 'multiSelections')[];
  filters: { name: string; extensions: string[] }[];
}

export interface ImportPickerFileHandle {
  stat(): Promise<{ size: number; isFile(): boolean }>;
  read(buffer: Uint8Array, offset: number, length: number, position: number): Promise<{ bytesRead: number }>;
  close(): Promise<void>;
}

export interface ImportPickerDependencies {
  showOpenDialog(options: ImportPickerDialogOptions): Promise<{ canceled: boolean; filePaths: string[] }>;
  fs: { open(path: string, flags: number): Promise<ImportPickerFileHandle> };
}

export interface PickedImportFile {
  readonly name: string;
  readonly mediaType: 'image/png';
  readonly bytes: Uint8Array;
}

export type ImportPickerRejection = 'unavailable' | 'invalid-selection' | 'too-many-files'
  | 'not-regular-file' | 'file-too-large' | 'total-too-large' | 'invalid-png' | 'file-changed' | 'read-limit';
export type ImportPickerResult = { readonly status: 'canceled' }
  | { readonly status: 'rejected'; readonly reason: ImportPickerRejection }
  | { readonly status: 'picked'; readonly files: readonly PickedImportFile[] };

// Kept local to avoid loading storage or the host; tests bind these caps to their owners.
const BLOB_BYTES = 16 * 1024 * 1024;
const TOTAL_BYTES = 64 * 1024 * 1024;
const FILE_COUNT = 256;
const READ_BYTES = 64 * 1024;
const READ_CALLS = 4096;
const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10] as const;
const rejected = (reason: ImportPickerRejection): ImportPickerResult => ({ status: 'rejected', reason });

/** Unwired backend: construction is inert; only pick uses the injected capabilities. */
export function createImportPicker({ showOpenDialog, fs }: ImportPickerDependencies): { pick(): Promise<ImportPickerResult> } {
  return {
    async pick() {
      try {
        // Fail closed where no-follow/nonblocking descriptor opening is unavailable.
        if (!(constants.O_NOFOLLOW > 0) || !(constants.O_NONBLOCK > 0)) return rejected('unavailable');
        const selection = await showOpenDialog({
          properties: ['openFile', 'multiSelections'],
          filters: [{ name: 'PNG images', extensions: ['png'] }],
        });
        if (selection.canceled) return { status: 'canceled' };
        if (!Array.isArray(selection.filePaths)) return rejected('invalid-selection');
        if (selection.filePaths.length > FILE_COUNT) return rejected('too-many-files');
        if (!selection.filePaths.length) return { status: 'canceled' };
        const files: PickedImportFile[] = [];
        let total = 0;
        for (const path of selection.filePaths) {
          if (typeof path !== 'string' || !path) return rejected('invalid-selection');
          const name = win32.basename(basename(path));
          if (!name || name === '.' || name === '..') return rejected('invalid-selection');
          // O_NONBLOCK prevents a FIFO from hanging before fstat can refuse it.
          const file = await fs.open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK | constants.O_NOCTTY);
          try {
            const stat = await file.stat();
            if (!stat.isFile()) return rejected('not-regular-file');
            if (!Number.isSafeInteger(stat.size) || stat.size < 0) return rejected('file-changed');
            if (stat.size > BLOB_BYTES) return rejected('file-too-large');
            if (stat.size > TOTAL_BYTES - total) return rejected('total-too-large');
            if (stat.size < PNG_SIGNATURE.length) return rejected('invalid-png');
            const bytes = new Uint8Array(stat.size);
            let position = 0;
            let calls = 0;
            while (position < bytes.length) {
              if (++calls > READ_CALLS) return rejected('read-limit');
              const length = Math.min(READ_BYTES, bytes.length - position);
              const { bytesRead } = await file.read(bytes, position, length, position);
              if (!Number.isSafeInteger(bytesRead) || bytesRead <= 0 || bytesRead > length) return rejected('file-changed');
              position += bytesRead;
              if (position >= PNG_SIGNATURE.length && !PNG_SIGNATURE.every((byte, index) => bytes[index] === byte)) return rejected('invalid-png');
            }
            // A one-byte EOF probe and descriptor recheck reject observed growth/truncation.
            const eof = await file.read(new Uint8Array(1), 0, 1, position);
            if (eof.bytesRead !== 0) return rejected('file-changed');
            const after = await file.stat();
            if (!after.isFile() || after.size !== stat.size) return rejected('file-changed');
            total += bytes.length;
            files.push({ name, mediaType: 'image/png', bytes });
          } finally {
            await file.close();
          }
        }
        return { status: 'picked', files };
      } catch {
        return rejected('unavailable');
      }
    },
  };
}
