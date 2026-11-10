export type WikiAdminNamespace = 'bl' | 'appdev';
export type WikiSourceState = 'ready' | 'stale' | 'indexing' | 'index-unavailable' | 'source-unavailable' | 'not-configured';
export interface WikiAdminStatus {
  readonly revision: string;
  readonly sources: readonly { readonly namespace: WikiAdminNamespace; readonly state: WikiSourceState }[];
}
export interface WikiSelection { readonly token: string; readonly namespace: WikiAdminNamespace; readonly label: string }
export interface WikiAdminParams {
  readonly status: Record<string, never>;
  readonly importProfile: Record<string, never>;
  readonly chooseRepository: { readonly namespace: WikiAdminNamespace; readonly token?: string };
  readonly saveSource: { readonly expectedRevision: string; readonly token: string };
  readonly removeSource: { readonly expectedRevision: string; readonly namespace: WikiAdminNamespace; readonly confirmed: true };
  readonly reindex: { readonly namespace: WikiAdminNamespace };
  readonly recheck: Record<string, never>;
}
export interface WikiAdminValues {
  readonly status: WikiAdminStatus;
  readonly importProfile: WikiSelection | null;
  readonly chooseRepository: WikiSelection | null;
  readonly saveSource: WikiAdminStatus;
  readonly removeSource: WikiAdminStatus;
  readonly reindex: WikiAdminStatus;
  readonly recheck: WikiAdminStatus;
}
export type WikiAdminResult<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly kind: 'invalid' | 'conflict' | 'unavailable' | 'source-unavailable' };
export interface WikiAdminTransport {
  call<R extends keyof WikiAdminParams>(route: R, params: WikiAdminParams[R]): Promise<WikiAdminResult<WikiAdminValues[R]>>;
}
