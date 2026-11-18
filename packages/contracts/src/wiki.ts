/** Closed Wiki IPC boundary. Payloads are validated by the Wiki module at the renderer boundary. */
export type WikiNamespace = 'bl' | 'appdev';
export interface WikiPageKey { readonly namespace: WikiNamespace; readonly path: string }
export type WikiResult<T = unknown> = { readonly ok: true; readonly value: T } | {
  readonly ok: false; readonly error: { readonly code: 'invalid-input' | 'not-found' | 'unavailable' | 'internal'; readonly reason: string; readonly message: string; readonly path?: string };
};
export interface WikiServiceTransport {
  listSources(): Promise<WikiResult>;
  search(request: { readonly query: string; readonly namespaces?: readonly WikiNamespace[]; readonly limit?: number }): Promise<WikiResult>;
  getPage(request: { readonly key: WikiPageKey }): Promise<WikiResult>;
  resolveAlias(request: { readonly namespace: WikiNamespace; readonly alias: string }): Promise<WikiResult>;
  getBacklinks(request: { readonly key: WikiPageKey; readonly limit?: number }): Promise<WikiResult>;
  listTopics(request: { readonly namespace: WikiNamespace }): Promise<WikiResult>;
  indexStatus(): Promise<WikiResult>;
}
