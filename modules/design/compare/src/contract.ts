/**
 * Section-local ports for HQD-03 compare (spec.hq-design#task.compare.001).
 * React-free. Root integration supplies real adapters; this lane ships only the
 * labelled fakes in fakes.ts. Shared promotion is proposed on HQ issue #1.
 */
import type { CaptureId, PanelId, ProjectId, VersionId, ViewId } from './ids.ts';

/** Device viewport in source CSS pixels plus device pixel ratio (SourceAnchor.viewport). */
export interface Viewport {
  readonly w: number;
  readonly h: number;
  readonly dpr: number;
}

/** Scroll offset in source CSS pixels (SourceAnchor.scroll). */
export interface ScrollPosition {
  readonly x: number;
  readonly y: number;
}

/** Full scrollable content extent in source CSS pixels. */
export interface ContentSize {
  readonly width: number;
  readonly height: number;
}

/** Where captured bytes came from. A browser capture is never native evidence. */
export type CaptureOrigin = 'browser' | 'native-device' | 'native-simulator';

/** Immutable record of already-captured bytes. Editing notes never rewrites it. */
export interface StaticCapture {
  readonly kind: 'static-capture';
  readonly captureId: CaptureId;
  readonly versionId: VersionId;
  readonly route: string;
  readonly state: string;
  readonly viewport: Viewport;
  readonly contentSize: ContentSize;
  /** `sha256:<64 hex>` of the original capture bytes. */
  readonly captureDigest: string;
  readonly mediaType: 'image/png' | 'image/jpeg' | 'image/webp' | 'image/svg+xml';
  /** ISO-8601 UTC timestamp. */
  readonly capturedAt: string;
  readonly origin: CaptureOrigin;
  /** True for synthetic fixtures; labelled as such in the UI. */
  readonly fixture: boolean;
}

export interface ViewSummary {
  readonly viewId: ViewId;
  readonly projectId: ProjectId;
  /** Display only; never used as identity. */
  readonly name: string;
}

export interface VersionSummary {
  readonly versionId: VersionId;
  readonly viewId: ViewId;
  readonly projectId: ProjectId;
  /** Display only; never used as identity. */
  readonly label: string;
  readonly createdAt: string;
  readonly sourceRevision?: string;
  readonly route: string;
  readonly state: string;
  readonly captures: readonly StaticCapture[];
}

/**
 * Read-only exact lookup of project content (owned by HQD-01 / root registry).
 * There is deliberately no "latest" accessor: callers pass an exact VersionId.
 */
export interface VersionCatalogPort {
  listViews(projectId: ProjectId, signal?: AbortSignal): Promise<readonly ViewSummary[]>;
  listVersions(viewId: ViewId, signal?: AbortSignal): Promise<readonly VersionSummary[]>;
  getVersion(versionId: VersionId, signal?: AbortSignal): Promise<VersionSummary | null>;
}

/** Resolves capture bytes for display. Adapters must verify the digest before returning. */
export interface CaptureImagePort {
  readCapture(capture: StaticCapture, signal: AbortSignal): Promise<{ readonly src: string }>;
}

/** `labelled-fake` is never presented as a real preview. */
export type PreviewQualification = 'labelled-fake' | 'qualified';

export interface PreviewRequest {
  readonly versionId: VersionId;
  readonly route: string;
  readonly state: string;
  readonly viewport: Viewport;
}

/** Synthetic rectangles drawn by the fake; fixed colors independent of HQ appearance. */
export interface SyntheticBlock {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly fill: string;
  readonly text?: string;
}

/**
 * The shell CSP forbids frames, so compare never creates an iframe. A qualified
 * preview is a root-owned host surface rendered through an injected slot.
 */
export type PreviewSurface =
  | { readonly kind: 'synthetic'; readonly blocks: readonly SyntheticBlock[] }
  | { readonly kind: 'host-surface'; readonly surfaceId: string };

export interface PreviewSession {
  readonly kind: 'live-preview';
  readonly sessionId: string;
  readonly versionId: VersionId;
  readonly qualification: PreviewQualification;
  readonly viewport: Viewport;
  readonly contentSize: ContentSize;
  readonly surface: PreviewSurface;
  close(): void;
}

/** Live preview capability (real implementation: root S2). */
export interface PreviewCapability {
  readonly qualification: PreviewQualification;
  /** Human label shown beside every live panel, e.g. "Fake preview". */
  readonly label: string;
  open(request: PreviewRequest, signal: AbortSignal): Promise<PreviewSession>;
}

/** Workspace-namespace document storage for comparison layouts (owned by the store lane). */
export interface CompareStoragePort {
  read(key: string): Promise<string | null>;
  write(key: string, value: string): Promise<void>;
}

/**
 * Coordinate frame handed to an overlay slot (HQD-04 annotations). Overlay
 * content is positioned in source CSS pixels; compare applies `scale`.
 */
export interface OverlayFrame {
  readonly panelId: PanelId;
  readonly versionId: VersionId;
  readonly sourceKind: 'static-capture' | 'live-preview';
  readonly route: string;
  readonly state: string;
  readonly viewport: Viewport;
  readonly scroll: ScrollPosition;
  readonly contentSize: ContentSize;
  readonly scale: number;
  /** Present only for static captures; a live preview has no frozen bytes. */
  readonly captureDigest: string | null;
}

/** Placement relative to the HQ window content origin, in device-independent pixels. */
export interface HostSurfacePlacement {
  readonly rect: { readonly x: number; readonly y: number; readonly width: number; readonly height: number };
  readonly visible: boolean;
}
