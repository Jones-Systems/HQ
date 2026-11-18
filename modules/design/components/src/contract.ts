/**
 * Section-local contract for T10 (HQD-09) components and motion.
 *
 * These ports satisfy the first-deliverable hold described in
 * spec.hq-design#iface.contracts.001. Root (T1) may promote a shared version;
 * until then nothing outside this section imports these types, and this
 * section imports nothing from other Design sections.
 */

export type Brand<K extends string> = string & { readonly __kind: K };

export type ProjectId = Brand<'ProjectId'>;
export type ComponentId = Brand<'ComponentId'>;
export type VariantId = Brand<'VariantId'>;
export type TokenId = Brand<'TokenId'>;
export type DesignSystemId = Brand<'DesignSystemId'>;
export type TokenGroupId = Brand<'TokenGroupId'>;
export type MotionStudyId = Brand<'MotionStudyId'>;

/** `sha256:` followed by 64 lowercase hex characters over RFC 8785 JCS bytes. */
export type Digest = Brand<'Digest'>;

// ---------------------------------------------------------------------------
// Component sources, props and variants

export type PropSpec =
  | { readonly kind: 'string'; readonly default: string; readonly maxLength?: number }
  | { readonly kind: 'number'; readonly default: number; readonly min?: number; readonly max?: number; readonly step?: number }
  | { readonly kind: 'boolean'; readonly default: boolean }
  | { readonly kind: 'enum'; readonly default: string; readonly options: readonly string[] }
  | { readonly kind: 'color'; readonly default: string };

export type PropValue = string | number | boolean;
export type PropValues = Readonly<Record<string, PropValue>>;

/**
 * Authored component source. Stored revisions are immutable: editing produces
 * a new revision with a new digest. Variants never live inside the source.
 */
export interface ComponentSourceInput {
  readonly componentId: ComponentId;
  readonly name: string;
  /** Static markup inserted into the sandbox body. */
  readonly markup: string;
  readonly styles: string;
  /**
   * Optional script body. It runs inside the sandbox as
   * `function (root, props, tokens) { ... }` and has no host capability.
   */
  readonly script: string;
  readonly props: Readonly<Record<string, PropSpec>>;
  /** Preview canvas scheme; independent of HQ chrome appearance. */
  readonly colorScheme: 'light' | 'dark';
  readonly size: { readonly width: number; readonly height: number };
}

export interface ComponentSource extends ComponentSourceInput {
  readonly revision: number;
  readonly digest: Digest;
}

export interface Variant {
  readonly id: VariantId;
  readonly name: string;
  readonly props: PropValues;
}

/** Stored separately from the source; bound to the source revision it was authored against. */
export interface VariantSet {
  readonly componentId: ComponentId;
  readonly sourceRevision: number;
  readonly variants: readonly Variant[];
}

/** What the sandbox actually renders. Always derived; never written back to the source. */
export interface RenderInput {
  readonly componentId: ComponentId;
  readonly sourceRevision: number;
  readonly sourceDigest: Digest;
  readonly variantId: VariantId | null;
  readonly props: PropValues;
  readonly tokens: Readonly<Record<string, string>>;
}

// ---------------------------------------------------------------------------
// Design tokens and systems

export type TokenType = 'color' | 'dimension' | 'duration' | 'number' | 'fontFamily' | 'fontWeight' | 'shadow';

export interface DesignToken {
  readonly id: TokenId;
  readonly type: TokenType;
  /** A literal value, or an alias of the form `{other.token.id}`. */
  readonly value: string;
  readonly description?: string;
}

export interface TokenGroup {
  readonly id: TokenGroupId;
  readonly name: string;
  readonly tokenIds: readonly TokenId[];
  readonly componentIds: readonly ComponentId[];
}

export interface DesignSystem {
  readonly id: DesignSystemId;
  readonly name: string;
  readonly tokens: readonly DesignToken[];
  readonly groups: readonly TokenGroup[];
}

// ---------------------------------------------------------------------------
// Motion

