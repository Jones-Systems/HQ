export interface PreviewViewport { readonly w: number; readonly h: number; readonly dpr: 1 | 2 | 3 }
export interface PreviewRect { readonly x: number; readonly y: number; readonly width: number; readonly height: number }
export interface AgentFrame { readonly viewport: { readonly w: number; readonly h: number; readonly dpr: number }; readonly scroll: { readonly x: number; readonly y: number } }
export type ResolveRequest = { readonly kind: 'element'; readonly path: string; readonly textHash?: string } | { readonly kind: 'text'; readonly quote: string; readonly prefix: string; readonly suffix: string };
export interface AgentResolution { readonly frame: AgentFrame; readonly results: readonly ({ readonly found: false } | { readonly found: true; readonly rects: readonly PreviewRect[]; readonly textHash?: string })[] }
export type AgentEvent = ({ readonly type: 'element-picked'; readonly target: { readonly kind: 'element'; readonly path: string; readonly rect: PreviewRect; readonly textHash?: string } } | { readonly type: 'text-cited'; readonly target: { readonly kind: 'text'; readonly quote: string; readonly prefix: string; readonly suffix: string; readonly rects: readonly PreviewRect[] } }) & { readonly frame: AgentFrame; readonly generation: number; readonly snapshot: { readonly identity: string; readonly text: string; readonly rects: readonly PreviewRect[] } };
export interface PreviewSession {
  readonly sessionId: string; readonly versionId: string; readonly generation: number;
  readonly route: string; readonly state: string; readonly viewport: PreviewViewport;
  readonly contentSize: { readonly w: number; readonly h: number };
  readonly status: 'open' | 'crashed'; readonly pickQualified: boolean;
}
export interface CaptureRecord {
  readonly captureId: string; readonly sessionId: string; readonly versionId: string; readonly generation: number;
  readonly route: string; readonly state: string; readonly viewport: PreviewViewport;
  readonly scroll: { readonly x: number; readonly y: number }; readonly contentSize: { readonly w: number; readonly h: number };
  readonly captureDigest: `sha256:${string}`; readonly capturedAt: string;
}
export interface PreviewParams {
  readonly open: { readonly versionId: string; readonly url: string; readonly viewport: PreviewViewport; readonly label: string };
  readonly place: { readonly sessionId: string; readonly rect: PreviewRect; readonly visible: boolean };
  readonly navigate: { readonly sessionId: string; readonly route: string };
  readonly mode: { readonly sessionId: string; readonly generation: number; readonly mode: 'off' | 'pick' | 'cite' };
  readonly capture: { readonly sessionId: string; readonly expectedGeneration: number };
  readonly events: { readonly sessionId: string; readonly after: number };
  readonly resolve: { readonly sessionId: string; readonly generation: number; readonly requests: readonly ResolveRequest[] };
  readonly image: { readonly captureId: string };
  readonly status: { readonly sessionId: string };
  readonly close: { readonly sessionId: string };
}
export interface PreviewValues {
  readonly open: PreviewSession; readonly place: PreviewSession; readonly navigate: PreviewSession;
  readonly mode: null; readonly capture: CaptureRecord;
  readonly events: { readonly after: number; readonly events: readonly { readonly sequence: number; readonly generation: number; readonly event: AgentEvent; readonly capture: CaptureRecord }[] };
  readonly resolve: AgentResolution; readonly image: string; readonly status: PreviewSession; readonly close: null;
}
export type PreviewResult<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly kind: 'invalid' | 'unavailable' | 'stale' | 'blocked'; readonly reason?: string };
export interface PreviewTransport { call<R extends keyof PreviewParams>(route: R, params: PreviewParams[R]): Promise<PreviewResult<PreviewValues[R]>> }
