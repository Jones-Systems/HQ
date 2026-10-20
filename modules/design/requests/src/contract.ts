/**
 * Section-local contract for HQ Design requests (T6 / HQD-05).
 *
 * These shapes satisfy the first-deliverable interface hold in
 * spec.hq-design#iface.contracts.001. Shared promotions (StoragePort,
 * AnnotationRef, EvidenceRef, CompareSlot, dispatch hand-off) are proposed on
 * the coordination issue; root replaces the local copies mechanically.
 */

export type Brand<K extends string> = string & { readonly __kind: K };

export type ProjectId = Brand<'ProjectId'>;
export type ViewId = Brand<'ViewId'>;
export type VersionId = Brand<'VersionId'>;
export type AnnotationId = Brand<'AnnotationId'>;
export type RequestId = Brand<'RequestId'>;
export type DraftId = Brand<'DraftId'>;
export type PacketId = Brand<'PacketId'>;
export type AttachmentId = Brand<'AttachmentId'>;
export type EvidenceId = Brand<'EvidenceId'>;
export type ClarificationId = Brand<'ClarificationId'>;
export type CandidateId = Brand<'CandidateId'>;
export type ClaimId = Brand<'ClaimId'>;
export type ReviewEventId = Brand<'ReviewEventId'>;

/** `sha256:` followed by 64 lowercase hex digits. */
export type Digest = Brand<'Digest'>;

export type IdKind = 'request' | 'draft' | 'packet' | 'attachment' | 'clarification' | 'review-event' | 'candidate' | 'send';

// ---------------------------------------------------------------------------
// Types consumed from other sections (types only; never imported at runtime).

export interface Rect { readonly x: number; readonly y: number; readonly width: number; readonly height: number }
export interface Point { readonly x: number; readonly y: number }

/** Mirror of the shared SourceAnchor baseline (HQD-04 annotations owns it). */
export type AnchorTarget =
  | { readonly kind: 'element'; readonly path: string; readonly rect: Rect; readonly textHash?: string }
  | { readonly kind: 'text'; readonly quote: string; readonly prefix: string; readonly suffix: string; readonly rects: readonly Rect[] }
  | { readonly kind: 'region'; readonly rect: Rect }
  | { readonly kind: 'ink'; readonly points: readonly Point[] };

export interface SourceAnchor {
  readonly versionId: VersionId;
  readonly route: string;
  readonly state: string;
  readonly viewport: { readonly w: number; readonly h: number; readonly dpr: number };
  readonly scroll: { readonly x: number; readonly y: number };
  readonly captureDigest: string;
  readonly target: AnchorTarget;
}

export const ANNOTATION_KINDS = ['pick', 'cite', 'ink', 'box', 'arrow', 'label'] as const;
export type AnnotationKind = (typeof ANNOTATION_KINDS)[number];

export interface AnnotationRef {
  readonly id: AnnotationId;
  readonly letter: string;
  readonly anchor: SourceAnchor;
  readonly note: string;
  readonly kind: AnnotationKind;
}

export const CLAIM_LEVELS = ['agent-reported', 'observed', 'owner-judged'] as const;
export type ClaimLevel = (typeof CLAIM_LEVELS)[number];

/**
 * Local evidence reference until HQD-11 (connector/returned results) publishes
 * its evidence type. Evidence is referenced by digest and never rebinds to a
 * newer version implicitly.
 */
export interface EvidenceRef {
  readonly evidenceId: EvidenceId;
  readonly kind: 'capture' | 'candidate' | 'observation' | 'note';
  readonly label: string;
  readonly digest: string;
  readonly versionId?: VersionId;
}

// ---------------------------------------------------------------------------
// Request content

/** Exact source identity a request is about. */
export interface SourceRef {
  readonly projectId: ProjectId;
  readonly viewId: ViewId;
  readonly versionId: VersionId;
  readonly sourceRevision: string;
}

