export interface GenerationBinding {
  origin: string;
  publisherId: string;
  hostId: string;
  rootId: string;
  bindingRevision: string;
  scopeDigest: string;
  consistencyMode: 'observed-files-v1' | 'producer-complete-v1';
}

export interface GenerationIdentity {
  rootId: string;
  epoch: string;
  sequence: string;
  manifestSha256: string;
}

export interface PublicationIdentity { epoch: string; sequence: string; manifest_sha256: string }
export interface GenerationRef extends PublicationIdentity {
  schema: 'hq-sync.ref/v1';
  publisher_id: string;
  host_id: string;
  root_id: string;
  binding_revision: string;
  scope_digest: string;
  manifest_path: string;
}
export interface GenerationFile { path: string; size: number; sha256: string; media_type: string }
export interface GenerationPresentation {
  id: string;
  kind: 'file' | 'static';
  entry_path: string;
  preview_path: string | null;
  dependency_mode: 'independent-file' | 'declared-transitive' | 'entire-eligible-tree';
  required_paths: string[];
}
export interface GenerationManifest {
  schema: 'hq-sync.manifest/v1';
  publisher_id: string;
  host_id: string;
  root_id: string;
  binding_revision: string;
  scope_digest: string;
  epoch: string;
  sequence: string;
  predecessor: PublicationIdentity | null;
  published_at: string;
  capture: {
    method: GenerationBinding['consistencyMode'];
    observation_id: string;
    started_at: string;
    finished_at: string;
    source_generation: string | null;
    source_inventory_sha256: string | null;
    point_in_time: boolean;
    application_completion: 'not-asserted' | 'producer-declared-immutable';
  };
  inventory: { enumeration: 'complete-within-declared-scope'; file_count: number; total_bytes: number; inventory_sha256: string };
  files: GenerationFile[];
  presentations: GenerationPresentation[];
  retention_policy: 'no-automatic-deletion-v1';
}
export interface GenerationHealth {
  schema: 'hq-sync.health/v1';
  publisher_id: string;
  publisher_instance_id: string;
  root_id: string;
  binding_revision: string;
  scope_digest: string;
  observation_sequence: string;
  last_attempt_at: string | null;
  last_success_at: string | null;
  last_success_age_ms: number | null;
  source_status: 'ok' | 'changing' | 'missing' | 'unreadable' | 'limit_exceeded' | 'held';
  reason: string;
  observed_inventory_sha256: string | null;
  published: PublicationIdentity | null;
  pending_change: boolean;
  storage_status: 'ok' | 'storage_full' | 'unknown';
}
export interface PublisherHealth extends GenerationHealth { matchesRef: boolean }

export type HoldReason =
  | 'invalid_contract' | 'invalid_fields' | 'invalid_identity' | 'invalid_digest' | 'invalid_counter'
  | 'invalid_integer' | 'invalid_timestamp' | 'invalid_path' | 'depth_exceeded' | 'noncanonical_path'
  | 'path_collision' | 'document_too_deep' | 'invalid_encoding' | 'invalid_json' | 'document_too_large'
  | 'duplicate_key' | 'unsupported_schema' | 'invalid_manifest_path' | 'binding_mismatch'
  | 'epoch_reconciliation_required' | 'sequence_regression' | 'equal_sequence_digest_mismatch'
  | 'invalid_presentations' | 'duplicate_presentation' | 'unsupported_presentation'
  | 'missing_dependencies' | 'noncanonical_inventory' | 'preview_ineligible' | 'invalid_dependencies'
  | 'manifest_digest_mismatch' | 'unsupported_retention' | 'invalid_predecessor' | 'capture_mode_mismatch'
  | 'invalid_capture' | 'file_count_exceeded' | 'invalid_media_type' | 'generation_too_large'
  | 'inventory_mismatch' | 'invalid_status' | 'invalid_reason'
  | 'transport_unavailable' | 'http_status' | 'response_too_large' | 'unsupported_integer'
  | 'generation_missing' | 'blob_mismatch' | 'superseded' | 'store_unavailable' | 'store_uncertain';

export class GenerationError extends Error {
  constructor(readonly reason: HoldReason) { super(reason); this.name = 'GenerationError'; }
}
export function requireGeneration(condition: unknown, reason: HoldReason = 'invalid_contract'): asserts condition {
  if (!condition) throw new GenerationError(reason);
}
export type RefreshResult =
  | { status: 'activated'; generation: GenerationIdentity; previous: GenerationIdentity | null; health: PublisherHealth }
  | { status: 'current'; generation: GenerationIdentity; health: PublisherHealth }
  | { status: 'held'; reason: HoldReason; lastGood: GenerationIdentity | null };
export type FileResult =
  | { ok: true; bytes: Uint8Array; mediaType: string }
  | { ok: false; reason: 'not_in_generation' | 'unavailable' | 'blob_mismatch' | 'invalid_path' | 'store_uncertain' };
export interface GenerationConsumer {
  refresh(): Promise<RefreshResult>;
  current(): Promise<GenerationIdentity | null>;
  manifest(): Promise<GenerationManifest | null>;
  readFile(path: string): Promise<FileResult>;
}
