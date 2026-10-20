import type { ReferenceEnvelope } from '@hq/contracts';

/**
 * SocialWorkspacePort (spec.hq-social-work#iface.social-port.001).
 * Semantics mirror the delivered Social workspace service (Fieldnotes); see
 * docs/evidence/hq-social-work/social-content/README.md for recorded divergences.
 */

export const CHANNELS = ['General', 'X', 'LinkedIn', 'TikTok', 'Instagram', 'Facebook', 'Reddit', 'Article'] as const;
export type Channel = (typeof CHANNELS)[number];

export const TOOL_IDS = [
  'tiktok-intelligence', 'x-intelligence', 'x-studio', 'seo-studio',
  'search-visibility', 'social-publisher', 'reddit-opportunities', 'creator-relationships',
] as const;
export type ToolId = (typeof TOOL_IDS)[number];

export const TOOL_CATEGORIES = ['Discover', 'Create', 'Measure', 'Plan', 'Connect'] as const;
export type ToolCategory = (typeof TOOL_CATEGORIES)[number];

export const RUN_STATUSES = ['queued', 'running', 'succeeded', 'failed', 'interrupted'] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];
/** Client-side observation: `unknown` is never a service status, only an unproved submission. */
export type ObservedRunStatus = RunStatus | 'unknown';
export const ACTIVE_RUN_STATUSES: readonly RunStatus[] = ['queued', 'running'];

/** The service's built-in brand. It is shown as present, never created. */
export const DEFAULT_BRAND_ID = 'default';

/** Capability names advertised in `WorkspaceSnapshot.features`. Today's service advertises none. */
export const FEATURE_HQ_REFERENCES = 'hq-references-v1';
export const FEATURE_HQ_BRAND_PROJECT = 'hq-brand-project-v1';

/**
 * Fields that exist only as proposals to the Social service owner
 * (spec.hq-social-work#iface.service-reference-extensions.001). UI must label them as proposed.
 */
export const PROPOSED_SCHEMA = {
  [FEATURE_HQ_REFERENCES]: { fields: ['Draft.links'], status: 'proposed' },
  [FEATURE_HQ_BRAND_PROJECT]: { fields: ['Brand.project_id'], status: 'proposed' },
} as const;

/** Proposed limit for `Draft.links`; not a delivered service rule. */
export const MAX_DRAFT_LINKS = 30;

export interface Brand {
  id: string;
  name: string;
  /** Proposed Social-owned mapping to an opaque HQ project ID; only with `hq-brand-project-v1`. */
  project_id?: string | null;
}

export interface Draft {
  id: string;
  title: string;
  body: string;
  brand_id: string;
  channel: Channel;
  /** '' or YYYY-MM-DD. A planning label, never a schedule. */
  planned_date: string;
  archived: 0 | 1;
  version: number;
  updated_at: string;
  /** Proposed; present only when the service advertises `hq-references-v1`. */
  links?: ReferenceEnvelope[];
}

export interface Tool {
  id: ToolId;
  name: string;
  category: ToolCategory;
  description: string;
  mark: string;
}

export interface RunRecord {
  id: string;
  tool: ToolId;
  status: RunStatus;
  is_example: 0 | 1;
  created_at: string;
  finished_at: string | null;
  error: string | null;
  output?: unknown;
}

export interface WorkspaceSnapshot {
  brands: Brand[];
  content: Draft[];
  /** Latest 200, newest first. */
  runs: RunRecord[];
  tools: Tool[];
  features: string[];
  observedAt: string;
}

export type DraftFields = Omit<Draft, 'id' | 'version' | 'updated_at'>;
export type SaveDraft = DraftFields & ({ id?: undefined } | { id: string; version: number });

export type PortError =
  | { kind: 'invalid'; message: string }
  | { kind: 'conflict'; message: string }
  | { kind: 'not_found' }
  | { kind: 'forbidden' }
  | { kind: 'unavailable' }
  | { kind: 'unknown'; attemptedAt: string };

/** Port methods reject with this; `error` is the `PortError` value. */
export class PortFailure extends Error {
  readonly error: PortError;
  constructor(error: PortError) {
    super('message' in error ? error.message : error.kind);
    this.name = 'PortFailure';
    this.error = error;
  }
}

export function isPortFailure(reason: unknown): reason is PortFailure {
  return reason instanceof PortFailure;
}

/** The PortError carried by a rejection, or null when the rejection is not a port error. */
export function portErrorOf(reason: unknown): PortError | null {
  return isPortFailure(reason) ? reason.error : null;
}

export interface SocialWorkspacePort {
  /** content class */
  snapshot(): Promise<WorkspaceSnapshot>;
  /** content class; `conflict` on a stale version, never a silent overwrite */
  saveDraft(draft: SaveDraft): Promise<Draft>;
  /** content class */
  addBrand(name: string): Promise<Brand>;
  /** read class */
  example(tool: ToolId): Promise<Record<string, unknown>>;
  /** read class */
  run(id: string): Promise<RunRecord>;
  /** EXECUTION class. Adapters never retry it; a lost response rejects `unknown`. */
  submitRun(tool: ToolId, input: Record<string, unknown>, isExample: boolean): Promise<RunRecord>;
}

export type CallClass = 'content' | 'read' | 'execution';
export type PortMethod = keyof SocialWorkspacePort;

/** Exhaustive by type: adding a port method without classifying it fails typecheck. */
export const CALL_CLASSES: { readonly [M in PortMethod]: CallClass } = {
  snapshot: 'content',
  saveDraft: 'content',
  addBrand: 'content',
  example: 'read',
  run: 'read',
  submitRun: 'execution',
};

export function hasFeature(snapshot: Pick<WorkspaceSnapshot, 'features'>, feature: string): boolean {
  return snapshot.features.includes(feature);
}
