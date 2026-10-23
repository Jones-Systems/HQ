/**
 * Section-local contract for HQ Design taste (T7 / HQD-06).
 *
 * Clean-room: shapes derive from the public HQ Design plan only. Root may
 * promote these into @hq/contracts; until then other sections must not import
 * them. Everything here is erasable TypeScript and free of Node/DOM imports.
 */

export type Brand<T, K extends string> = T & { readonly __kind: K };

export type ProjectId = Brand<string, 'ProjectId'>;
export type SubjectId = Brand<string, 'SubjectId'>;
export type AssessmentId = Brand<string, 'AssessmentId'>;
export type NoteId = Brand<string, 'NoteId'>;
export type CounterevidenceId = Brand<string, 'CounterevidenceId'>;
export type ExampleId = Brand<string, 'ExampleId'>;
export type ClientEventId = Brand<string, 'ClientEventId'>;
export type AspectId = Brand<string, 'AspectId'>;

export const MAX_ID_LENGTH = 160;
export const MAX_LABEL_LENGTH = 300;
export const MAX_TEXT_LENGTH = 4000;

/** Nonempty, bounded, trimmed and free of control characters. */
export function isIdentifier(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= MAX_ID_LENGTH
    && value.trim() === value && !/[\u0000-\u001f\u007f]/u.test(value);
}

function brand<K extends string>(kind: K) {
  return (value: string): Brand<string, K> => {
    if (!isIdentifier(value)) throw new TypeError(`Invalid ${kind}`);
    return value as Brand<string, K>;
  };
}

export const projectId = brand('ProjectId');
export const subjectId = brand('SubjectId');
export const assessmentId = brand('AssessmentId');
export const noteId = brand('NoteId');
export const counterevidenceId = brand('CounterevidenceId');
export const exampleId = brand('ExampleId');
export const clientEventId = brand('ClientEventId');
export const aspectId = brand('AspectId');

/** General taste and each project's taste are separate scopes. */
export type TasteScope =
  | { readonly kind: 'general' }
  | { readonly kind: 'project'; readonly projectId: ProjectId };

/** Liking ("do I like it") never mixes with description ("how much it shows a quality"). */
export const JUDGMENTS = ['liking', 'descriptive'] as const;
export type Judgment = (typeof JUDGMENTS)[number];

export type RatingTarget =
  | { readonly kind: 'overall' }
  | { readonly kind: 'aspect'; readonly aspect: AspectId };

export const RATING_VALUES = [1, 2, 3, 4, 5] as const;
export type RatingValue = (typeof RATING_VALUES)[number];

export const SUBJECT_KINDS = ['version', 'reference', 'component', 'flow', 'other'] as const;
export type SubjectKind = (typeof SUBJECT_KINDS)[number];

/** What is being judged. The label is display-only; identity is `id`. */
export interface TasteSubject {
  readonly id: SubjectId;
  readonly kind: SubjectKind;
  readonly label: string;
  /** Exact source revision when the subject is a Design version; never "latest". */
  readonly versionId?: string;
}

/** An owner's rating. A re-rating names the assessment it supersedes. */
export interface AssessmentRecorded {
  readonly type: 'assessment.recorded';
  readonly assessmentId: AssessmentId;
  readonly scope: TasteScope;
  readonly subject: TasteSubject;
  readonly judgment: Judgment;
  readonly target: RatingTarget;
  readonly value: RatingValue;
  readonly supersedes: AssessmentId | null;
}

export interface NoteAdded {
  readonly type: 'note.added';
  readonly noteId: NoteId;
  readonly scope: TasteScope;
  readonly subjectId: SubjectId | null;
  readonly about: AssessmentId | null;
  readonly text: string;
}

/** Evidence that cuts against a stated preference; kept, never averaged away. */
export interface CounterevidenceAdded {
  readonly type: 'counterevidence.added';
  readonly counterevidenceId: CounterevidenceId;
  readonly scope: TasteScope;
  readonly judgment: Judgment;
  readonly target: RatingTarget;
  readonly subjectId: SubjectId | null;
  readonly contradicts: AssessmentId | null;
  readonly text: string;
}

export const EXAMPLE_SOURCE_KINDS = ['reference-library', 'import', 'other'] as const;
export type ExampleSourceKind = (typeof EXAMPLE_SOURCE_KINDS)[number];

