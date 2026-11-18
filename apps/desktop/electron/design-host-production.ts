import { createDesignHost, openEmittedDesignStore, type DesignStore } from './design-host.js';
import type { ImportPickerResult } from './import-picker.js';
import type { SaveBytes } from './save-dialog.js';

export interface ProductionDesignHostOptions {
  /** Where the local Design store lives. Read when the store first opens. */
  profileDir(): string;
  save: SaveBytes;
  pick: { pick(): Promise<ImportPickerResult>; cancelPending(): void };
  /** Replaced by tests. */
  open?: (profileDir: string, options: { readonly imports: 'enabled' }) => Promise<DesignStore>;
}

/**
 * The application's Design host. Imports are enabled and the native picker is injected. Export stays disabled
 * because the opened store never advertises it, whatever this host is given to save with.
 * Closing the host first settles a pending pick as canceled, so an open dialog cannot hold shutdown.
 */
export function createProductionDesignHost(options: ProductionDesignHostOptions) {
  const open = options.open ?? openEmittedDesignStore;
  const host = createDesignHost(() => open(options.profileDir(), { imports: 'enabled' }), options.save, () => options.pick.pick());
  return {
    ready: () => host.ready(),
    call: (route: unknown, params: unknown) => host.call(route, params),
    close(): Promise<void> {
      options.pick.cancelPending();
      return host.close();
    },
  };
}
