/**
 * Section-local contract for the Design reference graph
 * (`hq.design.reference-graph/v1`, spec.hq-expansion#task.reference-graph.001).
 *
 * The graph is a separate workspace document beside the flat
 * `hq.design.references/v1` library; it never rewrites that library's shape.
 * Subjects (site/page, app/flow/screen) have identities derived from canonical
 * identity, never from titles. Captures are immutable references to exact asset
 * digests. Section and element anchors bind a capture id and its exact digest.
 */
import type {
  AppPlatform, AssetRef, BlobDigest, Brand, ClaimLevel, ImportAsset, NativeExecutionEvidence, ProjectId,
  ReferenceId, ReferenceKind, RightsStatus, ViewId,
} from './contract.ts';

export const GRAPH_SCHEMA = 'hq.design.reference-graph/v1' as const;
export const GRAPH_DOCUMENT_KEY = 'design/references/graph';

/** `sub_` + 64 lowercase hex: SHA-256 of the JCS canonical subject identity. */
export type SubjectId = Brand<'SubjectId'>;
/** `cap_` + 64 lowercase hex: SHA-256 of the JCS capture identity. */
export type CaptureId = Brand<'CaptureId'>;
/** `anc_` + 64 lowercase hex: SHA-256 of the JCS anchor identity. */
export type AnchorId = Brand<'AnchorId'>;
/** `pin_` + 64 lowercase hex: SHA-256 of the JCS pin identity (so pinning is idempotent). */
export type PinId = Brand<'PinId'>;

export const SUBJECT_KINDS = ['site', 'page', 'app', 'flow', 'screen'] as const;
export type SubjectKind = (typeof SUBJECT_KINDS)[number];
/** Subjects that may carry captures; `site` and `app` are containers. */
export const CAPTURE_SUBJECT_KINDS = ['page', 'flow', 'screen'] as const;

/** Canonical identity of a subject. Titles and display names never appear here. */
export type SubjectIdentity =
  | { readonly kind: 'site'; readonly origin: string }
  | { readonly kind: 'page'; readonly url: string }
  | { readonly kind: 'app'; readonly platform: AppPlatform; readonly appId: string }
  | { readonly kind: 'flow'; readonly app: SubjectId; readonly key: string }
  | { readonly kind: 'screen'; readonly app: SubjectId; readonly key: string };

export interface SubjectNode {
  readonly id: SubjectId;
  readonly kind: SubjectKind;
  readonly identity: SubjectIdentity;
  /** Derived from identity: site for a page, app for a flow or screen. */
  readonly parentId: SubjectId | null;
  /** Ordered screen subjects of a flow; empty for every other kind. */
  readonly steps: readonly SubjectId[];
  /** Display only. Imports never overwrite it. */
  readonly title: string;
  /** Owner judgement 1..5, set only by `setRating`; imports and re-captures never touch it. */
  readonly rating: number | null;
  readonly createdAt: string;
  readonly tombstonedAt: string | null;
}

/* ---------------------------------------------------------------- rights -- */

/** What the producer said, kept verbatim next to the conservative mapping. */
export interface DeclaredRights {
  readonly vocabulary: string;
  readonly value: string;
}

export interface GraphRights {
  readonly declared: DeclaredRights;
  /** Derived from `declared` by the registry; an unregistered pair is always `unknown`. */
  readonly effective: RightsStatus;
  /** Set by a registry mapping; a private capture never enters publishable output. */
  readonly private: boolean;
  readonly basis: string | null;
  readonly attribution: string | null;
  readonly setBy: ClaimLevel;
  readonly setAt: string;
}

/* ---------------------------------------------------------- availability -- */

/** Whether the capture's bytes can be served from workspace storage. */
export const CONTENT_AVAILABILITY = ['present', 'no-image', 'blob-missing'] as const;
export type ContentAvailability = (typeof CONTENT_AVAILABILITY)[number];

/**
 * What was last learned about the live source. `source-unavailable` means the
 * source could not be reached or judged; `missing-at-source` means the source
 * reported the subject gone. They are never merged.
 */
export const SOURCE_AVAILABILITY = ['unchecked', 'reachable', 'source-unavailable', 'missing-at-source'] as const;
export type SourceAvailability = (typeof SOURCE_AVAILABILITY)[number];

export interface CaptureAvailability {
  readonly content: ContentAvailability;
  readonly contentCheckedAt: string;
  readonly source: SourceAvailability;
  readonly sourceObservedAt: string | null;
  readonly sourceObservedBy: ClaimLevel | null;
}

/** The five distinguishable display states. */
export type AvailabilityLabel = 'present' | 'no-image' | 'blob-missing' | 'source-unavailable' | 'missing-at-source';

/* ----------------------------------------------------------- provenance -- */

export const CAPTURE_ORIGINS = ['import', 'flat-library', 'packet'] as const;
export type CaptureOrigin = (typeof CAPTURE_ORIGINS)[number];

/** Optional producer identity (for example a creative-reference pipeline). Never a dependency. */
export interface ProducerIdentity {
  readonly id: string;
  readonly label: string | null;
}

export interface CaptureProvenance {
  readonly producer: ProducerIdentity | null;
  readonly origin: CaptureOrigin;
  /** Digest of the packet that introduced the capture; non-null exactly when origin is `packet`. */
  readonly packetDigest: string | null;
}

export interface CaptureLineage {
  /** Previous capture of the same subject at creation time; immutable. */
  readonly supersedes: CaptureId | null;
}

