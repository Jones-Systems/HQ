import {
  FREEZE_SCHEMA, REVIEW_EVENT_SCHEMA,
  type CandidateId, type ClaimJudgment, type ClockPort, type DecisionPacket, type Digest, type DraftId, type EvidenceRef,
  type FreezeRecord, type IdPort, type RequestDraft, type RequestId, type ReturnedCandidate, type ReviewDecision,
  type ReviewEvent, type ReviewEventId, type SourceRef, type StoragePort,
} from './contract.ts';
import { continuationOf, freezeBlockers, linkOf, newDraft, revisionOf } from './draft.ts';
import { canonicalBytes, decodeJson, digestOf } from './jcs.ts';
import { buildPacket, deepFreeze, verifyPacket } from './packet.ts';
import {
  UnsupportedSchemaError, ValidationError, brandId, parseDraft, parseFreezeRecord, parseReturnedCandidate, parseReviewEvent,
} from './validate.ts';

export interface RequestStorePorts {
  readonly storage: StoragePort;
  readonly clock: ClockPort;
  readonly ids: IdPort;
}

/** Everything the requests section owns for one request, as last read from storage. */
export interface RequestSnapshot {
  readonly requestId: RequestId;
  /** The active editable draft, or null if none exists or it cannot be read. */
  readonly draft: RequestDraft | null;
  /** Exact stored bytes of the active draft. */
  readonly draftBytes: Uint8Array | null;
  /** Frozen packets in sequence order. */
  readonly packets: readonly DecisionPacket[];
  /** Drafts consumed by freezes: recoverable history, never exported. */
  readonly history: readonly RequestDraft[];
  readonly reviews: readonly ReviewEvent[];
  readonly candidates: readonly ReturnedCandidate[];
  /** Why the request opened read-only (unsupported or invalid stored data); null when writable. */
  readonly readOnly: string | null;
  /** Interrupted operations this open completed. */
  readonly recovered: readonly string[];
}

export class FreezeBlockedError extends Error {
  readonly reasons: readonly string[];
  constructor(reasons: readonly string[]) { super(reasons.join(' ')); this.name = 'FreezeBlockedError'; this.reasons = reasons; }
}

/** The draft is no longer the request's active draft (consumed, replaced, or superseded). */
export class StaleDraftError extends Error {
  constructor(message: string) { super(message); this.name = 'StaleDraftError'; }
}

/** Another writer froze this sequence slot first. */
export class FreezeConflictError extends Error {
  constructor() { super('Another freeze already used this packet slot. Reopen the request.'); this.name = 'FreezeConflictError'; }
}

/** A write may or may not have taken effect. Reopen (reconcile) before any retry. */
export class OutcomeUnknownError extends Error {
  readonly cause: unknown;
  constructor(operation: string, cause: unknown) {
    super(`${operation} outcome is unknown. Reopen the request to reconcile before retrying.`);
    this.name = 'OutcomeUnknownError';
    this.cause = cause;
  }
}

export class ReadOnlyRequestError extends Error {
  constructor(reason: string) { super(`Request is read-only: ${reason}`); this.name = 'ReadOnlyRequestError'; }
}

export interface FreezeResult {
  readonly packet: DecisionPacket;
  readonly continuation: RequestDraft;
  /** `pending` when the continuation write failed after a durable freeze; the next open completes it. */
  readonly cleanup: 'done' | 'pending';
}

export interface ReviewResult {
  readonly event: ReviewEvent;
  readonly draft: RequestDraft | null;
  /** `pending` when the revision draft write failed after the event was appended. */
  readonly cleanup: 'done' | 'pending';
}

const ROOT = 'design/requests/';
const keys = {
  draft: (id: RequestId) => `${ROOT}${id}/draft`,
  packets: (id: RequestId) => `${ROOT}${id}/packets/`,
  packet: (id: RequestId, sequence: number) => `${ROOT}${id}/packets/${String(sequence).padStart(6, '0')}`,
  candidates: (id: RequestId) => `${ROOT}${id}/candidates/`,
  candidate: (id: RequestId, candidate: CandidateId) => `${ROOT}${id}/candidates/${candidate}`,
  review: (id: RequestId) => `${ROOT}${id}/review`,
};

const KEY_SAFE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,159}$/u;
function keySafe<T extends string>(value: T, what: string): T {
  if (!KEY_SAFE.test(value)) throw new ValidationError(what, 'identifier is not storage-key safe');
  return value;
}

