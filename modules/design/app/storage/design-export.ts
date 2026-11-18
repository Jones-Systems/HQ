/** Node-only bundle builder; native save-dialog wiring belongs to the host. */
import type { JsonValue } from '../../../../packages/design-store/src/contract.ts';
import { digestOfBytes, digestOfJson, canonicalBytes } from '../../../../packages/design-store/src/jcs.ts';
import type { Bundle, BundleDocument, BundleStream } from '../../imports/src/bundle.ts';
import type { Sha256Digest } from '../../imports/src/contract.ts';
import { asReader, isStoreErrorCode } from './backing.ts';
import { createRequestsExport, EXPORT_STATUS, reviewStreamOf } from './export.ts';
import { disabled, type EngineResult, type TransactionRuntime } from './transactions.ts';
import { collectBlobReferences, projectDesignDocument, projectImportEvent } from './design-export-projections.ts';

export interface DesignOmission { readonly category: string; readonly count: number; readonly unit: 'documents' | 'streams' | 'blobs' | 'events' | 'records'; readonly reason: string }
export interface DesignExportReport { readonly documents: number; readonly blobs: number; readonly events: number; readonly omitted: readonly DesignOmission[] }
export interface DesignExportPort {
  readonly status: typeof EXPORT_STATUS;
  preview(exportedAt: string): Promise<EngineResult<DesignExportReport>>;
  build(exportedAt: string): Promise<EngineResult<{ readonly bytes: Uint8Array; readonly report: DesignExportReport }>>;
}