export interface CaptureRecord {
  readonly id: CaptureId;
  readonly subjectId: SubjectId;
  readonly kind: ReferenceKind;
  /** Stable key for a capture with no asset; null whenever there is an asset. */
  readonly captureKey: string | null;
  readonly asset: AssetRef | null;
  readonly capturedAt: string;
  readonly capturedBy: ClaimLevel;
  readonly nativeEvidence: NativeExecutionEvidence | null;
  /** Link to the flat v1 reference this capture came from, when adopted from the library. */
  readonly referenceId: ReferenceId | null;
  readonly provenance: CaptureProvenance;
  readonly lineage: CaptureLineage;
  readonly rights: GraphRights;
  readonly availability: CaptureAvailability;
  readonly importedAt: string;
  readonly lastImportedAt: string;
  readonly importCount: number;
  readonly tombstonedAt: string | null;
}

/* --------------------------------------------------------------- anchors -- */

export const ANCHOR_KINDS = ['section', 'element'] as const;
export type AnchorKind = (typeof ANCHOR_KINDS)[number];

/** Fractions of the capture, each within 0..1. */
export interface AnchorRect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/** A section or element of one exact capture. Bound to the capture id and its asset digest. */
export interface AnchorNode {
  readonly id: AnchorId;
  readonly captureId: CaptureId;
  readonly assetDigest: BlobDigest;
  readonly kind: AnchorKind;
  readonly key: string;
  readonly parentId: AnchorId | null;
  readonly label: string;
  readonly rect: AnchorRect | null;
  readonly createdAt: string;
}

/** Project pin to an exact immutable capture (and optionally one of its anchors). */
export interface ReferencePin {
  readonly id: PinId;
  readonly projectId: ProjectId;
  readonly viewId: ViewId | null;
  readonly captureId: CaptureId;
  readonly assetDigest: BlobDigest | null;
  readonly anchorId: AnchorId | null;
  readonly purpose: string;
  readonly pinnedAt: string;
  readonly tombstonedAt: string | null;
}

export interface GraphState {
  readonly schema: typeof GRAPH_SCHEMA;
  readonly subjects: Readonly<Record<string, SubjectNode>>;
  readonly captures: Readonly<Record<string, CaptureRecord>>;
  readonly anchors: Readonly<Record<string, AnchorNode>>;
  readonly pins: Readonly<Record<string, ReferencePin>>;
}

/* --------------------------------------------------------- import shapes -- */

export interface DeclaredRightsInput {
  readonly vocabulary: string;
  readonly value: string;
  readonly basis?: string;
  readonly attribution?: string;
  /** Honored only when adopting the flat library, whose rights already carry a claim level. */
  readonly setBy?: string;
}

export interface GraphAnchorCandidate {
  readonly key: string;
  readonly kind: string;
  readonly label: string;
  readonly parentKey?: string;
  readonly rect?: AnchorRect;
}

export interface GraphCaptureCandidate {
  readonly kind: string;
  readonly capturedAt: string;
  readonly capturedBy: string;
  readonly asset?: ImportAsset;
  /** Required when there is no asset, forbidden otherwise. */
  readonly captureKey?: string;
  readonly nativeEvidence?: { readonly platform: string; readonly runtime: string; readonly buildRef: string; readonly claim: string };
  /** Absence means "no statement": the capture is `unknown` and re-imports never tighten or change rights. */
  readonly rights?: DeclaredRightsInput;
  readonly producer?: { readonly id: string; readonly label?: string };
  /** What the importer learned about the live source; absence means unchecked. */
  readonly sourceStatus?: string;
  readonly anchors?: readonly GraphAnchorCandidate[];
  readonly referenceId?: string;
}

export interface WebsitePageCandidate {
  readonly url: string;
  readonly title: string;
  readonly captures?: readonly GraphCaptureCandidate[];
}

export interface WebsiteTreeCandidate {
  readonly kind: 'website';
  readonly origin: string;
  readonly title: string;
  readonly pages: readonly WebsitePageCandidate[];
}

export interface AppScreenCandidate {
  readonly key: string;
  readonly title: string;
  readonly captures?: readonly GraphCaptureCandidate[];
}

export interface AppFlowCandidate {
  readonly key: string;
  readonly title: string;
  /** Screen keys in order; every key must name a screen in the same tree. */
  readonly steps: readonly string[];
  readonly captures?: readonly GraphCaptureCandidate[];
}

export interface AppTreeCandidate {
  readonly kind: 'app';
  readonly platform: string;
  readonly appId: string;
  readonly title: string;
  readonly screens: readonly AppScreenCandidate[];
  readonly flows?: readonly AppFlowCandidate[];
}

export type GraphTreeCandidate = WebsiteTreeCandidate | AppTreeCandidate;

export type SubjectOutcomeStatus = 'created' | 'unchanged' | 'updated' | 'tombstoned';
export type CaptureOutcomeStatus = 'created' | 'unchanged' | 'observed-again' | 'tombstoned';

export interface TreeImportReport {
  readonly status: 'created' | 'observed-again' | 'unchanged';
  readonly subjects: readonly { readonly id: SubjectId; readonly status: SubjectOutcomeStatus }[];
  readonly captures: readonly {
    readonly id: CaptureId;
    readonly status: CaptureOutcomeStatus;
    readonly differences: readonly string[];
  }[];
  readonly anchors: { readonly created: number; readonly existing: number };
}

export type TreeImportOutcome =
  | ({ readonly ok: true } & TreeImportReport)
  | { readonly ok: false; readonly issues: readonly { readonly field: string; readonly code: string }[] };