interface RequestState {
  active: DraftId | null;
  readOnly: string | null;
  /** Set after an unknown write outcome; cleared only by reopening. */
  unknown: boolean;
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function candidateEvidence(candidate: ReturnedCandidate, digest: Digest): EvidenceRef {
  return {
    evidenceId: brandId(`candidate.${candidate.candidateId}`), kind: 'candidate',
    label: `Returned candidate (${candidate.observedStatus})`, digest, versionId: candidate.candidateVersionId,
  };
}

/**
 * Durable request lifecycle over an injected StoragePort. It has no dispatch
 * dependency at all: freezing can never send anything.
 */
export class RequestStore {
  private readonly ports: RequestStorePorts;
  private readonly states = new Map<RequestId, RequestState>();

  constructor(ports: RequestStorePorts) { this.ports = ports; }

  async createRequest(init: { readonly title?: string; readonly sources?: readonly SourceRef[] } = {}): Promise<RequestSnapshot> {
    const requestId = keySafe(brandId<'RequestId'>(this.ports.ids.next('request')), 'requestId');
    const draft = newDraft({ requestId, draftId: brandId(this.ports.ids.next('draft')), now: this.ports.clock.now(), ...init });
    const result = await this.ports.storage.createDocument('workspace', keys.draft(requestId), canonicalBytes(draft));
    if (result === 'exists-different') throw new ValidationError('requestId', 'request already exists');
    return this.open(requestId);
  }

  async listRequests(): Promise<RequestId[]> {
    const found = new Set<string>();
    for (const key of await this.ports.storage.listDocuments('workspace', ROOT)) {
      const [id, kind] = key.slice(ROOT.length).split('/');
      if (id && (kind === 'draft' || kind === 'packets') && KEY_SAFE.test(id)) found.add(id);
    }
    return [...found].sort() as RequestId[];
  }

  private state(requestId: RequestId): RequestState {
    const state = this.states.get(requestId);
    if (!state) throw new StaleDraftError('Open the request before changing it.');
    if (state.readOnly) throw new ReadOnlyRequestError(state.readOnly);
    if (state.unknown) throw new StaleDraftError('An earlier outcome is unknown. Reopen the request to reconcile.');
    return state;
  }

  private async records(requestId: RequestId): Promise<FreezeRecord[]> {
    const storage = this.ports.storage;
    const prefix = keys.packets(requestId);
    const records: FreezeRecord[] = [];
    for (const key of await storage.listDocuments('workspace', prefix)) {
      const bytes = await storage.readDocument('workspace', key);
      if (!bytes) continue;
      const record = parseFreezeRecord(decodeJson(bytes));
      await verifyPacket(record.packet);
      const expected = records.length + 1;
      const packet = record.packet;
      const previous = records.at(-1)?.packet ?? null;
      if (key !== keys.packet(requestId, expected) || packet.lineage.sequence !== expected) throw new ValidationError(key, 'packet sequence gap');
      if (packet.lineage.requestId !== requestId) throw new ValidationError(key, 'packet belongs to another request');
      const parent = previous ? linkOf(previous) : null;
      if (JSON.stringify(packet.lineage.parent) !== JSON.stringify(parent) || JSON.stringify(packet.supersedes) !== JSON.stringify(parent)) {
        throw new ValidationError(key, 'packet lineage does not match its predecessor');
      }
      if (packet.lineage.rootPacketId !== (previous?.lineage.rootPacketId ?? packet.packetId)) throw new ValidationError(key, 'packet root mismatch');
      if (record.consumed.draftId !== record.consumedDraft.draftId || record.consumed.revision !== record.consumedDraft.revision
        || packet.lineage.draft.draftId !== record.consumed.draftId) throw new ValidationError(key, 'draft-consumed marker mismatch');
      deepFreeze(record);
      records.push(record);
    }
    return records;
  }

