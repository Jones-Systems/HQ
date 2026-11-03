/**
 * Node-only wiring: opens the T9 file store and binds the narrow adapters. Main-process code only;
 * the renderer must import `./index.ts` instead. Opening a store here is not production IPC or
 * preload hosting, which stay with the shell owner.
 */
import { openFileStore, type OpenFileStoreOptions } from '../../../../packages/design-store/src/index.ts';
import type { StoragePort } from '../../../../packages/design-store/src/contract.ts';
import { asReader, bindCache, bindWorkspace, type CacheBacking, type WorkspaceBacking } from './backing.ts';
import { createCanvasStorage, type CanvasDocumentPort } from './canvas.ts';
import { createRequestsExport, type RequestsExportPort } from './export.ts';
import { createOutboxAdapter, type OutboxAdapter, type OutboxRecordShape } from './outbox.ts';
import { createRequestsStoragePort, type RequestsStoragePort } from './requests.ts';

import { createTransactionRuntime, type DesignTransactions } from './transactions.ts';
import { createDesignExport, type DesignExportPort } from './design-export.ts';
export { TRANSACTION_STATUS, IMPORT_TRANSACTION_SCHEMA, IMPORT_LIMITS, createImportsStorage } from './transactions.ts';
export type { DesignTransactions, EngineResult, RecoveryReport, RepairReport, StorageDiagnostics } from './transactions.ts';
export type { DesignExportPort, DesignExportReport, DesignOmission } from './design-export.ts';

export interface DesignStorage {
  readonly transactions: DesignTransactions;
  readonly exportBundle: DesignExportPort;
  readonly workspace: WorkspaceBacking;
  readonly cache: CacheBacking;
  readonly requests: RequestsStoragePort;
  readonly canvas: CanvasDocumentPort;
  /** Outbox over the workspace namespace; the connector section supplies its record parser. */
  outbox<R extends OutboxRecordShape, I extends string = string>(parse?: (value: unknown) => R): OutboxAdapter<R, I>;
  /** Disabled until conformance; this wiring never enables it. */
  readonly requestsExport: RequestsExportPort;
  close(): Promise<void>;
}

export interface OpenDesignStorageOptions extends Omit<OpenFileStoreOptions, 'schemaVersion'> {
  readonly schemaVersion?: number;
}

export async function openDesignStorage(options: OpenDesignStorageOptions): Promise<DesignStorage> {
  const { store } = await openFileStore({ ...options, schemaVersion: options.schemaVersion ?? 1 });
  return bindDesignStorage(store);
}

/** Binds an already-open store (tests use this with a fault-injecting filesystem). */
export async function bindDesignStorage(store: StoragePort): Promise<DesignStorage> {
  const workspace = await bindWorkspace(store);
  const cache = await bindCache(store);
  const runtime = await createTransactionRuntime(store);
  await runtime.initialize();
  return Object.freeze({
    transactions: runtime.port,
    exportBundle: createDesignExport(runtime),
    workspace,
    cache,
    requests: createRequestsStoragePort({ workspace, cache }),
    canvas: createCanvasStorage(workspace),
    outbox: <R extends OutboxRecordShape, I extends string = string>(parse?: (value: unknown) => R) =>
      createOutboxAdapter<R, I>(workspace, parse ? { parse } : {}),
    requestsExport: createRequestsExport(asReader(workspace)),
    close: () => store.close(),
  });
}