/** Attachments are never included unless the owner explicitly selects them. */
export interface AttachmentCandidate {
  readonly attachmentId: AttachmentId;
  readonly blobDigest: Digest;
  readonly mediaType: string;
  readonly bytes: number;
  readonly label: string;
  readonly selected: boolean;
}

export interface SelectedAttachment {
  readonly attachmentId: AttachmentId;
  readonly blobDigest: Digest;
  readonly mediaType: string;
  readonly bytes: number;
  readonly label: string;
}

export interface Clarification {
  readonly clarificationId: ClarificationId;
  readonly question: string;
  /** Present once answered. */
  readonly answer?: string;
  /** Explicitly set aside; does not block freezing. */
  readonly dismissed?: true;
}

export type Destination =
  | { readonly kind: 'unassigned' }
  /** Opaque destination handle chosen elsewhere; the request never resolves or contacts it. */
  | { readonly kind: 'existing-thread'; readonly destinationId: string; readonly label: string };

export interface PacketLink {
  readonly packetId: PacketId;
  readonly authoringDigest: Digest;
}

export type DraftOrigin = 'initial' | 'continuation' | 'revision';

export interface ReviewLink {
  readonly reviewEventId: ReviewEventId;
  readonly candidateId: CandidateId;
}

/** The privacy label every draft carries. Drafts never leave the device. */
export const DRAFT_PRIVACY = 'local-unsent' as const;

export const DRAFT_SCHEMA = 'hq.design.request-draft/v1' as const;
export const PACKET_SCHEMA = 'hq.design.decision-packet/v1' as const;
export const FREEZE_SCHEMA = 'hq.design.request-freeze/v1' as const;
export const REVIEW_EVENT_SCHEMA = 'hq.design.request-review-event/v1' as const;
export const EXPORT_SCHEMA = 'hq.design.requests-export/v1' as const;
export const SEND_SCHEMA = 'hq.design.request-send/v1' as const;
export const HANDOFF_STATUS_SCHEMA = 'hq.design.request-handoff-status/v1' as const;

export type DraftPhase = 'draft' | 'clarify';

export interface RequestContent {
  readonly title: string;
  readonly intent: string;
  readonly sources: readonly SourceRef[];
  readonly annotations: readonly AnnotationRef[];
  readonly evidence: readonly EvidenceRef[];
  readonly clarifications: readonly Clarification[];
  readonly destination: Destination;
}

export interface RequestDraft extends RequestContent {
  readonly schema: typeof DRAFT_SCHEMA;
  readonly privacy: typeof DRAFT_PRIVACY;
  readonly requestId: RequestId;
  readonly draftId: DraftId;
  /** Increments on every edit; freeze records the consumed revision. */
  readonly revision: number;
  readonly phase: DraftPhase;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly origin: DraftOrigin;
  readonly continuesFrom: PacketLink | null;
  readonly review: ReviewLink | null;
  readonly attachments: readonly AttachmentCandidate[];
}

export interface PacketLineage {
  readonly requestId: RequestId;
  /** 1-based position of this packet within its request. */
  readonly sequence: number;
  readonly rootPacketId: PacketId;
  readonly parent: PacketLink | null;
  readonly origin: DraftOrigin;
  readonly draft: { readonly draftId: DraftId; readonly revision: number };
  readonly review: ReviewLink | null;
}

/** Packet fields covered by the authoring digest. */
export interface DecisionPacketBody extends RequestContent {
  readonly schema: typeof PACKET_SCHEMA;
  readonly packetId: PacketId;
  readonly projectId: ProjectId;
  readonly frozenAt: string;
  readonly lineage: PacketLineage;
  readonly supersedes: PacketLink | null;
  readonly attachments: readonly SelectedAttachment[];
}

/**
 * Immutable decision packet. `authoringDigest` is SHA-256 over the RFC 8785
 * canonical body; the connector's wire digest is a separate value.
 */
export interface DecisionPacket extends DecisionPacketBody {
  readonly authoringDigest: Digest;
}

