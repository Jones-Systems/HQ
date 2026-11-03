import { createHash } from 'node:crypto';
import { join } from 'node:path';
import type { DesignStorageResult, JsonValue, StoredDocument } from '@hq/contracts/services';
import type { BlobDigest, BlobRef, EventRead, ImportWriteOp } from '@hq/contracts/design-records';
import { ReadersWriterGate } from './readers-writer-gate.js';
import type { SaveBytes } from './save-dialog.js';
import { jsonValue, keys, record } from './services.js';

type NodeResult = { readonly ok: true; readonly value: unknown } | { readonly ok: false; readonly kind: 'unavailable'; readonly reason: string };
const publicResult = (result: NodeResult): DesignStorageResult<unknown> => result.ok ? result : result.reason === 'disabled' ? disabled() : { ok: false, kind: 'unavailable' };
interface WorkspaceRecords {
  getDocument(key: string): Promise<StoredDocument | null>;
  putDocument(key: string, value: JsonValue, options?: { readonly expectedRevision?: number | null }): Promise<StoredDocument>;
  listDocuments(prefix?: string): Promise<readonly string[]>;
  putBlob(bytes: Uint8Array, options?: { readonly expectedDigest?: BlobDigest }): Promise<BlobRef>;
  getBlob(digest: string): Promise<Uint8Array | null>;
  hasBlob(digest: string): Promise<boolean>;
  appendEvent(stream: string, event: { readonly type: string; readonly payload: JsonValue; readonly clientEventId?: string }): Promise<{ readonly seq: number; readonly payload: JsonValue }>;
  readEvents(stream: string): Promise<EventRead>;
}
export interface DesignStore {
  readonly transactions: {
    readonly workspace: WorkspaceRecords;
    readonly status: { readonly accepted: boolean; readonly state: string };
    recover(): Promise<{ readonly ok: boolean; readonly reason?: string }>;
    commit(ops: readonly ImportWriteOp[]): Promise<NodeResult>;
    repair(txnId: string): Promise<NodeResult>;
    diagnostics(): Promise<NodeResult>;
  };
  readonly exportBundle: {
    readonly status: { readonly state: string; readonly reason?: string };
    preview(exportedAt: string): Promise<NodeResult>;
    build(exportedAt: string): Promise<NodeResult>;
  };
  readonly workspace: {
    getDocument(key: string): Promise<StoredDocument | null>;
    putDocument(key: string, value: JsonValue, options?: { readonly expectedRevision?: number | null }): Promise<StoredDocument>;
    listDocuments(prefix?: string): Promise<readonly string[]>;
  };
  readonly cache: { getDocument(key: string): Promise<StoredDocument | null>; putDocument(key: string, value: JsonValue): Promise<StoredDocument> };
  close(): Promise<void>;
}
export const DOCUMENT_ROOTS = ['design/projects/', 'design/components/', 'design/flows/', 'design/compare/', 'design/annotations/', 'design.canvas.arrangement.v1/', 'design/requests/', 'design/connector/outbox/', 'design/connector/evidence/', 'design/references/'] as const;
export const DESIGN_BLOB_CAP = 16 * 1024 * 1024;
const disabled = () => ({ ok: false as const, kind: 'unavailable' as const, reason: 'disabled' as const });
const digest = (v: unknown): v is BlobDigest => typeof v === 'string' && /^sha256:[0-9a-f]{64}$/.test(v);
const eventType = (stream: unknown) => typeof stream === 'string' && allowedDocumentKey(stream) && stream.startsWith('design/requests/') ? 'requests.event-bytes' : stream === 'design/imports' ? 'imports.event' : null;
export const DESIGN_VALUE_CAP = 2_000_000;
export function allowedDocumentKey(value: unknown, prefix = false): value is string {
  return typeof value === 'string' && value.length <= 256 && value.trim() === value
    && !/[\u0000-\u001f\u007f-\u009f]/u.test(value)
    && !/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/.test(value)
    && !value.split('/').includes('..')
    && DOCUMENT_ROOTS.some(root => value.startsWith(root) && (prefix || value.length > root.length));
}
function validImportOps(value: unknown): value is readonly ImportWriteOp[] {
  if (!Array.isArray(value) || !value.length || value.length > 10_000) return false;
  let bytes = 0;
  for (const op of value) {
    if (!record(op) || op.namespace !== 'workspace') return false;
    if (op.op === 'put-document') {
      if (!keys(op, ['op', 'namespace', 'key', 'value', 'expectedRevision']) || !allowedDocumentKey(op.key) || !jsonValue(op.value)
        || !(op.expectedRevision === null || (typeof op.expectedRevision === 'string' && /^[1-9][0-9]*$/.test(op.expectedRevision) && Number.isSafeInteger(Number(op.expectedRevision))))) return false;
      bytes += Buffer.byteLength(JSON.stringify(op));
    } else if (op.op === 'append-event') {
      if (!keys(op, ['op', 'namespace', 'stream', 'payload', 'expectedSeq']) || !eventType(op.stream) || !jsonValue(op.payload) || !Number.isSafeInteger(op.expectedSeq) || (op.expectedSeq as number) < 0) return false;
      bytes += Buffer.byteLength(JSON.stringify(op));
    } else if (op.op === 'put-blob') {
      if (!keys(op, ['op', 'namespace', 'digest', 'mediaType', 'bytes']) || !digest(op.digest) || !(op.bytes instanceof Uint8Array) || op.bytes.byteLength > DESIGN_BLOB_CAP
        || typeof op.mediaType !== 'string' || !op.mediaType.trim() || op.mediaType.length > 256 || 'sha256:' + createHash('sha256').update(op.bytes).digest('hex') !== op.digest) return false;
      bytes += Buffer.byteLength(JSON.stringify({ ...op, bytes: Buffer.from(op.bytes).toString('base64') }));
    } else return false;
    if (bytes > 64 * 1024 * 1024) return false;
  }
  return true;
}
function checkedDocument(value: StoredDocument | null): StoredDocument | null {
  if (value !== null && (!jsonValue(value.value) || Buffer.byteLength(JSON.stringify(value.value)) > DESIGN_VALUE_CAP)) throw new Error('Unavailable document');
  return value;
}
export async function openEmittedDesignStore(userData: string): Promise<DesignStore> {
  const module = await import(new URL('./design-host/modules/design/app/storage/node.js', import.meta.url).href) as { openDesignStorage(options: { root: string }): Promise<DesignStore> };
  return module.openDesignStorage({ root: join(userData, 'design-store') });
}
/** Lazy singleton, with an idempotent close that drains every admitted operation before closing. */
export function createDesignHost(open: () => Promise<DesignStore>, save?: SaveBytes) {
  const gate = new ReadersWriterGate();
  let store: Promise<DesignStore> | undefined, closing = false, closePromise: Promise<void> | undefined;
  const active = new Set<Promise<unknown>>();
  function getStore(): Promise<DesignStore> { return store ??= open().then(async current => {
      try {
        const recovered = await current.transactions.recover();
        if (!recovered.ok && recovered.reason !== 'disabled') throw new Error('Recovery unavailable');
        return current;
      } catch (error) { await current.close(); throw error; }
    }); }
  async function execute(route: unknown, params: unknown): Promise<DesignStorageResult<unknown>> {
    try {
      if (!record(params)) return { ok: false, kind: 'invalid' };
      if (route === 'cache.put') {
        if (!keys(params, ['key', 'value']) || params.key !== 'design.discovery.catalog' || !jsonValue(params.value) || Buffer.byteLength(JSON.stringify(params.value)) > DESIGN_VALUE_CAP) return { ok: false, kind: 'invalid' };
      } else if (route === 'blob.put') {
        if (!keys(params, ['bytes', 'expectedDigest']) || !(params.bytes instanceof Uint8Array) || params.bytes.byteLength > DESIGN_BLOB_CAP || !digest(params.expectedDigest) || 'sha256:' + createHash('sha256').update(params.bytes).digest('hex') !== params.expectedDigest) return { ok: false, kind: 'invalid' };
        params = { bytes: new Uint8Array(params.bytes), expectedDigest: params.expectedDigest };
      } else if (route === 'blob.get' || route === 'blob.has') {
        if (!keys(params, ['digest']) || !digest(params.digest)) return { ok: false, kind: 'invalid' };
      } else if (route === 'event.append' || route === 'event.read') {
        if (!keys(params, route === 'event.read' ? ['stream'] : ['stream', 'payload'], route === 'event.append' ? ['clientEventId'] : []) || !eventType(params.stream)) return { ok: false, kind: 'invalid' };
        if (route === 'event.append' && (!jsonValue(params.payload) || Buffer.byteLength(JSON.stringify(params.payload)) > DESIGN_VALUE_CAP || ('clientEventId' in params && (typeof params.clientEventId !== 'string' || !/^[A-Za-z0-9._:-]{1,160}$/.test(params.clientEventId))))) return { ok: false, kind: 'invalid' };
      } else if (route === 'import.commit') {
        if (!keys(params, ['ops']) || !validImportOps(params.ops)) return { ok: false, kind: 'invalid' };
      } else if (route === 'import.repair') {
        if (!keys(params, ['txnId']) || typeof params.txnId !== 'string' || !/^[a-f0-9]{64}$/.test(params.txnId)) return { ok: false, kind: 'invalid' };
      } else if (route === 'import.status' || route === 'storage.diagnostics') {
        if (!keys(params, [])) return { ok: false, kind: 'invalid' };
      } else if (route === 'export.preview' || route === 'export.save') {
        if (!keys(params, ['exportedAt']) || typeof params.exportedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(params.exportedAt) || !Number.isFinite(Date.parse(params.exportedAt))) return { ok: false, kind: 'invalid' };
      } else if (route === 'cache.get') {
        if (!keys(params, ['key']) || params.key !== 'design.discovery.catalog') return { ok: false, kind: 'invalid' };
      } else if (route === 'doc.list') {
        if (!keys(params, ['prefix']) || !allowedDocumentKey(params.prefix, true)) return { ok: false, kind: 'invalid' };
      } else if (route === 'doc.get' || route === 'doc.put') {
        if (!keys(params, route === 'doc.put' ? ['key', 'value'] : ['key'], route === 'doc.put' ? ['expectedRevision'] : []) || !allowedDocumentKey(params.key)) return { ok: false, kind: 'invalid' };
        if (route === 'doc.put' && (!(!Object.hasOwn(params, 'expectedRevision') || params.expectedRevision === null || (Number.isSafeInteger(params.expectedRevision) && (params.expectedRevision as number) >= 0)) || !jsonValue(params.value) || Buffer.byteLength(JSON.stringify(params.value)) > DESIGN_VALUE_CAP)) return { ok: false, kind: 'invalid' };
      } else return { ok: false, kind: 'invalid' };
    } catch { return { ok: false, kind: 'invalid' }; }
    let current: DesignStore;
    try { current = await getStore(); } catch { return { ok: false, kind: 'unavailable' }; }
    const p = params as Record<string, unknown>;
    try {
      switch (route) {
        case 'import.commit': return current.transactions.status.accepted ? publicResult(await current.transactions.commit(p.ops as readonly ImportWriteOp[])) : disabled();
        case 'import.status': return current.transactions.status.accepted ? { ok: true, value: current.transactions.status } : disabled();
        case 'import.repair': {
          if (!current.transactions.status.accepted) return disabled();
          const result = await current.transactions.repair(p.txnId as string);
          if (!result.ok) return publicResult(result);
          return { ok: true, value: { txnId: p.txnId, repaired: true } };
        }
        case 'storage.diagnostics': return current.transactions.status.accepted ? publicResult(await current.transactions.diagnostics()) : disabled();
        case 'export.preview': return current.exportBundle.status.state === 'disabled' ? disabled() : publicResult(await current.exportBundle.preview(p.exportedAt as string));
        case 'export.save': {
          if (current.exportBundle.status.state === 'disabled') return disabled();
          if (!save) return { ok: false, kind: 'unavailable' };
          const result = await current.exportBundle.build(p.exportedAt as string);
          if (!result.ok) return publicResult(result);
          if (!record(result.value) || !(result.value.bytes instanceof Uint8Array)) return { ok: false, kind: 'unavailable' };
          return { ok: true, value: await save(result.value.bytes, { defaultPath: 'design-export.json', filters: [{ name: 'Design bundle', extensions: ['json'] }] }) };
        }
        case 'cache.put': return { ok: true, value: await current.cache.putDocument(p.key as string, p.value as JsonValue) };
        case 'blob.put': return { ok: true, value: await current.transactions.workspace.putBlob(p.bytes as Uint8Array, { expectedDigest: p.expectedDigest as BlobDigest }) };
        case 'blob.get': {
          const bytes = await current.transactions.workspace.getBlob(p.digest as string);
          if (bytes && (bytes.byteLength > DESIGN_BLOB_CAP || 'sha256:' + createHash('sha256').update(bytes).digest('hex') !== p.digest)) throw new Error('Unavailable blob');
          return { ok: true, value: bytes };
        }
        case 'blob.has': return { ok: true, value: await current.transactions.workspace.hasBlob(p.digest as string) };
        case 'event.append': {
          const event = await current.transactions.workspace.appendEvent(p.stream as string, { type: eventType(p.stream)!, payload: p.payload as JsonValue, ...(p.clientEventId === undefined ? {} : { clientEventId: p.clientEventId as string }) });
          return { ok: true, value: { seq: event.seq, payload: event.payload } };
        }
        case 'event.read': {
          const read = await current.transactions.workspace.readEvents(p.stream as string);
          return { ok: true, value: { events: read.events.map(({ seq, payload }) => ({ seq, payload })), status: read.status } };
        }
        case 'cache.get': return { ok: true, value: checkedDocument(await current.cache.getDocument(p.key as string)) };
        case 'doc.get': return { ok: true, value: checkedDocument(await current.transactions.workspace.getDocument(p.key as string)) };
        case 'doc.list': return { ok: true, value: [...await current.transactions.workspace.listDocuments(p.prefix as string)] };
        default: return { ok: true, value: await current.transactions.workspace.putDocument(p.key as string, p.value as JsonValue, Object.hasOwn(p, 'expectedRevision') ? { expectedRevision: p.expectedRevision as number | null } : {}) };
      }
    } catch (error) {
      const code = record(error) ? error.code : (error instanceof Error && 'code' in error ? error.code : undefined);
      if (!['doc.put', 'cache.put', 'blob.put', 'event.append', 'import.commit', 'import.repair', 'export.save'].includes(String(route)) || code === 'closed') return { ok: false, kind: 'unavailable' };
      if (code === 'conflict') return { ok: false, kind: 'conflict' };
      if (code === 'read-only') return { ok: false, kind: 'read-only' };
      if (code === 'invalid-argument' || code === 'too-large') return { ok: false, kind: 'invalid' };
      return { ok: false, kind: 'unknown' };
    }
  }
  return {
    async ready(): Promise<boolean> { if (closing) return false; try { await getStore(); return true; } catch { return false; } },
    call(route: unknown, params: unknown) {
      if (closing) return Promise.resolve<DesignStorageResult<unknown>>({ ok: false, kind: 'unavailable' });
      let captured: unknown;
      try { if (!record(params)) throw Error(); captured = structuredClone(params); } catch { return Promise.resolve<DesignStorageResult<unknown>>({ ok: false, kind: 'invalid' }); }
      const exclusive = typeof route === 'string' && (route.startsWith('import.') || route.startsWith('export.'));
      const operation = exclusive ? gate.exclusive(() => execute(route, captured)) : gate.shared(() => execute(route, captured));
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
