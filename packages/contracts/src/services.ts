import type { CatalogParams, CatalogValues } from './catalog.js';
import type { DesignRecordParams as importRecordParams, DesignRecordValues as importRecordValues } from './design-records.js';
/** Closed desktop capabilities. One shared renderer realm: domain use is a convention, not isolation. */
export type ServiceResponse<B = unknown> =
  | { readonly ok: true; readonly status: number; readonly body: B; readonly replayed: boolean }
  | { readonly ok: false; readonly kind: 'unavailable' | 'unknown' };

export const SOCIAL_SERVICE_ROUTES = ['workspace', 'sample', 'run', 'saveContent', 'addBrand', 'submitRun'] as const;
export type SocialServiceRoute = (typeof SOCIAL_SERVICE_ROUTES)[number];
/** Structurally identical to the Social live transport. Main validates the closed body keys. */
export interface SocialServiceParams {
  readonly workspace: Record<string, never>;
  readonly sample: { readonly tool: string };
  readonly run: { readonly id: string };
  readonly saveContent: Readonly<Record<string, unknown>>;
  readonly addBrand: { readonly name: string };
  readonly submitRun: { readonly tool: string; readonly input: Record<string, unknown>; readonly is_example: boolean };
}
export interface SocialServiceTransport {
  call<R extends SocialServiceRoute>(route: R, params: SocialServiceParams[R]): Promise<ServiceResponse>;
}

export const WORK_SERVICE_ROUTES = ['state', 'version', 'item', 'history', 'create', 'patch', 'move', 'archive', 'restore', 'reviewed', 'settings', 'replay', 'export'] as const;
export type WorkServiceRoute = (typeof WORK_SERVICE_ROUTES)[number];
export type WorkMutationRoute = 'create' | 'patch' | 'move' | 'archive' | 'restore' | 'reviewed' | 'settings';
export interface WorkServiceParams {
  readonly export: { readonly format: 'json' | 'markdown' };
  readonly state: Record<string, never>;
  readonly version: Record<string, never>;
  readonly item: { readonly id: string };
  readonly history: { readonly id: string };
  readonly create: { readonly requestId: string; readonly fields: Readonly<Record<string, unknown>> };
  readonly patch: { readonly requestId: string; readonly id: string; readonly revision: number; readonly patch: Readonly<Record<string, unknown>> };
  readonly move: { readonly requestId: string; readonly id: string; readonly revision: number; readonly status: string; readonly after_id?: string; readonly before_id?: string; readonly place?: 'top' | 'bottom' };
  readonly archive: { readonly requestId: string; readonly id: string; readonly revision: number };
  readonly restore: WorkServiceParams['archive'];
  readonly reviewed: WorkServiceParams['archive'];
  readonly settings: { readonly requestId: string; readonly settings: Readonly<Record<string, unknown>> };
  readonly replay: { readonly mode: 'lookup' | 'resend'; readonly requestId: string; readonly original: WorkMutationCall; readonly sentAfterVersion?: number };
}
export type WorkMutationCall = { [R in WorkMutationRoute]: { readonly route: R; readonly params: WorkServiceParams[R] } }[WorkMutationRoute];
export interface WorkServiceTransport {
  call<R extends WorkServiceRoute>(route: R, params: WorkServiceParams[R]): Promise<ServiceResponse>;
}

export type JsonValue = null | boolean | number | string | readonly JsonValue[] | { readonly [key: string]: JsonValue };
export interface StoredDocument {
  readonly namespace: string;
  readonly key: string;
  readonly revision: number;
  readonly valueDigest: string;
  readonly updatedAt: string;
  readonly value: JsonValue;
}
export type DesignStorageResult<T> = { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly kind: 'conflict' | 'invalid' | 'read-only' | 'unavailable' | 'unknown'; readonly reason?: 'disabled' };
export const DESIGN_SERVICE_ROUTES = ['doc.get', 'doc.put', 'doc.list', 'cache.get', 'cache.put', 'blob.put', 'blob.get', 'blob.has', 'event.append', 'event.read', 'import.commit', 'import.status', 'import.repair', 'storage.diagnostics', 'export.preview', 'export.save', 'catalog.roots', 'catalog.chooseRoot', 'catalog.forget', 'catalog.snapshot', 'catalog.preview', 'import.pick'] as const;
export type DesignServiceRoute = (typeof DESIGN_SERVICE_ROUTES)[number];
export type ImportPickResult = { readonly status: 'canceled' }
  | { readonly status: 'rejected'; readonly reason: 'unavailable' | 'invalid-selection' | 'too-many-files' | 'not-regular-file' | 'file-too-large' | 'total-too-large' | 'invalid-png' | 'file-changed' | 'read-limit' }
  | { readonly status: 'picked'; readonly files: readonly { readonly name: string; readonly mediaType: 'image/png'; readonly bytes: Uint8Array }[] };
export interface DesignServiceParams extends importRecordParams, CatalogParams {
  readonly 'import.pick': Record<string, never>;
  readonly 'doc.get': { readonly key: string };
  /** Absent: unconditional write. `null`: the key must not exist. A number: must equal the current revision. */
  readonly 'doc.put': { readonly key: string; readonly value: JsonValue; readonly expectedRevision?: number | null };
  readonly 'doc.list': { readonly prefix: string };
  readonly 'cache.get': { readonly key: string };
}
export interface DesignServiceValues extends importRecordValues, CatalogValues {
  readonly 'import.pick': ImportPickResult;
  readonly 'doc.get': StoredDocument | null;
  readonly 'doc.put': StoredDocument;
  readonly 'doc.list': string[];
  readonly 'cache.get': StoredDocument | null;
}
export interface DesignServiceTransport {
  call<R extends DesignServiceRoute>(route: R, params: DesignServiceParams[R]): Promise<DesignStorageResult<DesignServiceValues[R]>>;
}
export type ServiceDomain = 'social' | 'work';
export interface ServiceConfigInput { readonly domain: ServiceDomain; readonly baseUrl: string }
export interface ServiceConfigStatus { readonly configured: boolean; readonly policy: 'ok' | 'rejected'; readonly transport: 'https' | 'loopback-http' | null }
export interface ServiceConfigTransport {
  set(input: ServiceConfigInput): Promise<ServiceConfigStatus>;
  status(domain: ServiceDomain): Promise<ServiceConfigStatus>;
}
export interface HqServices {
  readonly sources?: Readonly<import('./catalog.js').SourceTransport>;
  readonly jonesCode?: Readonly<import('./jones-code.js').JonesTransport>;
  readonly preview?: Readonly<import('./preview.js').PreviewTransport>;
  readonly wikiAdmin?: Readonly<import('./wiki-admin.js').WikiAdminTransport>;
  readonly wiki?: Readonly<import('./wiki.js').WikiServiceTransport>;
  readonly social: Readonly<SocialServiceTransport>;
  readonly work: Readonly<WorkServiceTransport>;
  readonly design: Readonly<DesignServiceTransport>;
  readonly config: Readonly<ServiceConfigTransport>;
}
declare global { interface Window { readonly hqServices?: Readonly<HqServices> } }