export function createDesignExport(runtime: TransactionRuntime, enabled = false): DesignExportPort {
  async function build(exportedAt: string): Promise<EngineResult<{ bytes: Uint8Array; report: DesignExportReport }>> {
    if (!enabled) return disabled();
    return runtime.gate.exclusive(async () => {
      if (!Number.isFinite(Date.parse(exportedAt))) throw new Error('Export timestamp must be an ISO date');
      const raw = runtime.raw;
      let streamIds: readonly string[];
      try { streamIds = await raw.listStreams(); }
      catch (error) { if (isStoreErrorCode(error, 'integrity')) return { ok: false, kind: 'unavailable', reason: 'stream-enumeration' }; throw error; }
      const omissions = new Map<string, DesignOmission>();
      const add = (category: string, count: number, unit: DesignOmission['unit'], reason: string) => {
        const old = omissions.get(category);
        omissions.set(category, { category, count: (old?.count ?? 0) + count, unit, reason });
      };
      for (const [category, unit] of [
        ['cache', 'records'], ['drafts', 'documents'], ['draft-history', 'records'], ['continuations', 'records'],
        ['unselected-attachments', 'blobs'], ['sends', 'documents'], ['handoff-status', 'documents'], ['outbox', 'documents'], ['evidence', 'documents'],
        ['non-v1-candidates', 'documents'], ['reviews-of-omitted-candidates', 'events'], ['storage-internals', 'documents'],
        ['pending-import-keys', 'documents'], ['pending-import-streams', 'streams'], ['torn-streams', 'streams'], ['corrupt-streams', 'streams'],
        ['missing-blobs', 'blobs'], ['unclassified-keys', 'documents'], ['unclassified-streams', 'streams'], ['unclassified-events', 'events'],
      ] as const) add(category, 0, unit, `Excluded ${category}`);
      const blockedKeys = new Set(runtime.blocked().flatMap(p => [...p.keys]));
      const blockedStreams = new Set(runtime.blocked().flatMap(p => [...p.streams]));
      const badStreams = new Set<string>();
      for (const id of streamIds) {
        if (blockedStreams.has(id)) { add('pending-import-streams', 1, 'streams', 'Committed import awaits recovery'); continue; }
        const read = await raw.readEvents(id);
        if (read.status.state !== 'ok') { badStreams.add(id); add(read.status.state === 'torn-tail' ? 'torn-streams' : 'corrupt-streams', 1, 'streams', 'Unavailable journal'); }
      }
      // The legacy projection fails closed on bad streams; its reader excludes them and reports them above.
      const reader = asReader(raw);
      const allKeys = await raw.listDocuments();
      const requestReader = {
        ...reader,
        listDocuments: async (prefix?: string) => allKeys.filter(k => (!prefix || k.startsWith(prefix)) && !blockedKeys.has(k)),
        getBlob: async (digest: string) => await runtime.visibleBlob(digest) ? raw.getBlob(digest) : null,
        readEvents: async (id: string) => blockedStreams.has(id) || badStreams.has(id) ? { events: [], head: null, status: { state: 'ok' as const } } : raw.readEvents(id),
      };
      const { projection } = await createRequestsExport(requestReader, { enabled: true }).exportRequests(exportedAt);
      for (const item of projection.omitted) {
        if (item.store === 'cache') continue;
        const unit = omissions.get(item.store)?.unit ?? 'records';
        add(item.store, item.count, unit, item.reason);
      }
      const documents: BundleDocument[] = [], streams: BundleStream[] = [];
      for (const r of projection.requests) {
        for (const freeze of r.freezes) {
          const seq = (freeze.packet.lineage as { sequence: number }).sequence;
          documents.push({ key: `design/requests/${r.requestId}/packets/${String(seq).padStart(6, '0')}`, value: freeze as unknown as JsonValue });
        }
        for (const candidate of r.candidates) documents.push({ key: `design/requests/${r.requestId}/candidates/${(candidate as { candidateId: string }).candidateId}`, value: candidate as JsonValue });
        if (r.reviews.length) streams.push({ stream: reviewStreamOf(r.requestId), events: r.reviews.map((p, i) => ({ seq: i + 1, payload: p as JsonValue })) });
      }
      for (const key of allKeys) {
        if (key.startsWith('design/storage/')) { add('storage-internals', 1, 'documents', 'Internal import ledger'); continue; }
        if (blockedKeys.has(key)) { add('pending-import-keys', 1, 'documents', 'Committed import awaits recovery'); continue; }
        if (key.startsWith('design/requests/')) continue;
        if (key.startsWith('design/connector/outbox/')) { add('outbox', 1, 'documents', 'Local destination and execution state'); continue; }
        if (key.startsWith('design/connector/evidence/')) { add('evidence', 1, 'documents', 'Local host and model evidence'); continue; }
        const stored = await raw.getDocument(key);
        if (!stored) throw new Error('Listed document disappeared');
        const projected = projectDesignDocument(key, stored.value);
        if (projected === null) add('unclassified-keys', 1, 'documents', 'No accepted field projection');
        else documents.push({ key, value: projected });
      }
      for (const id of streamIds) {
        if (badStreams.has(id) || blockedStreams.has(id)) continue;
        if (id.startsWith('design/requests/')) {
          if (!projection.requests.some(r => reviewStreamOf(r.requestId) === id)) add('unclassified-streams', 1, 'streams', 'No exported request');
          continue;
        }
        if (id !== 'design/imports') { add('unclassified-streams', 1, 'streams', 'No accepted stream projection'); continue; }
        const events = [];
        for (const event of (await raw.readEvents(id)).events) {
          const payload = projectImportEvent(event.payload);
          if (payload === null) add('unclassified-events', 1, 'events', 'No accepted event projection');
          else events.push({ seq: events.length + 1, payload });
        }
        if (events.length) streams.push({ stream: id, events });
      }
      const selected = new Map<string, string>();
      for (const doc of documents) collectBlobReferences(doc.value, selected);
      for (const blob of projection.blobs) selected.set(blob.digest, blob.mediaType);
      const blobs = [];
      const missingAlready = new Set<string>();
      // Legacy request projection already counts missing selected attachments.
      for (const r of projection.requests) for (const f of r.freezes) for (const a of f.packet.attachments as { blobDigest: string }[]) {
        if (!projection.blobs.some(b => b.digest === a.blobDigest)) missingAlready.add(a.blobDigest);
      }
      for (const [digest, mediaType] of [...selected].sort(([a], [b]) => a < b ? -1 : 1)) {
        const bytes = await runtime.visibleBlob(digest) ? await raw.getBlob(digest) : null;
        if (!bytes) { if (!missingAlready.has(digest)) add('missing-blobs', 1, 'blobs', 'Referenced bytes absent'); continue; }
        if (digestOfBytes(bytes) !== digest) throw new Error('Blob integrity failure');
        blobs.push({ digest: digest as Sha256Digest, mediaType, data: Buffer.from(bytes).toString('base64') });
      }
      add('cache', (await runtime.store.listDocuments('cache' as never)).length + (await runtime.store.listBlobs('cache' as never)).length, 'records', 'Evictable cache is never exported');
      documents.sort((a, b) => a.key < b.key ? -1 : 1); streams.sort((a, b) => a.stream < b.stream ? -1 : 1);
      const events = streams.reduce((n, s) => n + s.events.length, 0);
      const body = { schema: 'hq.design.bundle/v1' as const, kind: 'export' as const, privacy: 'publishable' as const, createdAt: exportedAt,
        coverage: { included: [{ namespace: 'workspace', class: 'workspace' as const, documents: documents.length, blobs: blobs.length, events }],
          omitted: [{ namespace: 'cache', class: 'cache' as const, reason: 'cache-excluded' as const }],
          unreferencedBlobsOmitted: (await raw.listBlobs()).filter(b => !selected.has(b.digest)).length },
        namespaces: [{ name: 'workspace', class: 'workspace' as const, documents, blobs, streams }] };
      const bundle: Bundle = { ...body, digest: digestOfJson(body as unknown as JsonValue) as string as Sha256Digest };
      const report = { documents: documents.length, blobs: blobs.length, events, omitted: [...omissions.values()].sort((a, b) => a.category < b.category ? -1 : 1) };
      return { ok: true, value: { bytes: canonicalBytes(bundle as unknown as JsonValue), report } };
    });
  }
  return Object.freeze({ status: EXPORT_STATUS, build, async preview(at: string) { const result = await build(at); return result.ok ? { ok: true, value: result.value.report } : result; } } satisfies DesignExportPort);
}
