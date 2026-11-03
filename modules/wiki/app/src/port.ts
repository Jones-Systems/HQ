// The renderer-side shapes of the Wiki assembly. Everything here is module-local and structural: the
// canonical `ModulePort` lives in `@hq/contracts` (T2's), and `WikiHostPort` is the preload bridge of
// iface.wiki-host-ipc.001. Neither is imported, so a node test can load the module without the workspace.

import type { WikiService, WikiServiceMethodName } from '../../contract/src/index.ts';

/**
 * What the preload bridge hands the renderer: exactly the seven `WikiService` methods. Results cross a trust
 * boundary, so they are `unknown` until the client has checked them against the contract validators.
 * `refresh` and home migration are host-only and are deliberately not part of this shape.
 */
export type WikiHostPort = {
  readonly [K in WikiServiceMethodName]: (...args: Parameters<WikiService[K]>) => Promise<unknown>;
};

/** Structurally identical to `ModulePort` in `@hq/contracts`; T2 proves assignability when it mounts Wiki. */
export interface WikiModulePort {
  readonly context: { readonly id: string; readonly name: string };
  readonly destination: string;
  readonly appearance: 'light' | 'dark';
  readonly desktop: {
    readonly platform: 'desktop' | 'browser';
    readonly versions: { readonly electron: string | null };
  };
  readonly navigate: (destination: string) => void;
}
