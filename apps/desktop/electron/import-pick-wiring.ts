import { open } from 'node:fs/promises';
import { createImportPicker, type ImportPickerDependencies, type ImportPickerDialogOptions, type ImportPickerResult } from './import-picker.js';

/** The Imports UI collects the explicit rights statement before opening this native picker. */
export const IMPORT_DIALOG_TITLE = 'Choose design files';
export const IMPORT_DIALOG_BUTTON = 'Import selected files';
export const IMPORT_DIALOG_MESSAGE = 'Choose files covered by the rights statement you selected in HQ.';

export interface ImportPickDialogOptions extends ImportPickerDialogOptions {
  title: string;
  buttonLabel: string;
  message: string;
}

/** The slice of a BrowserWindow the wiring needs. */
export interface ImportPickWindow {
  isDestroyed(): boolean;
  on(event: 'close' | 'closed', listener: () => void): unknown;
  removeListener(event: 'close' | 'closed', listener: () => void): unknown;
}

export interface ImportPickWiringOptions<W extends ImportPickWindow> {
  /** The window that owns the dialog. Absent or destroyed: nothing can be chosen. */
  window(): W | null | undefined;
  showOpenDialog(window: W, options: ImportPickDialogOptions): Promise<{ canceled: boolean; filePaths: string[] }>;
  /** Defaults to Node's promise-based fs. */
  fs?: ImportPickerDependencies['fs'];
}

export interface ImportPickWiring {
  /** Resolves with the picker result. A window that closes, or `cancelPending`, settles it as canceled. */
  pick(): Promise<ImportPickerResult>;
  /** Settles the pending pick, if any, as canceled. Idempotent. */
  cancelPending(): void;
}

/** Node file handles satisfy the picker's descriptor port structurally; the compiler checks it here. */
export const nodeImportFs: ImportPickerDependencies['fs'] = { open: (path, flags) => open(path, flags) };

const rejected = (reason: 'unavailable'): ImportPickerResult => ({ status: 'rejected', reason });

export function createImportPickWiring<W extends ImportPickWindow>(options: ImportPickWiringOptions<W>): ImportPickWiring {
  const fs = options.fs ?? nodeImportFs;
  let settleCurrent: ((result: ImportPickerResult) => void) | null = null;
  return {
    pick() {
      const parent = options.window();
      if (!parent || parent.isDestroyed()) return Promise.resolve(rejected('unavailable'));
      // One dialog at a time. A second request while one is open changes nothing.
      if (settleCurrent) return Promise.resolve<ImportPickerResult>({ status: 'canceled' });
      return new Promise<ImportPickerResult>((resolve) => {
        let settled = false;
        const onClose = () => settle({ status: 'canceled' });
        function settle(result: ImportPickerResult): void {
          if (settled) return;
          settled = true;
          settleCurrent = null;
          try { parent!.removeListener('close', onClose); parent!.removeListener('closed', onClose); } catch { /* A destroyed window has nothing left to detach. */ }
          resolve(result);
        }
        settleCurrent = settle;
        parent.on('close', onClose);
        parent.on('closed', onClose);
        const picker = createImportPicker({
          fs,
          // Once settled, a late answer from the native dialog must not be read from disk.
          showOpenDialog: async (dialogOptions) => {
            const selection = await options.showOpenDialog(parent, {
              ...dialogOptions, title: IMPORT_DIALOG_TITLE, buttonLabel: IMPORT_DIALOG_BUTTON, message: IMPORT_DIALOG_MESSAGE,
            });
            return settled ? { canceled: true, filePaths: [] } : selection;
          },
        });
        picker.pick().then(settle, () => settle(rejected('unavailable')));
      });
    },
    cancelPending() { settleCurrent?.({ status: 'canceled' }); },
  };
}
