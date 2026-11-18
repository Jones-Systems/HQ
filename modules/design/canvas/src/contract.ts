/**
 * Section-local contract for the Design canvas (HQD-02, spec.hq-design#task.canvas.001).
 *
 * React-free and framework-free. Root replaces these local ports with promoted
 * shared contracts through adapters; nothing here imports another section.
 */

/** Branded identifier: `string & { readonly __kind: K }`. */
export type Brand<K extends string> = string & { readonly __kind: K };
export type ProjectId = Brand<'ProjectId'>;
export type CanvasId = Brand<'CanvasId'>;
export type CanvasItemId = Brand<'CanvasItemId'>;
export type ArtboardId = Brand<'ArtboardId'>;
export type ProviderId = Brand<'ProviderId'>;
/** Any arrangement node: a placed item or an artboard. */
export type NodeId = CanvasItemId | ArtboardId;

const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:~-]{0,159}$/u;

/** Bounded opaque identifier. Stable identifiers never derive from display titles. */
export function isIdentifier(value: unknown): value is string {
  return typeof value === 'string' && IDENTIFIER.test(value);
}

function brand<K extends string>(kind: K) {
  return (value: string): Brand<K> => {
    if (!isIdentifier(value)) throw new TypeError(`Invalid ${kind}: ${JSON.stringify(value)}`);
    return value as Brand<K>;
  };
}

export const projectId = brand('ProjectId');
export const canvasId = brand('CanvasId');
export const canvasItemId = brand('CanvasItemId');
export const artboardId = brand('ArtboardId');
export const providerId = brand('ProviderId');

export interface Point { readonly x: number; readonly y: number }
export interface Size { readonly width: number; readonly height: number }
/** World-space rectangle in canvas units (1 unit = 1 CSS pixel at zoom 1). */
export interface Rect { readonly x: number; readonly y: number; readonly width: number; readonly height: number }

/**
 * Camera: the world point shown at the viewport's top-left corner, and the
 * scale from world units to screen CSS pixels.
 */
export interface Camera { readonly x: number; readonly y: number; readonly zoom: number }

/**
 * What a placement shows. `revision` is the provider's exact immutable
 * revision (a VersionId for project views). There is no "latest" binding:
 * the canvas never rebinds a placement to another revision on its own.
 */
export interface CanvasItemRef {
  readonly providerId: ProviderId;
  readonly entityId: string;
  readonly revision: string;
}

export interface Placement {
  readonly id: CanvasItemId;
  readonly ref: CanvasItemRef;
  readonly frame: Rect;
  readonly artboardId: ArtboardId | null;
  readonly locked: boolean;
  readonly hidden: boolean;
}

export interface Artboard {
  readonly id: ArtboardId;
  readonly name: string;
  readonly frame: Rect;
  readonly locked: boolean;
}

export interface GridSettings { readonly size: number; readonly snap: boolean }

export const ARRANGEMENT_SCHEMA = 'hq.design.canvas-arrangement/v1';

/**
 * The persisted arrangement record. It is the only thing canvas edits write.
 * Array order is z-order, back to front; artboards always sit behind items.
 */
export interface CanvasArrangement {
  readonly schema: typeof ARRANGEMENT_SCHEMA;
  readonly canvasId: CanvasId;
  readonly projectId: ProjectId;
  readonly grid: GridSettings;
  readonly artboards: readonly Artboard[];
  readonly items: readonly Placement[];
}

/**
 * How a provider's item was produced. A browser approximation or static capture
 * is never native evidence; the canvas shows the provider's claim verbatim.
 */
export const PROVENANCE_KINDS = [
  'static-capture', 'live-preview', 'web-approximation', 'component-sandbox',
  'native-evidence', 'reference', 'unspecified',
] as const;
export type ProvenanceKind = (typeof PROVENANCE_KINDS)[number];

export interface CanvasItemDescriptor {
  readonly ref: CanvasItemRef;
  readonly title: string;
  /** Provider-defined kind label, for example `view-version`, `component`, `flow-screen`. */
  readonly kind: string;
  readonly intrinsicSize: Size;
  readonly provenance: ProvenanceKind;
  /** Optional read-only facts shown in the inspector, e.g. route or viewport. */
  readonly details?: readonly { readonly label: string; readonly value: string }[];
}

/**
 * Supplies items for the canvas. Providers are read-only from the canvas's
 * point of view: the canvas only describes and lists, and never asks a
 * provider to create, edit, rebind or delete anything.
 */
export interface CanvasItemProvider {
  readonly id: ProviderId;
  readonly label: string;
  /** Describe the exact pinned revision, or `null` when it is unknown to the provider. */
  describe(ref: CanvasItemRef): CanvasItemDescriptor | null;
  /** Items that can be placed for a project (optional catalog for an add picker). */
  list?(project: ProjectId): readonly CanvasItemDescriptor[];
  /** Notify when descriptions may have changed. Returns an unsubscribe function. */
  subscribe?(listener: () => void): () => void;
}

/** Storage namespace used by canvas: authoritative, editable, backed-up workspace records. */
export type CanvasNamespace = 'workspace';

/**
 * Minimal section-local view of the shared StoragePort (documents only).
 * Root adapts the durable store; atomicity per document is the adapter's duty.
 */
export interface CanvasStoragePort {
  readDocument(namespace: CanvasNamespace, key: string): Promise<string | null>;
  writeDocument(namespace: CanvasNamespace, key: string, text: string): Promise<void>;
}

/** Source of new placement and artboard identifiers. */
export interface IdPort { next(kind: 'item' | 'artboard'): string }
