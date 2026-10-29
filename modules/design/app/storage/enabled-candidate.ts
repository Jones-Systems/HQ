import { openFileStore } from '../../../../packages/design-store/src/index.ts';
import { bindCache } from './backing.ts';
import { createDesignExport } from './design-export.ts';
import type { OpenDesignStorageOptions } from './node.ts';
import { createTransactionRuntime } from './transactions.ts';

/** Opt-in qualification construction; candidate routes do not imply product acceptance. */
export async function openEnabledCandidateStorage(options: OpenDesignStorageOptions) {
  const { store } = await openFileStore({ ...options, schemaVersion: options.schemaVersion ?? 1 });
  try {
    const runtime = await createTransactionRuntime(store, true);
    await runtime.initialize();
    const cache = await bindCache(store);
    return Object.freeze({
      // The engine's frozen status stays disabled; only this construction advertises candidate routes.
      transactions: Object.freeze({ ...runtime.port, status: Object.freeze({ accepted: true, state: 'candidate' }) }),
      workspace: runtime.port.workspace,
      cache,
      exportBundle: createDesignExport(runtime),
      close: () => store.close(),
    });
  } catch (error) {
    await store.close();
    throw error;
  }
}
