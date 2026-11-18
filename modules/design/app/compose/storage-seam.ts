/**
 * Compile-time alignment of compose's storage stand-ins with STORE's renderer-safe seam.
 *
 * TYPES ONLY. Every import below is `import type` from `../storage/index.ts` (never `node.ts`), so
 * nothing here exists at runtime; test/renderer-safe.test.ts proves the runtime graph. The production workspace now supplies F1 adapters through the validated document bridge;
 * the unbridged workspace retains its labelled fakes.
 */
import type { CanvasStoragePort } from '../../canvas/src/contract.ts';
import type { CacheStoragePort } from '../../discovery/src/contract.ts';
import type { CacheBacking, CanvasDocumentPort } from '../storage/index.ts';

type Assert<T extends true> = T;
type Mutual<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
type Not<T extends boolean> = T extends true ? false : true;

/** T3's section-local storage view and STORE's `CanvasDocumentPort` are the same shape, so a T3 fake can stand in for it. */
export type CanvasStorageAligned = Assert<Mutual<CanvasStoragePort, CanvasDocumentPort>>;

/** What compose's canvas fake is typed as: T3's fake storage, proven assignable to STORE's canvas port. */
export type { CanvasDocumentPort };

/**
 * ESCALATED, not aligned. Discovery's cache port reads TEXT (`readDocument(key): Promise<string | null>`);
 * STORE's `CacheBacking` reads JSON DOCUMENTS (`getDocument(key): Promise<StoredDocument | null>`), and
 * STORE exports no discovery adapter. The two are not interchangeable without choosing a text-in-JSON
 * encoding, which would be a new storage contract. This assertion records the gap; it stays true until
 * STORE exports an adapter, at which point `createCachedCatalogReadPort` takes that adapter's output.
 */
export type CacheBackingIsNotDiscoveryCache = Assert<Not<CacheBacking extends Pick<CacheStoragePort, 'readDocument'> ? true : false>>;
