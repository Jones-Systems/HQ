/**
 * Section-local contract for HQ Design annotations (T5 / HQD-04).
 *
 * Shapes follow spec.hq-design#iface.contracts.001. They live here until T1
 * promotes shared types; nothing in this file imports another section.
 */

export type Brand<K extends string> = string & { readonly __kind: K };
export type VersionId = Brand<'VersionId'>;
export type AnnotationId = Brand<'AnnotationId'>;

const ID_MAX = 200;

/** Validates a nonempty, bounded, trimmed identifier without control characters. */
export function isIdText(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= ID_MAX
    && value.trim() === value && !/[\u0000-\u001f\u007f]/u.test(value);
}

export function versionId(value: string): VersionId {
  if (!isIdText(value)) throw new TypeError('Invalid VersionId');
  return value as VersionId;
}

export function annotationId(value: string): AnnotationId {
  if (!isIdText(value)) throw new TypeError('Invalid AnnotationId');
  return value as AnnotationId;
}

/** A point in source CSS pixels of the document frame (scroll already applied). */
export interface Point {
  readonly x: number;
  readonly y: number;
}

/** A rectangle in source CSS pixels of the document frame. */
export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** Layout viewport in CSS pixels plus the device pixel ratio of the capture. */
export interface Viewport {
  readonly w: number;
  readonly h: number;
  readonly dpr: number;
}

export interface ElementTarget {
  readonly kind: 'element';
  /** CSS selector path from the document root; never a filesystem path. */
  readonly path: string;
  readonly rect: Rect;
  readonly textHash?: string;
}

export interface TextTarget {
  readonly kind: 'text';
  readonly quote: string;
  readonly prefix: string;
  readonly suffix: string;
  readonly rects: readonly Rect[];
}

export interface RegionTarget {
  readonly kind: 'region';
  readonly rect: Rect;
}

export interface InkTarget {
  readonly kind: 'ink';
  readonly points: readonly Point[];
}

export type AnchorTarget = ElementTarget | TextTarget | RegionTarget | InkTarget;

/**
 * Binds an annotation to an exact source version and an explicit coordinate
 * frame. Coordinates are document CSS pixels; `viewport` and `scroll` record
 * the frame at capture time. There is no implicit rebinding to a later version.
 */
export interface SourceAnchor {
  readonly versionId: VersionId;
  readonly route: string;
  readonly state: string;
  readonly viewport: Viewport;
  readonly scroll: Point;
  readonly captureDigest: string;
  readonly target: AnchorTarget;
}

export const ANNOTATION_KINDS = ['pick', 'cite', 'ink', 'box', 'arrow', 'label'] as const;
export type AnnotationKind = (typeof ANNOTATION_KINDS)[number];

export interface AnnotationRef {
  readonly id: AnnotationId;
  readonly letter: string;
  readonly anchor: SourceAnchor;
  readonly note: string;
  readonly kind: AnnotationKind;
}

/** The target kind each annotation kind must carry. Pick and Cite never cross. */
export const TARGET_KIND_FOR: Readonly<Record<AnnotationKind, AnchorTarget['kind']>> = {
  pick: 'element',
  cite: 'text',
  ink: 'ink',
  arrow: 'ink',
  box: 'region',
  label: 'region',
};

export const ANNOTATION_DOCUMENT_SCHEMA = 'hq.design.annotations/v1';

/**
 * Editable annotation set for one source version. `nextLetterIndex` only grows:
 * deleted or undone letters are never reused. `revisit` lists annotations the
 * user marked to revisit.
 */
export interface AnnotationDocument {
  readonly schema: typeof ANNOTATION_DOCUMENT_SCHEMA;
  readonly versionId: VersionId;
  readonly nextLetterIndex: number;
  readonly annotations: readonly AnnotationRef[];
  readonly revisit: readonly AnnotationId[];
}

/** The frame the host is currently showing; supplied by root, never inferred. */
export interface SourceFrame {
  readonly versionId: VersionId;
  readonly route: string;
  readonly state: string;
  readonly viewport: Viewport;
  readonly scroll: Point;
  readonly captureDigest: string;
}

// Ports. Root wires real adapters; fakes in fakes.ts are labelled as fakes.

export interface PortLabel {
  /** `fake` adapters never count as runtime evidence. */
  readonly adapter: 'fake' | 'real';
}

export interface ClipboardPort extends PortLabel {
  writeText(text: string): Promise<void>;
}

export interface IdPort extends PortLabel {
  next(): AnnotationId;
}

export interface AnnotationStorePort extends PortLabel {
  load(version: VersionId): Promise<unknown>;
  save(document: AnnotationDocument): Promise<void>;
}

/** Agent modes. Pick and Cite are separate modes and never emit each other's events. */
export type AgentMode = 'off' | 'pick' | 'cite';

/** Live frame observed inside the preview; route and version come from the host. */
export interface AgentFrame {
  readonly viewport: Viewport;
  readonly scroll: Point;
}

export type AgentEvent =
  | { readonly type: 'element-picked'; readonly target: ElementTarget; readonly frame: AgentFrame }
  | { readonly type: 'text-cited'; readonly target: TextTarget; readonly frame: AgentFrame };

export type ResolveRequest =
  /** `textHash` lets the agent relocate an element whose structural path moved. */
  | { readonly kind: 'element'; readonly path: string; readonly textHash?: string }
  | { readonly kind: 'text'; readonly quote: string; readonly prefix: string; readonly suffix: string };

export type ResolveResult =
  | { readonly found: true; readonly rects: readonly Rect[]; readonly textHash?: string }
  | { readonly found: false };

export interface AgentResolution {
  readonly frame: AgentFrame;
  readonly results: readonly ResolveResult[];
}

/** Root-provided channel to the preview agent bundled into the preview preload. */
export interface AgentChannelPort extends PortLabel {
  setMode(mode: AgentMode): void;
  resolve(requests: readonly ResolveRequest[]): Promise<AgentResolution>;
  subscribe(listener: (event: AgentEvent) => void): () => void;
}
