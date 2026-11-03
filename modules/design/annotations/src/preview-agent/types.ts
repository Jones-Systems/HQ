/** Folder-local structural wire shapes, compatible with the annotations channel. */
export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}
export type AgentMode = 'off' | 'pick' | 'cite';
export interface AgentFrame {
  readonly viewport: { readonly w: number; readonly h: number; readonly dpr: number };
  readonly scroll: { readonly x: number; readonly y: number };
}
export type ResolveRequest =
  | { readonly kind: 'element'; readonly path: string; readonly textHash?: string }
  | { readonly kind: 'text'; readonly quote: string; readonly prefix: string; readonly suffix: string };
export type ResolveResult =
  | { readonly found: true; readonly rects: readonly Rect[]; readonly textHash?: string }
  | { readonly found: false };
export interface AgentResolution {
  readonly frame: AgentFrame;
  readonly results: readonly ResolveResult[];
}
/** Identity is opaque and valid only for this agent installation. */
export interface ExactTarget {
  readonly identity: string;
  readonly text: string;
  readonly rects: readonly Rect[];
}
export type ExactResolveRequest = ResolveRequest & { readonly identity?: string };
export type ExactResolveResult = ({ readonly found: true } & ExactTarget) | { readonly found: false };
export interface ExactResolution {
  readonly generation: number;
  readonly mutationCounter: number;
  readonly frame: AgentFrame;
  readonly results: readonly ExactResolveResult[];
}
export type AgentEvent = (
  | { readonly type: 'element-picked'; readonly target: { readonly kind: 'element'; readonly path: string; readonly rect: Rect; readonly textHash?: string } }
  | { readonly type: 'text-cited'; readonly target: { readonly kind: 'text'; readonly quote: string; readonly prefix: string; readonly suffix: string; readonly rects: readonly Rect[] } }
) & { readonly frame: AgentFrame; readonly generation: number; readonly snapshot: ExactTarget };