  /**
   * Reads one request and completes any interrupted freeze or revise. Stored
   * data that is invalid or from a newer schema opens read-only and is never
   * rewritten.
   */
  async open(requestId: RequestId): Promise<RequestSnapshot> {
    keySafe(requestId, 'requestId');
    const { storage, clock } = this.ports;
    const recovered: string[] = [];
    const problems: string[] = [];
    const guard = async <T>(what: string, read: () => Promise<T>, fallback: T): Promise<T> => {
      try { return await read(); } catch (error) {
        if (error instanceof UnsupportedSchemaError) problems.push(`${what} uses a newer format (${String(error.schema)}).`);
        else if (error instanceof ValidationError || error instanceof SyntaxError || error instanceof TypeError) problems.push(`${what} failed validation: ${describe(error)}`);
        else throw error;
        return fallback;
      }
    };

    const records = await guard('Packet history', () => this.records(requestId), [] as FreezeRecord[]);
    const storedBytes = await storage.readDocument('workspace', keys.draft(requestId));
    const stored = storedBytes ? await guard('Draft', async () => parseDraft(decodeJson(storedBytes)), null) : null;
    if (stored && stored.requestId !== requestId) problems.push('Draft belongs to another request.');
    const reviews = await guard('Review history', async () => (await storage.readEvents('workspace', keys.review(requestId)))
      .map((bytes) => parseReviewEvent(decodeJson(bytes))), [] as ReviewEvent[]);
    const candidates = await guard('Returned candidates', async () => {
      const list: ReturnedCandidate[] = [];
      for (const key of await storage.listDocuments('workspace', keys.candidates(requestId))) {
        const bytes = await storage.readDocument('workspace', key);
        if (bytes) list.push(parseReturnedCandidate(decodeJson(bytes)));
      }
      return list;
    }, [] as ReturnedCandidate[]);

    let readOnly: string | null = problems[0] ?? null;
    let draft = stored;
    if (!readOnly) {
      const head = records.at(-1) ?? null;
      const consumed = new Set(records.map((record) => record.consumed.draftId));
      // Freeze is durable once its record exists: a consumed or missing draft becomes the record's continuation.
      if (head && (!draft || consumed.has(draft.draftId))) {
        recovered.push(draft
          ? `Completed freeze of packet ${head.packet.lineage.sequence}: consumed draft cleared.`
          : `Restored the continuation of packet ${head.packet.lineage.sequence}.`);
        draft = head.continuation;
      }
      // A revise event whose linked draft was not written yet: rebuild that exact draft.
      const lastRevise = [...reviews].reverse().find((event) => event.decision === 'revise');
      if (draft && head && lastRevise?.revisionDraftId && lastRevise.packet.packetId === head.packet.packetId
        && draft.continuesFrom?.packetId === head.packet.packetId && draft.review?.reviewEventId !== lastRevise.eventId) {
        const candidate = candidates.find((item) => item.candidateId === lastRevise.candidateId);
        if (candidate) {
          const added = [candidateEvidence(candidate, await digestOf(candidate)), ...candidate.evidence];
          draft = revisionOf(draft, { reviewEventId: lastRevise.eventId, candidateId: candidate.candidateId }, added, lastRevise.revisionDraftId, clock.now());
          recovered.push('Completed an interrupted revise.');
        } else {
          readOnly = 'A revise decision references a candidate that is not stored.';
          draft = stored;
        }
      }
    }

    let draftBytes = storedBytes;
    if (!readOnly && draft && draft !== stored) {
      draftBytes = canonicalBytes(draft);
      await storage.writeDocument('workspace', keys.draft(requestId), draftBytes);
    }
    this.states.set(requestId, { active: readOnly ? null : draft?.draftId ?? null, readOnly, unknown: false });
    return {
      requestId, draft, draftBytes, packets: records.map((record) => record.packet),
      history: records.map((record) => record.consumedDraft), reviews, candidates, readOnly, recovered,
    };
  }

  /** Autosave target. Only the request's active draft may be written. */
  async saveDraft(draft: RequestDraft): Promise<Uint8Array> {
    const state = this.state(draft.requestId);
    if (state.active !== draft.draftId) throw new StaleDraftError('This draft was frozen or replaced; its edits now live in the continuation.');
    const bytes = canonicalBytes(parseDraft(draft));
    await this.ports.storage.writeDocument('workspace', keys.draft(draft.requestId), bytes);
    return bytes;
  }

  /** Stores image bytes as an immutable blob. Selection is a separate explicit draft edit. */
  async putAttachmentBlob(bytes: Uint8Array): Promise<Digest> {
    return this.ports.storage.putBlob(bytes);
  }

