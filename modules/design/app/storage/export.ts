/**
 * Privacy-projected export of frozen requests, bound to the PR17 v1 packet shape (requests head
 * 2438d6ff96a84141e12e30bab2d28d042aa80d01). DISABLED by default and fail-closed.
 *
 * Why a projection and not just "export the workspace namespace": a freeze record holds the packet
 * AND the consumed draft (recoverable local history, including unselected attachment candidates)
 * AND the linked continuation draft. Namespace membership says nothing about that; the projection
 * copies an allow-list of fields out of each record and leaves everything else behind. Keys are
 * classified by allow-list too: `draft` documents are never read, and any key the projection does
 * not know is omitted and counted, never exported.
 *
 * Wiring this to an extension adapter waits for that extension's accepted delta; nothing here
 * anticipates it. The export stays disabled until conformance qualifies it.
 */
import { canonicalBytes } from './canonical.ts';
import { NamespaceClassError, type WorkspaceReader } from './backing.ts';

export const REQUESTS_PACKET_PIN = Object.freeze({
  requestsHead: '2438d6ff96a84141e12e30bab2d28d042aa80d01',
  packetSchema: 'hq.design.decision-packet/v1',
  freezeSchema: 'hq.design.request-freeze/v1',
  reviewEventSchema: 'hq.design.request-review-event/v1',
  draftSchema: 'hq.design.request-draft/v1',
  keyRoot: 'design/requests/',
});

export const EXPORT_SCHEMA = 'hq.design.storage.requests-projection/v1';

/** Not qualified: no conformance has accepted export for this packet version. */
export const EXPORT_STATUS = Object.freeze({
  state: 'disabled' as const,
  reason: 'Export stays disabled until the privacy projection passes conformance for the accepted packet version.',
});

export class ExportDisabledError extends Error {
  constructor() {
    super(EXPORT_STATUS.reason);
    this.name = 'ExportDisabledError';
  }
}

export class ExportProjectionError extends Error {
  constructor(message: string) {
    super(`Export refused: ${message}`);
    this.name = 'ExportProjectionError';
  }
}

export type RequestsKeyClass =
  | { readonly kind: 'draft'; readonly requestId: string }
  | { readonly kind: 'packet'; readonly requestId: string; readonly sequence: number }
  | { readonly kind: 'candidate'; readonly requestId: string; readonly candidateId: string }
  | { readonly kind: 'unclassified' };

const SAFE = '[A-Za-z0-9][A-Za-z0-9._-]{0,159}';
const DRAFT_KEY = new RegExp(`^design/requests/(${SAFE})/draft$`, 'u');
const PACKET_KEY = new RegExp(`^design/requests/(${SAFE})/packets/(\\d{6})$`, 'u');
const CANDIDATE_KEY = new RegExp(`^design/requests/(${SAFE})/candidates/(${SAFE})$`, 'u');

export function classifyRequestsKey(key: string): RequestsKeyClass {
  const draft = DRAFT_KEY.exec(key);
  if (draft) return { kind: 'draft', requestId: draft[1]! };
  const packet = PACKET_KEY.exec(key);
  if (packet) return { kind: 'packet', requestId: packet[1]!, sequence: Number(packet[2]) };
  const candidate = CANDIDATE_KEY.exec(key);
  if (candidate) return { kind: 'candidate', requestId: candidate[1]!, candidateId: candidate[2]! };
  return { kind: 'unclassified' };
}

export const reviewStreamOf = (requestId: string): string => `${REQUESTS_PACKET_PIN.keyRoot}${requestId}/review`;

type Plain = { readonly [key: string]: unknown };
const isPlain = (value: unknown): value is Plain => typeof value === 'object' && value !== null && !Array.isArray(value);

export interface ProjectedFreezeRecord {
  readonly schema: typeof REQUESTS_PACKET_PIN.freezeSchema;
  readonly packet: Plain;
  readonly consumed: { readonly draftId: string; readonly revision: number };
}

export interface SelectedAttachmentRef {
  readonly blobDigest: string;
  readonly mediaType: string;
}