export interface ClaimedRating {
  readonly judgment: Judgment;
  readonly target: RatingTarget;
  readonly value: RatingValue;
}

/**
 * An imported example. It may carry ratings claimed by its source, but those
 * are provenance, never owner judgments, and never enter profile statistics.
 */
export interface ExampleImported {
  readonly type: 'example.imported';
  readonly exampleId: ExampleId;
  readonly scope: TasteScope;
  readonly subject: TasteSubject;
  readonly source: { readonly kind: ExampleSourceKind; readonly label: string };
  readonly claimed: readonly ClaimedRating[];
}

/** Explicit owner choice; absent means the project does not feed general taste. */
export interface ProjectContributionSet {
  readonly type: 'project-contribution.set';
  readonly projectId: ProjectId;
  readonly contributesToGeneral: boolean;
}

export type TasteEvent =
  | AssessmentRecorded
  | NoteAdded
  | CounterevidenceAdded
  | ExampleImported
  | ProjectContributionSet;

/** One JSONL line. `hash` covers the JCS form of every other field. */
export interface JournalRecord {
  readonly v: 1;
  readonly seq: number;
  readonly prev: string;
  readonly clientEventId: ClientEventId;
  readonly recordedAt: string;
  readonly payloadDigest: string;
  readonly payload: TasteEvent;
  readonly hash: string;
}

export const GENESIS_HASH = '0'.repeat(64);

export type FailClosedReason =
  | 'incomplete-tail'
  | 'invalid-encoding'
  | 'invalid-json'
  | 'non-canonical-record'
  | 'invalid-record'
  | 'sequence-gap'
  | 'broken-link'
  | 'hash-mismatch'
  | 'payload-digest-mismatch'
  | 'duplicate-client-event-id'
  | 'partial-write'
  | 'sync-failed'
  | 'write-failed';

export interface JournalHead {
  readonly seq: number;
  readonly hash: string;
}

export type JournalStatus =
  | { readonly state: 'open'; readonly head: JournalHead }
  | {
    readonly state: 'fail-closed';
    readonly reason: FailClosedReason;
    /** Verified records before the first fault; the file itself is never truncated. */
    readonly verifiedRecords: number;
    /** 1-based line of the first fault, when known. */
    readonly line: number | null;
    readonly head: JournalHead;
  }
  | { readonly state: 'closed' };

export type AppendResult =
  | { readonly status: 'appended'; readonly record: JournalRecord }
  | { readonly status: 'duplicate'; readonly record: JournalRecord }
  | { readonly status: 'conflict'; readonly existing: JournalRecord }
  | { readonly status: 'rejected'; readonly reason: string }
  | { readonly status: 'fail-closed'; readonly reason: FailClosedReason }
  | { readonly status: 'closed' };

/** Lock holder written into the single-writer lock file. No host names or paths. */
export interface LockHolder {
  readonly token: string;
  readonly pid: number;
  readonly acquiredAt: string;
}

export type LockAcquisition =
  | { readonly acquired: true }
  | { readonly acquired: false; readonly holder: LockHolder | null };

export interface AppendHandle {
  /** Returns the number of bytes durably handed to the OS; fewer than requested is a partial write. */
  write(bytes: Uint8Array): Promise<number>;
  /** fsync/fdatasync. Only after this resolves may an append be acknowledged. */
  sync(): Promise<void>;
  close(): Promise<void>;
}

/**
 * Main-side file port. Root wires the Node adapter; tests use the labelled
 * fault-injecting fake. Paths are opaque strings chosen by root.
 */
export interface TasteFileSystem {
  readFile(path: string): Promise<Uint8Array | null>;
  /** Opens for append, creating when missing. `created` means the directory entry needs a sync. */
  openAppend(path: string): Promise<{ readonly handle: AppendHandle; readonly created: boolean }>;
  syncDirectoryOf(path: string): Promise<void>;
  acquireLock(lockPath: string, holder: LockHolder): Promise<LockAcquisition>;
  releaseLock(lockPath: string, token: string): Promise<void>;
  /** False only when the holder is provably gone; unknown counts as alive. */
  isLockHolderAlive(holder: LockHolder): Promise<boolean>;
  /** Atomically removes a stale lock only if it still names `token`. */
  reclaimStaleLock(lockPath: string, token: string): Promise<boolean>;
}