  /**
   * Freezes the active draft in one write-once record holding the packet, the
   * draft-consumed marker, the consumed draft and its linked continuation.
   */
  async freeze(draft: RequestDraft): Promise<FreezeResult> {
    const { storage, clock, ids } = this.ports;
    const state = this.state(draft.requestId);
    if (state.active !== draft.draftId) throw new StaleDraftError('Only the active draft can be frozen.');
    const records = await this.records(draft.requestId);
    const head = records.at(-1)?.packet ?? null;
    const reasons = freezeBlockers(draft, head);
    for (const attachment of draft.attachments) {
      if (attachment.selected && !(await storage.getBlob(attachment.blobDigest))) reasons.push(`Attachment “${attachment.label}” has no stored image.`);
    }
    if (reasons.length > 0) throw new FreezeBlockedError(reasons);

    const frozenAt = clock.now();
    const packet = await buildPacket(draft, keySafe(brandId<'PacketId'>(ids.next('packet')), 'packetId'), frozenAt, head);
    const continuation = continuationOf(packet, draft, brandId(ids.next('draft')), frozenAt);
    const record: FreezeRecord = {
      schema: FREEZE_SCHEMA, packet, consumed: { draftId: draft.draftId, revision: draft.revision }, consumedDraft: draft, continuation,
    };
    const bytes = canonicalBytes(parseFreezeRecord(JSON.parse(JSON.stringify(record))));
    let created;
    try {
      created = await storage.createDocument('workspace', keys.packet(draft.requestId, packet.lineage.sequence), bytes);
    } catch (error) {
      state.unknown = true;
      throw new OutcomeUnknownError('Freeze', error);
    }
    if (created === 'exists-different') throw new FreezeConflictError();
    state.active = continuation.draftId;
    try {
      await storage.writeDocument('workspace', keys.draft(draft.requestId), canonicalBytes(continuation));
      return { packet, continuation, cleanup: 'done' };
    } catch {
      return { packet, continuation, cleanup: 'pending' };
    }
  }

  /**
   * Appends an accept/revise/defer decision for a returned candidate. Revise
   * also starts a new draft linked to the reviewed packet, carrying `active`
   * (the session's current draft, including unsent edits) and all evidence.
   */
  async recordReview(input: {
    readonly requestId: RequestId;
    readonly candidate: ReturnedCandidate;
    readonly decision: ReviewDecision;
    readonly note?: string;
    readonly judgments?: readonly ClaimJudgment[];
    readonly active?: RequestDraft | null;
  }): Promise<ReviewResult> {
    const { storage, clock, ids } = this.ports;
    const candidate = parseReturnedCandidate(input.candidate);
    const requestId = input.requestId;
    const state = this.state(requestId);
    const records = await this.records(requestId);
    const index = records.findIndex((record) => record.packet.packetId === candidate.packet.packetId);
    const reviewed = records[index]?.packet;
    if (!reviewed || reviewed.authoringDigest !== candidate.packet.authoringDigest) throw new ValidationError('candidate.packet', 'candidate does not match a frozen packet');
    for (const judgment of input.judgments ?? []) {
      if (!candidate.claims.some((claim) => claim.claimId === judgment.claimId)) throw new ValidationError('judgments', `unknown claim ${judgment.claimId}`);
    }
    const active = input.active ?? null;
    if (input.decision === 'revise') {
      if (index !== records.length - 1) throw new StaleDraftError('Only the latest packet can be revised; a newer packet already supersedes this one.');
      if (!active || active.draftId !== state.active || active.continuesFrom?.packetId !== reviewed.packetId) throw new StaleDraftError('The active draft does not continue the reviewed packet.');
    }

    const stored = await storage.createDocument('workspace', keys.candidate(requestId, keySafe(candidate.candidateId, 'candidateId')), canonicalBytes(candidate));
    if (stored === 'exists-different') throw new ValidationError('candidate', 'a different candidate with this id is already stored');
    const at = clock.now();
    const event = parseReviewEvent({
      schema: REVIEW_EVENT_SCHEMA, eventId: brandId<'ReviewEventId'>(ids.next('review-event')) as ReviewEventId, requestId,
      packet: linkOf(reviewed), candidateId: candidate.candidateId, decision: input.decision, note: input.note ?? '', at,
      judgments: input.judgments ?? [],
      ...(input.decision === 'revise' ? { revisionDraftId: brandId(ids.next('draft')) } : {}),
    });
    try {
      await storage.appendEvent('workspace', keys.review(requestId), canonicalBytes(event));
    } catch (error) {
      state.unknown = true;
      throw new OutcomeUnknownError('Review decision', error);
    }
    if (input.decision !== 'revise' || !active || !event.revisionDraftId) return { event, draft: null, cleanup: 'done' };
    const added = [candidateEvidence(candidate, await digestOf(candidate)), ...candidate.evidence];
    const draft = revisionOf(active, { reviewEventId: event.eventId, candidateId: candidate.candidateId }, added, event.revisionDraftId, at);
    state.active = draft.draftId;
    try {
      await storage.writeDocument('workspace', keys.draft(requestId), canonicalBytes(draft));
      return { event, draft, cleanup: 'done' };
    } catch {
      // The appended event is authoritative; autosave or the next open writes this exact draft.
      return { event, draft, cleanup: 'pending' };
    }
  }
}