/**
 * Copies the allow-listed parts of a v1 freeze record. `consumedDraft` and `continuation` are
 * not read into the result at all. Anything malformed throws instead of passing through.
 */
export function projectFreezeRecord(value: unknown): { readonly record: ProjectedFreezeRecord; readonly selected: readonly SelectedAttachmentRef[]; readonly historyDrafts: number } {
  if (!isPlain(value) || value.schema !== REQUESTS_PACKET_PIN.freezeSchema) throw new ExportProjectionError('freeze record is not the pinned v1 schema');
  const { packet, consumed } = value;
  if (!isPlain(packet) || packet.schema !== REQUESTS_PACKET_PIN.packetSchema) throw new ExportProjectionError('freeze record has no pinned v1 packet');
  if (!isPlain(consumed) || typeof consumed.draftId !== 'string' || typeof consumed.revision !== 'number') throw new ExportProjectionError('freeze record has no draft-consumed marker');
  const attachments = packet.attachments;
  if (!Array.isArray(attachments)) throw new ExportProjectionError('packet attachments are not a list');
  const selected: SelectedAttachmentRef[] = [];
  for (const attachment of attachments) {
    if (!isPlain(attachment) || typeof attachment.blobDigest !== 'string' || typeof attachment.mediaType !== 'string') {
      throw new ExportProjectionError('packet attachment lacks blobDigest/mediaType');
    }
    selected.push({ blobDigest: attachment.blobDigest, mediaType: attachment.mediaType });
  }
  return {
    record: { schema: REQUESTS_PACKET_PIN.freezeSchema, packet, consumed: { draftId: consumed.draftId, revision: consumed.revision } },
    selected,
    historyDrafts: isPlain(value.consumedDraft) ? 1 : 0,
  };
}

export interface ExportedBlob {
  readonly digest: string;
  readonly mediaType: string;
  readonly base64: string;
}

export interface OmittedStore {
  readonly store: 'drafts' | 'draft-history' | 'continuations' | 'unselected-attachments' | 'unclassified-keys' | 'cache' | 'missing-blobs';
  readonly count: number;
  readonly reason: string;
}

export interface RequestsProjection {
  readonly schema: typeof EXPORT_SCHEMA;
  readonly pin: typeof REQUESTS_PACKET_PIN.requestsHead;
  readonly exportedAt: string;
  readonly requests: readonly {
    readonly requestId: string;
    readonly freezes: readonly ProjectedFreezeRecord[];
    readonly candidates: readonly unknown[];
    readonly reviews: readonly unknown[];
  }[];
  readonly blobs: readonly ExportedBlob[];
  readonly omitted: readonly OmittedStore[];
}

export interface RequestsExportPort {
  /** Throws `ExportDisabledError` until the export is enabled. */
  exportRequests(exportedAt: string): Promise<{ readonly projection: RequestsProjection; readonly bytes: Uint8Array }>;
  readonly status: typeof EXPORT_STATUS | { readonly state: 'enabled' };
}

function base64(bytes: Uint8Array): string {
  let binary = '';
  for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  return btoa(binary);
}