export type Easing =
  | { readonly kind: 'linear' }
  | { readonly kind: 'cubic-bezier'; readonly x1: number; readonly y1: number; readonly x2: number; readonly y2: number }
  | { readonly kind: 'steps'; readonly count: number; readonly position: 'jump-start' | 'jump-end' | 'jump-none' | 'jump-both' }
  | { readonly kind: 'spring'; readonly stiffness: number; readonly damping: number; readonly mass: number };

export type MotionProperty = 'opacity' | 'translateX' | 'translateY' | 'scale' | 'rotate';

export interface Keyframe {
  /** Position within one iteration, 0..1, strictly increasing within a track. */
  readonly offset: number;
  readonly value: number;
  /** Easing of the segment that starts at this keyframe. */
  readonly easing: Easing;
}

export interface MotionTrack {
  readonly id: string;
  /** Matches `data-motion-target="<target>"` inside the sandboxed component. */
  readonly target: string;
  readonly property: MotionProperty;
  readonly keyframes: readonly Keyframe[];
}

export interface MotionStudy {
  readonly id: MotionStudyId;
  readonly revision: number;
  readonly title: string;
  /** Milliseconds for one iteration. */
  readonly duration: number;
  readonly iterations: number;
  readonly direction: 'normal' | 'reverse' | 'alternate';
  readonly tracks: readonly MotionTrack[];
  /** Optional exact component the study animates. */
  readonly component?: { readonly componentId: ComponentId; readonly revision: number };
}

/** `trackId -> value` at one time. */
export type MotionFrame = Readonly<Record<string, number>>;

// ---------------------------------------------------------------------------
// Ports

/** Subset of the shared StoragePort; namespaced documents only. */
export interface ComponentStoragePort {
  readDocument(namespace: 'workspace', key: string): Promise<unknown>;
  writeDocument(namespace: 'workspace', key: string, value: unknown): Promise<void>;
  listKeys(namespace: 'workspace', prefix: string): Promise<readonly string[]>;
}

export interface ClockPort {
  /** Monotonic milliseconds. */
  now(): number;
}

export interface DigestPort {
  digest(value: unknown): Promise<Digest>;
}

// ---------------------------------------------------------------------------
// Canvas integration. Aligned with the T11 flows proposal on HQ issue #1 so
// root can wire one provider shape; T10 adds optional fields only.

export type CanvasItemKind = 'component-variant' | 'motion-study';

export interface CanvasItemDescriptor {
  /** `${providerId}/${kind}/${encodeURIComponent(entityId)}`; never title-derived. */
  readonly key: string;
  readonly providerId: string;
  readonly kind: CanvasItemKind;
  readonly entityId: string;
  readonly projectId: ProjectId;
  /** Display snapshot only; identity never derives from it. */
  readonly title: string;
  /** JCS SHA-256 of the exact bound source document revision; never "latest". */
  readonly sourceRevision: Digest;
  readonly intrinsicSize: { readonly width: number; readonly height: number };
  /** Rendering provenance. A web sandbox is never native evidence. */
  readonly evidence: 'web-sandbox';
  /** T10 extension: the exact revision number behind `sourceRevision`. */
  readonly revision: number;
  /** T10 extension: the selected variant of a component item. */
  readonly variantId: VariantId | null;
}

export type CanvasItemResolution =
  | { readonly status: 'ok'; readonly item: CanvasItemDescriptor }
  | { readonly status: 'missing'; readonly key: string };

/** Canvas owns arrangement records; a provider only describes items. */
export interface CanvasItemProvider {
  readonly providerId: string;
  readonly kinds: readonly CanvasItemKind[];
  listItems(projectId: ProjectId, signal?: AbortSignal): Promise<readonly CanvasItemDescriptor[]>;
  /** A missing key resolves to `missing`; that is not a permission grant or an error. */
  resolveItem(key: string, signal?: AbortSignal): Promise<CanvasItemResolution>;
}

export interface CanvasItemHandle {
  dispose(): void;
}

/** Framework-neutral rendering for a canvas that supplies a host element. */
export interface CanvasItemMounter {
  mount(key: string, host: HTMLElement): CanvasItemHandle;
}
