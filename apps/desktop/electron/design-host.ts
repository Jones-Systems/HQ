import { join } from 'node:path';
import type { DesignStorageResult, JsonValue, StoredDocument } from '@hq/contracts/services';
import { jsonValue, keys, record } from './services.js';

export interface DesignStore {
  readonly workspace: {
    getDocument(key: string): Promise<StoredDocument | null>;
    putDocument(key: string, value: JsonValue, options?: { readonly expectedRevision?: number | null }): Promise<StoredDocument>;
    listDocuments(prefix?: string): Promise<readonly string[]>;
  };
  readonly cache: { getDocument(key: string): Promise<StoredDocument | null> };
  close(): Promise<void>;
}
export const DOCUMENT_ROOTS = ['design/projects/', 'design/components/', 'design/flows/', 'design/compare/', 'design/annotations/', 'design.canvas.arrangement.v1/'] as const;
export const DESIGN_VALUE_CAP = 2_000_000;
export function allowedDocumentKey(value: unknown, prefix = false): value is string {
  return typeof value === 'string' && value.length <= 256 && value.trim() === value
    && !/[\u0000-\u001f\u007f-\u009f]/u.test(value)
    && !/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/.test(value)
    && !value.split('/').includes('..')
    && DOCUMENT_ROOTS.some(root => value.startsWith(root) && (prefix || value.length > root.length));
}
export async function openEmittedDesignStore(userData: string): Promise<DesignStore> {
  const module = await import(new URL('./design-host/modules/design/app/storage/node.js', import.meta.url).href) as { openDesignStorage(options: { root: string }): Promise<DesignStore> };
  return module.openDesignStorage({ root: join(userData, 'design-store') });
}
/** Lazy singleton, with an idempotent close that drains every admitted operation before closing. */
export function createDesignHost(open: () => Promise<DesignStore>) {
  let store: Promise<DesignStore> | undefined, closing = false, closePromise: Promise<void> | undefined;
  const active = new Set<Promise<unknown>>();
  async function execute(route: unknown, params: unknown): Promise<DesignStorageResult<unknown>> {
    if (closing) return { ok: false, kind: 'unavailable' };
    try {
      if (!record(params)) return { ok: false, kind: 'invalid' };
      if (route === 'cache.get') {
        if (!keys(params, ['key']) || params.key !== 'design.discovery.catalog') return { ok: false, kind: 'invalid' };
      } else if (route === 'doc.list') {
        if (!keys(params, ['prefix']) || !allowedDocumentKey(params.prefix, true)) return { ok: false, kind: 'invalid' };
      } else if (route === 'doc.get' || route === 'doc.put') {
        if (!keys(params, route === 'doc.put' ? ['key', 'value'] : ['key'], route === 'doc.put' ? ['expectedRevision'] : []) || !allowedDocumentKey(params.key)) return { ok: false, kind: 'invalid' };
        if (route === 'doc.put' && (!(!Object.hasOwn(params, 'expectedRevision') || params.expectedRevision === null || (Number.isSafeInteger(params.expectedRevision) && (params.expectedRevision as number) >= 0)) || !jsonValue(params.value) || Buffer.byteLength(JSON.stringify(params.value)) > DESIGN_VALUE_CAP)) return { ok: false, kind: 'invalid' };
      } else return { ok: false, kind: 'invalid' };
    } catch { return { ok: false, kind: 'invalid' }; }
    let current: DesignStore;
    try { current = await (store ??= open()); } catch { return { ok: false, kind: 'unavailable' }; }
    const p = params as Record<string, unknown>;
    try {
      switch (route) {
        case 'cache.get': return { ok: true, value: await current.cache.getDocument(p.key as string) };
        case 'doc.get': return { ok: true, value: await current.workspace.getDocument(p.key as string) };
        case 'doc.list': return { ok: true, value: [...await current.workspace.listDocuments(p.prefix as string)] };
        default: return { ok: true, value: await current.workspace.putDocument(p.key as string, p.value as JsonValue, Object.hasOwn(p, 'expectedRevision') ? { expectedRevision: p.expectedRevision as number | null } : {}) };
      }
    } catch (error) {
      const code = record(error) ? error.code : (error instanceof Error && 'code' in error ? error.code : undefined);
      if (route !== 'doc.put' || code === 'closed') return { ok: false, kind: 'unavailable' };
      if (code === 'conflict') return { ok: false, kind: 'conflict' };
      if (code === 'read-only') return { ok: false, kind: 'read-only' };
      if (code === 'invalid-argument' || code === 'too-large') return { ok: false, kind: 'invalid' };
      return { ok: false, kind: 'unknown' };
    }
  }
  return {
    call(route: unknown, params: unknown) {
      const operation = execute(route, params);
      active.add(operation);
      void operation.finally(() => active.delete(operation));
      return operation;
    },
    close(): Promise<void> {
      if (!closePromise) {
        closing = true;
        closePromise = (async () => {
          await Promise.allSettled([...active]);
          if (store) {
            let current: DesignStore;
            try { current = await store; } catch { return; }
            await current.close();
          }
        })();
      }
      return closePromise;
    },
  };
}