/**
 * The single atomic freeze record: the packet, the draft-consumed marker, the
 * consumed draft (recoverable history) and the linked editable continuation.
 */
export interface FreezeRecord {
  readonly schema: typeof FREEZE_SCHEMA;
  readonly packet: DecisionPacket;
  readonly consumed: { readonly draftId: DraftId; readonly revision: number };
  readonly consumedDraft: RequestDraft;
  readonly continuation: RequestDraft;
}

// ---------------------------------------------------------------------------
// Review of returned candidates

export interface CandidateClaim {
  readonly claimId: ClaimId;
  readonly text: string;
  readonly level: ClaimLevel;
  readonly evidence: readonly EvidenceRef[];
}

/** Where a returned candidate came from. Absent on v1 inputs, which are treated as connector returns. */
export const RETURN_ORIGINS = ['connector', 'owner-reported'] as const;
export type ReturnOrigin = (typeof RETURN_ORIGINS)[number];

/**
 * Producer identity as reported with a return. Nothing is inferred: a missing
 * host or model stays missing and is never replaced by a fallback.
 */
export interface CandidateProvenance {
  readonly origin: ReturnOrigin;
  readonly host?: string;
  readonly model?: string;
}

/** The only observed status an owner-reported return may carry. */
export const OWNER_REPORTED_STATUS = 'owner-reported' as const;

/** Evidence kinds an owner-reported return may carry. It cannot carry observations or HQ-made candidate evidence. */
export const OWNER_REPORTED_EVIDENCE_KINDS = ['note', 'capture'] as const;

/** A returned candidate as supplied by the connector/results section (HQD-11). */
export interface ReturnedCandidate {
  readonly candidateId: CandidateId;
  readonly packet: PacketLink;
  readonly baselineVersionId: VersionId;
  /**
   * Null when the producer returned artifacts without a comparable version.
   * No version is invented: the review shows the artifacts and provenance and
   * the compare slot is not rendered.
   */
  readonly candidateVersionId: VersionId | null;
  readonly claims: readonly CandidateClaim[];
  /** Observed execution status as reported, with its own freshness. */
  readonly observedStatus: string;
  readonly observedAt: string;
  readonly evidence: readonly EvidenceRef[];
  /** Optional; absent on v1 inputs. */
  readonly provenance?: CandidateProvenance;
}

/** `reject` was added after the first release; the first three keep their order. A reject never creates a draft or an execution. */
export const REVIEW_DECISIONS = ['accept', 'revise', 'defer', 'reject'] as const;
export type ReviewDecision = (typeof REVIEW_DECISIONS)[number];

export interface ClaimJudgment {
  readonly claimId: ClaimId;
  readonly judgment: 'confirmed' | 'disputed';
}

export interface ReviewEvent {
  readonly schema: typeof REVIEW_EVENT_SCHEMA;
  readonly eventId: ReviewEventId;
  readonly requestId: RequestId;
  readonly packet: PacketLink;
  readonly candidateId: CandidateId;
  readonly decision: ReviewDecision;
  readonly note: string;
  readonly at: string;
  /** Owner judgments turn chosen claims into `owner-judged` claims. */
  readonly judgments: readonly ClaimJudgment[];
  /** Pre-allocated so an interrupted revise recovers to the same draft. */
  readonly revisionDraftId?: DraftId;
}

// ---------------------------------------------------------------------------
// Ports

export type StorageNamespace = 'workspace' | 'cache';

export type CreateResult = 'created' | 'exists-identical' | 'exists-different';

/**
 * Subset of the shared StoragePort. Each document write is atomic on its own
 * (temp, fsync, rename, directory fsync). No multi-document atomicity is
 * assumed; freeze therefore uses one write-once record.
 */
