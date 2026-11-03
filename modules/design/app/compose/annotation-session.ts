/**
 * The annotation session of the durable workspace (B3 backend contract; see BACKEND-CONTRACT.md).
 *
 * A session pins annotations to one saved project version and shows that version's stored capture image.
 * Which version is shown is a selection, never an inference about lineage:
 *   - explicit: the caller names a version id; an unknown id or a version without a capture is refused.
 *   - default: the newest version that has a stored capture image, else the newest that names a capture.
 *     This only chooses what the screen opens on. It says nothing about which version is current,
 *     which is based on which, or what a mark belongs to; marks always carry the exact version id.
 * Only a version that names its capture by digest can be annotated: an annotation anchor requires one.
 */
import type { ProjectContent, VersionRecord } from '../../projects/src/content.ts';
import { versionId as annotationVersionId, type SourceFrame, type VersionId as AnnotationVersionId } from '../../annotations/src/contract.ts';
import type { AnnotationController } from '../../annotations/src/controller.ts';
import { designFailure, DesignOperationError, type DesignFailureContext } from './errors.ts';
import { readCapture, type CaptureReader } from './flow-captures.ts';

export const ANNOTATIONS_OPEN: DesignFailureContext = { section: 'annotations', operation: 'annotations.open', action: 'open annotations' };

/** Read at most this many of the newest captures when choosing the default; a long run of unstored ones stops here. */
const MAX_DEFAULT_PROBES = 20;
const MAX_CHOICES = 200;

export interface AnnotationTarget {
  readonly version: AnnotationVersionId;
  readonly frame: SourceFrame;
  /** Verified thumbnail of the version, or null when it has none or none was read. A thumbnail, not the capture. */
  readonly thumbnailUrl: string | null;
  /** The stored capture image as a verified `data:` URL, or null when its bytes are not stored on this device. */
  readonly captureUrl: string | null;
}

export interface AnnotationChoice {
  readonly id: AnnotationVersionId;
  readonly label: string;
  /** Title of the view that owns the version, or an empty string. */
  readonly view: string;
  readonly createdAt: string;
}

export interface AnnotationSession {
  readonly target: AnnotationTarget;
  readonly controller: AnnotationController;
  /** Versions that can be annotated (they name a capture), newest first. */
  readonly choices: readonly AnnotationChoice[];
  /** `default` when the screen opened on the newest stored capture, `explicit` when the caller named the version. */
  readonly selection: 'default' | 'explicit';
}

export interface OpenAnnotationSession {
  readonly content: ProjectContent;
  /** Reads a stored capture by exact digest, or null when the workspace has no blob storage. */
  readonly read: CaptureReader | null;
  controllerFor(version: AnnotationVersionId): Promise<AnnotationController>;
  /** An explicit version id; omit it for the default selection. */
  readonly version?: string;
}

const digestOf = (version: VersionRecord): string | null => {
  const digest = version.capture.captureDigest;
  return typeof digest === 'string' && digest.length > 0 ? digest : null;
};

/** Live frames keep the path and search in `route` and the hash in `state`; a saved version stores them joined. */
function frameFor(version: VersionRecord, digest: string): SourceFrame {
  const id = annotationVersionId(version.id);
  const hash = version.capture.route.indexOf('#');
  return {
    versionId: id, route: hash < 0 ? version.capture.route : version.capture.route.slice(0, hash),
    state: hash < 0 ? '' : version.capture.route.slice(hash), viewport: version.capture.viewport, scroll: { x: 0, y: 0 }, captureDigest: digest,
  };
}

async function captureUrl(read: CaptureReader | null, digest: string): Promise<string | null> {
  if (read === null) return null;
  const state = await readCapture(read, digest);
  return state.status === 'ready' ? state.url : null;
}

/** Opens the session, or returns null when the project has no version that names a capture. */
export async function openAnnotationSession(input: OpenAnnotationSession): Promise<AnnotationSession | null> {
  const { content, read } = input;
  const annotatable = content.versions.filter((version) => digestOf(version) !== null).reverse();
  let chosen: VersionRecord | undefined;
  let url: string | null = null;
  if (input.version !== undefined) {
    chosen = content.versions.find((version) => version.id === input.version);
    if (chosen === undefined) throw new DesignOperationError(designFailure('not-found', ANNOTATIONS_OPEN, { reason: 'version' }));
    const digest = digestOf(chosen);
    if (digest === null) {
      throw new DesignOperationError(designFailure('invalid', ANNOTATIONS_OPEN, { reason: 'no-capture',
        description: 'This version has no saved capture to mark up. Choose another version.' }));
    }
    url = await captureUrl(read, digest);
  } else {
    for (const version of annotatable.slice(0, MAX_DEFAULT_PROBES)) {
      const found = await captureUrl(read, digestOf(version)!);
      if (found !== null) { chosen = version; url = found; break; }
    }
    chosen ??= annotatable[0];
  }
  if (chosen === undefined) return null;
  const frame = frameFor(chosen, digestOf(chosen)!);
  const controller = await input.controllerFor(frame.versionId);
  controller.setFrame(frame);
  const titles = new Map(content.views.map((view) => [view.id, view.title] as const));
  return {
    target: { version: frame.versionId, frame, thumbnailUrl: null, captureUrl: url },
    controller,
    choices: annotatable.slice(0, MAX_CHOICES).map((version) => ({
      id: annotationVersionId(version.id), label: version.label, view: titles.get(version.viewId) ?? '', createdAt: version.createdAt,
    })),
    selection: input.version === undefined ? 'default' : 'explicit',
  };
}
