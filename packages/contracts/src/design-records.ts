import type { JsonValue } from './services.js';

export type BlobDigest = string & { readonly __kind: 'BlobDigest' };
export interface BlobRef { readonly digest: BlobDigest; readonly bytes: number }
export type StreamStatus = { readonly state: 'ok' }
  | { readonly state: 'torn-tail'; readonly validBytes: number; readonly tailBytes: number }
  | { readonly state: 'corrupt'; readonly atSeq: number; readonly reason: string };
export interface EventRead { readonly events: readonly { readonly seq: number; readonly payload: JsonValue }[]; readonly status: StreamStatus }
export type ImportWriteOp =
  | { readonly op: 'put-document'; readonly namespace: string; readonly key: string; readonly value: JsonValue; readonly expectedRevision: string | null }
  | { readonly op: 'put-blob'; readonly namespace: string; readonly digest: string & { readonly __kind: 'Sha256Digest' }; readonly mediaType: string; readonly bytes: Uint8Array }
  | { readonly op: 'append-event'; readonly namespace: string; readonly stream: string; readonly payload: JsonValue; readonly expectedSeq: number };
export interface DesignRecordParams {
  readonly 'blob.put': { readonly bytes: Uint8Array; readonly expectedDigest: BlobDigest };
  readonly 'blob.get': { readonly digest: BlobDigest };
  readonly 'blob.has': { readonly digest: BlobDigest };
  readonly 'event.append': { readonly stream: string; readonly payload: JsonValue; readonly clientEventId?: string };
  readonly 'event.read': { readonly stream: string };
  readonly 'import.commit': { readonly ops: readonly ImportWriteOp[] };
  readonly 'import.status': Record<string, never>;
  readonly 'import.repair': { readonly txnId: string };
  readonly 'storage.diagnostics': Record<string, never>;
  readonly 'export.preview': { readonly exportedAt: string };
  readonly 'export.save': { readonly exportedAt: string };
  readonly 'cache.put': { readonly key: 'design.discovery.catalog'; readonly value: JsonValue };
}
export interface DesignRecordValues {
  readonly 'blob.put': BlobRef;
  readonly 'blob.get': Uint8Array | null;
  readonly 'blob.has': boolean;
  readonly 'event.append': { readonly seq: number; readonly payload: JsonValue };
  readonly 'event.read': EventRead;
  readonly 'import.commit': { readonly txnId: string };
  readonly 'import.status': { readonly accepted: boolean; readonly state: string };
  readonly 'import.repair': { readonly txnId: string; readonly repaired: boolean };
  readonly 'storage.diagnostics': { readonly orphanBlobs: { readonly count: number; readonly bytes: number }; readonly pending: readonly string[]; readonly blocked: readonly { readonly txnId: string; readonly keys: readonly string[]; readonly streams: readonly string[]; readonly reason: string }[]; readonly directoryFsync: 'supported' | 'unsupported' | 'unknown' };
  readonly 'export.preview': { readonly documents: number; readonly blobs: number; readonly events: number; readonly omitted: readonly { readonly category: string; readonly count: number; readonly unit: string; readonly reason: string }[] };
  readonly 'export.save': { readonly saved: boolean };
  readonly 'cache.put': import('./services.js').StoredDocument;
}
