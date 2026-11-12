import type { Brand, Channel, SocialWorkspacePort } from './port';
export const FEATURE_HQ_SOURCES = 'hq-sources-v1';
export const FEATURE_HQ_PUBLISHING = 'hq-publishing-simulator-v1';
export const SOURCE_KINDS = ['feed-items', 'tiktok-niche', 'tiktok-manifest', 'tiktok-records', 'seo-config', 'seo-packet', 'search-panel', 'search-entities', 'search-inventory', 'search-answers', 'reddit-bundle', 'creator-batch'] as const;
export type SourceKind = typeof SOURCE_KINDS[number];
export interface SaveSource { name: string; kind: SourceKind; file_name: string; text: string; as_of: string }
export interface SourceRecord extends Omit<SaveSource, 'text' | 'as_of'> {
  id: string; sha256: string; bytes: number; records: number; as_of: string | null;
  imported_at: string; archived: 0 | 1; status: 'valid' | 'stale'; age_days: number | null; used_by_runs: string[];
}
export interface SourceContent extends SourceRecord { content: unknown }
export type AccountChannel = Exclude<Channel, 'General' | 'Article'>;
export interface SimulatedConnection {
  id: string; channel: AccountChannel; label: string; status: 'simulated' | 'disconnected';
  created_at: string; disconnected_at: string | null;
}
export interface PublishRequest {
  id: string; connection_id: string; channel: AccountChannel; draft_id: string; draft_version: number;
  content: { title: string; body: string }; content_sha256: string;
  status: 'pending_approval' | 'cancelled' | 'invalidated' | 'delivered_simulated' | 'failed';
  created_at: string; decided_at: string | null;
  receipt: null | { simulated: true; delivered_at: string; outbox_sequence: number; readback: 'simulated' };
}
export interface PublishingSnapshot { mode: 'simulator'; connections: SimulatedConnection[]; requests: PublishRequest[] }
/** Additive interface: legacy ports remain valid and cannot advertise these implementations implicitly. */
export interface ExtendedSocialWorkspacePort extends SocialWorkspacePort {
  setBrandProject(brandId: string, projectId: string | null): Promise<Brand>;
  source(id: string): Promise<SourceContent>;
  saveSource(input: SaveSource): Promise<SourceRecord>;
  setSourceArchived(id: string, archived: 0 | 1): Promise<SourceRecord>;
  connectChannel(channel: AccountChannel, label: string): Promise<SimulatedConnection>;
  disconnectChannel(id: string): Promise<SimulatedConnection>;
  requestPublish(draftId: string, draftVersion: number, connectionId: string): Promise<PublishRequest>;
  cancelPublish(id: string): Promise<PublishRequest>;
  approvePublish(id: string, contentSha256: string): Promise<PublishRequest>;
}
export const EXTENSION_CALL_CLASSES = {
  setBrandProject: 'content', source: 'read', saveSource: 'content', setSourceArchived: 'content',
  connectChannel: 'content', disconnectChannel: 'content', requestPublish: 'content', cancelPublish: 'content',
  approvePublish: 'execution',
} as const;
export function validProjectId(value: unknown): value is string | null {
  return value === null || (typeof value === 'string' && value.length >= 1 && value.length <= 160
    && value.trim() === value && !/[\u0000-\u001f\u007f-\u009f]/u.test(value));
}