/** SHA-256 lowercase hex. Async so WebCrypto and node:crypto both fit. */
export type Sha256Hex = (bytes: Uint8Array) => Promise<string>;

export interface Clock {
  now(): string;
}

/** Feature switches. Guidance and legacy reuse are fixed off by type. */
export interface TasteFeatureFlags {
  readonly ratingControls: boolean;
  readonly automaticGuidance: false;
  readonly legacyJournalReuse: false;
}

export interface SampleLimit {
  readonly limited: boolean;
  readonly count: number;
  readonly threshold: number;
  /** Visible label when limited; null otherwise. */
  readonly label: string | null;
}

export interface RatingSummary {
  readonly judgment: Judgment;
  readonly target: RatingTarget;
  /** Current (non-superseded) owner assessments only. */
  readonly count: number;
  readonly mean: number | null;
  /** Counts for values 1..5. */
  readonly distribution: readonly [number, number, number, number, number];
  readonly superseded: number;
  readonly counterevidence: number;
  readonly sample: SampleLimit;
}

export type ProfileScope =
  | { readonly kind: 'general'; readonly includedProjects: readonly ProjectId[] }
  | { readonly kind: 'project'; readonly projectId: ProjectId };

export interface ProfileNote {
  readonly id: NoteId | CounterevidenceId;
  readonly kind: 'note' | 'counterevidence';
  readonly scope: TasteScope;
  readonly text: string;
  readonly target: RatingTarget | null;
  readonly judgment: Judgment | null;
  readonly subjectId: SubjectId | null;
}

export interface TasteProfile {
  readonly schema: 'hq.design.taste-profile/v1';
  readonly scope: ProfileScope;
  readonly journalHead: JournalHead;
  readonly claimLevel: 'owner-judged';
  /** Distinct subjects with at least one current owner assessment. */
  readonly sample: SampleLimit;
  readonly summaries: readonly RatingSummary[];
  readonly notes: readonly ProfileNote[];
  /** Imported examples are listed and counted separately; they are not judgments. */
  readonly importedExamples: { readonly count: number; readonly ownerJudgment: false };
}

/** Renderer view of one assessment's history (newest last). */
export interface AssessmentView {
  readonly assessmentId: AssessmentId;
  readonly seq: number;
  readonly recordedAt: string;
  readonly scope: TasteScope;
  readonly subject: TasteSubject;
  readonly judgment: Judgment;
  readonly target: RatingTarget;
  readonly value: RatingValue;
  readonly supersedes: AssessmentId | null;
  readonly supersededBy: AssessmentId | null;
}

export interface ExampleView {
  readonly exampleId: ExampleId;
  readonly scope: TasteScope;
  readonly subject: TasteSubject;
  readonly source: { readonly kind: ExampleSourceKind; readonly label: string };
  readonly claimed: readonly ClaimedRating[];
}

export interface TasteSnapshot {
  readonly journal: JournalStatus;
  readonly assessments: readonly AssessmentView[];
  readonly notes: readonly ProfileNote[];
  readonly examples: readonly ExampleView[];
  readonly contributions: Readonly<Record<string, boolean>>;
  readonly general: TasteProfile;
  readonly project: TasteProfile | null;
}

export interface TasteCommand {
  readonly clientEventId: ClientEventId;
  readonly event: TasteEvent;
}

export interface ProfileExportOptions {
  readonly scope: TasteScope;
  readonly includeNotes: boolean;
  readonly includeCounterevidence: boolean;
}

export interface ProfileExport {
  readonly json: string;
  /** SHA-256 of the exported JCS bytes. */
  readonly digest: string;
  readonly omitted: readonly string[];
}

/**
 * Renderer-facing port. Root wires it to the main-side TasteService over a
 * typed channel; the preview harness wires an in-memory labelled fake.
 * There is deliberately no method that activates guidance or model defaults.
 */
export interface TasteClientPort {
  readonly label: string;
  snapshot(projectId: ProjectId | null): Promise<TasteSnapshot>;
  submit(command: TasteCommand): Promise<AppendResult>;
  exportProfile(options: ProfileExportOptions): Promise<ProfileExport>;
}
