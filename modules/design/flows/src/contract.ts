/**
 * Section-local contract for HQD-10 flows. These shapes satisfy the first-deliverable
 * prerequisite until T1 promotes shared types; nothing here is imported from another section.
 */

export type Brand<K extends string> = string & { readonly __kind: K };
export type ProjectId = Brand<'ProjectId'>;
export type VersionId = Brand<'VersionId'>;
export type FlowId = Brand<'FlowId'>;
export type ScreenId = Brand<'ScreenId'>;
export type HotspotId = Brand<'HotspotId'>;

const MAX_ID = 160;

/** Bounded, trimmed, control-free text; identifiers never derive from display titles. */
export function isBoundedText(value: unknown, max = MAX_ID): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= max
    && value.trim() === value && !/[\u0000-\u001f\u007f]/u.test(value);
}

function brand<K extends string>(kind: K) {
  return (value: string): Brand<K> => {
    if (!isBoundedText(value)) throw new TypeError(`Invalid ${kind}`);
    return value as Brand<K>;
  };
}

export const projectId = brand('ProjectId');
export const versionId = brand('VersionId');
export const flowId = brand('FlowId');
export const screenId = brand('ScreenId');
export const hotspotId = brand('HotspotId');

/** Explicit source CSS pixels of the screen's declared viewport. */
export interface Rect { readonly x: number; readonly y: number; readonly width: number; readonly height: number }
export interface Point { readonly x: number; readonly y: number }
export interface Viewport { readonly w: number; readonly h: number; readonly dpr: number }

/** Platform the prototype represents. The player is a web approximation for every value. */
export const FLOW_PLATFORMS = ['web', 'ios', 'android', 'desktop'] as const;
export type FlowPlatform = (typeof FLOW_PLATFORMS)[number];

export const ANIMATIONS = ['instant', 'push', 'pop', 'fade', 'modal', 'dismiss'] as const;
export type Animation = (typeof ANIMATIONS)[number];

export interface RouteDeclaration {
  readonly route: string;
  /** Declared states; the first is the default when a target omits its state. */
  readonly states: readonly string[];
}

export interface Screen {
  readonly id: ScreenId;
  readonly title: string;
  /** Exact source version; never an implicit "latest". */
  readonly versionId: VersionId;
  readonly route: string;
  readonly state: string;
  readonly viewport: Viewport;
  readonly captureDigest?: string;
}

export type TransitionTarget =
  | { readonly kind: 'screen'; readonly screenId: ScreenId }
  | { readonly kind: 'route'; readonly route: string; readonly state?: string }
  | { readonly kind: 'back' }
  | { readonly kind: 'external'; readonly url: string };

export interface Transition {
  readonly target: TransitionTarget;
  readonly animation: Animation;
  readonly durationMs: number;
}

export interface Hotspot {
  readonly id: HotspotId;
  readonly screenId: ScreenId;
  readonly label: string;
  readonly rect: Rect;
  readonly transition: Transition;
}

export const FLOW_SCHEMA = 'hq.design.flow/v1';

export interface FlowDocument {
  readonly schema: typeof FLOW_SCHEMA;
  readonly id: FlowId;
  readonly projectId: ProjectId;
  readonly title: string;
  readonly platform: FlowPlatform;
  readonly start: ScreenId;
  readonly routes: readonly RouteDeclaration[];
  readonly screens: readonly Screen[];
  readonly hotspots: readonly Hotspot[];
}

/**
 * Every player step carries this label. `nativeEvidence` is the literal `false`, so no
 * code path can mark a prototype step as native acceptance evidence.
 */
export interface WebApproximation {
  readonly kind: 'web-approximation';
  readonly nativeEvidence: false;
  readonly declaredPlatform: FlowPlatform;
  readonly label: string;
}

/** Narrow persistence port; root adapts the durable StoragePort `workspace` namespace. */
export interface FlowStoragePort {
  readonly label: string;
  getDocument(namespace: 'workspace', key: string): Promise<unknown>;
  putDocument(namespace: 'workspace', key: string, value: unknown): Promise<void>;
  listKeys(namespace: 'workspace', prefix: string): Promise<readonly string[]>;
}

/** Root supplies captures; their bytes keep their own colors regardless of HQ appearance. */
export interface ScreenPreviewPort {
  readonly label: string;
  previewUrl(screen: Screen): string | null;
}

/**
 * Proposed `CanvasItemProvider` (HQD-02 consumer). Providers describe items and their
 * intrinsic size only; the canvas owns arrangement records and never edits source.
 */
export interface CanvasItemDescriptor {
  /** Stable `${providerId}/${kind}/${entityId}` key; never derived from a title. */
  readonly key: string;
  readonly providerId: string;
  readonly kind: string;
  readonly entityId: string;
  readonly projectId: ProjectId;
  readonly title: string;
  /** Content digest of the exact source document revision. */
  readonly sourceRevision: string;
  readonly intrinsicSize: { readonly width: number; readonly height: number };
  readonly evidence: 'web-approximation';
}

export type CanvasItemResolution =
  | { readonly status: 'ok'; readonly item: CanvasItemDescriptor }
  | { readonly status: 'missing'; readonly key: string };

export interface CanvasItemProvider {
  readonly providerId: string;
  readonly kinds: readonly string[];
  listItems(projectId: ProjectId): Promise<readonly CanvasItemDescriptor[]>;
  resolveItem(key: string): Promise<CanvasItemResolution>;
}