export interface StoragePort {
  readDocument(ns: StorageNamespace, key: string): Promise<Uint8Array | null>;
  writeDocument(ns: StorageNamespace, key: string, bytes: Uint8Array): Promise<void>;
  /** Write-once: never replaces an existing document. */
  createDocument(ns: StorageNamespace, key: string, bytes: Uint8Array): Promise<CreateResult>;
  listDocuments(ns: StorageNamespace, prefix: string): Promise<readonly string[]>;
  putBlob(bytes: Uint8Array): Promise<Digest>;
  getBlob(digest: Digest): Promise<Uint8Array | null>;
  appendEvent(ns: StorageNamespace, stream: string, bytes: Uint8Array): Promise<void>;
  readEvents(ns: StorageNamespace, stream: string): Promise<readonly Uint8Array[]>;
}

export interface ClockPort { now(): string }
export interface IdPort { next(kind: IdKind): string }

export interface SchedulerPort {
  setTimeout(callback: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

/**
 * Explicit hand-off to the connector section. Requests never call it except
 * from an explicit owner Send action, and never interpret receipts.
 */
export interface DispatchSlot {
  /**
   * `binding` is supplied by the send gate after the send record is durable. A
   * v1 implementation that ignores the second argument stays assignable.
   */
  requestSend(packet: PacketLink, binding?: SendBinding): void;
}

/** The destination and single-use identity a send is bound to. */
export interface SendBinding {
  readonly sendId: string;
  readonly destinationId: string;
  readonly destinationLabel: string;
}

// ---------------------------------------------------------------------------
// Handoff status and returns (read-only ports; neither can send)

export const HANDOFF_STATES = ['not-sent', 'submitting', 'unknown', 'queued', 'held', 'running', 'returned', 'failed', 'cancelled'] as const;
export type HandoffState = (typeof HANDOFF_STATES)[number];

/** Host and model, exactly as pinned or reported. Never defaulted. */
export interface HostModel {
  readonly host?: string;
  readonly model?: string;
}

/**
 * Per-packet status as the connector reports it. The composition layer maps the
 * connector's dispatch lifecycle onto these states; requests never imports it.
 */
export interface HandoffStatus {
  readonly schema: typeof HANDOFF_STATUS_SCHEMA;
  readonly packet: PacketLink;
  readonly state: HandoffState;
  /** When the connector last observed this state: the status's freshness. */
  readonly observedAt: string;
  readonly destination?: { readonly destinationId: string; readonly label: string };
  /** What the send asked for. */
  readonly pinned?: HostModel;
  /** What the receiver reports it ran on. */
  readonly actual?: HostModel;
  readonly detail?: string;
}

/**
 * Read-only status readback. It deliberately has no send method, and the
 * session hands it nothing else, so polling can never dispatch.
 */
export interface HandoffStatusPort {
  read(packet: PacketLink): Promise<HandoffStatus | null>;
}

/** Read-only readback of returned candidates. Values are untrusted and re-validated. */
export interface ReturnsPort {
  list(requestId: RequestId): Promise<readonly unknown[]>;
}

/** The durable record written before a send reaches transport. One per packet, ever. */
export interface SendRecord {
  readonly schema: typeof SEND_SCHEMA;
  readonly sendId: string;
  readonly requestId: RequestId;
  readonly packet: PacketLink;
  readonly destination: { readonly destinationId: string; readonly label: string };
  readonly at: string;
}

// ---------------------------------------------------------------------------
// Navigation-only intents

/**
 * Pure navigation requests emitted by the requests views. Their shapes carry no
 * payload that could name a send, and `NavigationPort` has no dispatch method.
 */
export type NavigationIntent =
  | { readonly type: 'open-request'; readonly requestId: RequestId }
  | { readonly type: 'open-packet'; readonly requestId: RequestId; readonly packetId: PacketId }
  | { readonly type: 'open-returned'; readonly requestId: RequestId; readonly candidateId: CandidateId }
  | { readonly type: 'open-runs'; readonly requestId: RequestId };

export interface NavigationPort {
  navigate(intent: NavigationIntent): void;
}

/** Before/after rendering is owned by the compare section. */
export interface CompareSlotProps {
  readonly baselineVersionId: VersionId;
  readonly candidateVersionId: VersionId;
  readonly label: string;
}