export function createRequestsExport(reader: WorkspaceReader, options: { readonly enabled?: boolean } = {}): RequestsExportPort {
  if (reader.kind !== 'workspace') throw new NamespaceClassError('Export reads only a workspace view');
  const enabled = options.enabled === true;
  return Object.freeze({
    status: enabled ? ({ state: 'enabled' } as const) : EXPORT_STATUS,
    async exportRequests(exportedAt: string) {
      if (!enabled) throw new ExportDisabledError();
      const grouped = new Map<string, { packets: { sequence: number; key: string }[]; candidates: string[]; drafts: number }>();
      let unclassified = 0;
      const slot = (id: string) => {
        let found = grouped.get(id);
        if (!found) grouped.set(id, (found = { packets: [], candidates: [], drafts: 0 }));
        return found;
      };
      for (const key of await reader.listDocuments(REQUESTS_PACKET_PIN.keyRoot)) {
        const kind = classifyRequestsKey(key);
        if (kind.kind === 'draft') slot(kind.requestId).drafts += 1; // counted from the key; the document is never read
        else if (kind.kind === 'packet') slot(kind.requestId).packets.push({ sequence: kind.sequence, key });
        else if (kind.kind === 'candidate') slot(kind.requestId).candidates.push(key);
        else unclassified += 1;
      }
      const requests: { requestId: string; freezes: ProjectedFreezeRecord[]; candidates: unknown[]; reviews: unknown[] }[] = [];
      const selected = new Map<string, string>();
      const candidateAttachments = new Set<string>();
      let drafts = 0;
      let history = 0;
      for (const [requestId, group] of [...grouped].sort(([a], [b]) => (a < b ? -1 : 1))) {
        drafts += group.drafts;
        if (group.packets.length === 0) continue;
        const freezes: ProjectedFreezeRecord[] = [];
        for (const { key, sequence } of group.packets.sort((a, b) => a.sequence - b.sequence)) {
          const stored = await reader.getDocument(key);
          if (!stored) throw new ExportProjectionError(`${key} disappeared while exporting`);
          const projected = projectFreezeRecord(stored.value);
          if (!isPlain(projected.record.packet.lineage) || (projected.record.packet.lineage as Plain).sequence !== sequence) {
            throw new ExportProjectionError(`${key} does not hold packet ${sequence}`);
          }
          history += projected.historyDrafts;
          for (const attachment of projected.selected) selected.set(attachment.blobDigest, attachment.mediaType);
          if (isPlain(stored.value) && isPlain(stored.value.consumedDraft) && Array.isArray(stored.value.consumedDraft.attachments)) {
            for (const attachment of stored.value.consumedDraft.attachments) if (isPlain(attachment) && typeof attachment.blobDigest === 'string') candidateAttachments.add(attachment.blobDigest);
          }
          freezes.push(projected.record);
        }
        const candidates: unknown[] = [];
        for (const key of group.candidates.sort()) {
          const stored = await reader.getDocument(key);
          if (stored) candidates.push(stored.value);
        }
        const events = await reader.readEvents(reviewStreamOf(requestId));
        if (events.status.state !== 'ok') throw new ExportProjectionError(`review journal of ${requestId} is ${events.status.state}`);
        requests.push({ requestId, freezes, candidates, reviews: events.events.map((event) => event.payload) });
      }
      const blobs: ExportedBlob[] = [];
      let missing = 0;
      for (const [digest, mediaType] of [...selected].sort(([a], [b]) => (a < b ? -1 : 1))) {
        const bytes = await reader.getBlob(digest);
        if (bytes) blobs.push({ digest, mediaType, base64: base64(bytes) });
        else missing += 1;
      }
      const unselected = [...candidateAttachments].filter((digest) => !selected.has(digest)).length;
      const omitted: OmittedStore[] = [
        { store: 'drafts', count: drafts, reason: 'Unsent drafts are private and are never read by the export.' },
        { store: 'draft-history', count: history, reason: 'Consumed drafts are local recovery history and are left out of every freeze record.' },
        { store: 'continuations', count: history, reason: 'Linked continuation drafts are editable local state and are left out of every freeze record.' },
        { store: 'unselected-attachments', count: unselected, reason: 'Only attachments selected into a frozen packet are exported.' },
        { store: 'unclassified-keys', count: unclassified, reason: 'Keys the pinned v1 projection does not know are never exported.' },
        { store: 'cache', count: 0, reason: 'The cache namespace is never read.' },
      ];
      if (missing > 0) omitted.push({ store: 'missing-blobs', count: missing, reason: 'Selected images whose bytes are not stored locally.' });
      const projection: RequestsProjection = {
        schema: EXPORT_SCHEMA, pin: REQUESTS_PACKET_PIN.requestsHead, exportedAt, requests, blobs, omitted,
      };
      return { projection, bytes: canonicalBytes(projection) };
    },
  });
}
