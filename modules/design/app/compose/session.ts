/**
 * Session handling for the production entry: what survives a Design -> Social -> Design domain switch.
 *
 * T14 owns the chrome session (panels, last section, opaque per-section state) under
 * `hq.design.ui-session.v1:<projectId>`. Canvas (T3) keeps its camera, selection and focus as a
 * `CanvasSession`; composition stores that inside T14's per-section state under the `canvas` section id,
 * after a strict check, so a hand-edited or newer value is ignored instead of corrupting the view.
 * Nothing here writes a workspace record, and deactivating never submits, sends or starts work.
 */
import type { JsonValue, UiStatePort } from '../../ui/contract.ts';
import type { CanvasSession } from '../../canvas/src/controller.ts';

export const CANVAS_SESSION_SECTION = 'canvas';
const MAX_SELECTION = 1000;
const MAX_ID = 160;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const onlyKeys = (value: Record<string, unknown>, keys: readonly string[]): boolean =>
  Object.keys(value).length === keys.length && keys.every((key) => key in value);
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const nodeId = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= MAX_ID && !/[\u0000-\u001f\u007f]/u.test(value);

/** Strict reader for stored canvas session state: exact keys, finite camera, positive zoom, bounded ids. */
export function parseCanvasSession(value: JsonValue | undefined): CanvasSession | undefined {
  if (!isRecord(value) || !onlyKeys(value, ['camera', 'selection', 'focusId'])) return undefined;
  const { camera, selection, focusId } = value;
  if (!isRecord(camera) || !onlyKeys(camera, ['x', 'y', 'zoom'])) return undefined;
  if (!finite(camera.x) || !finite(camera.y) || !finite(camera.zoom) || camera.zoom <= 0) return undefined;
  if (!Array.isArray(selection) || selection.length > MAX_SELECTION || !selection.every(nodeId)) return undefined;
  if (focusId !== null && !nodeId(focusId)) return undefined;
  return { camera: { x: camera.x, y: camera.y, zoom: camera.zoom }, selection: [...selection] as string[], focusId };
}

export function canvasSessionToJson(session: CanvasSession): JsonValue {
  return { camera: { x: session.camera.x, y: session.camera.y, zoom: session.camera.zoom }, selection: [...session.selection], focusId: session.focusId };
}

interface StorageHost {
  readonly localStorage?: UiStatePort;
}

/**
 * `window.localStorage` behind a guard. Reading the property can throw (disabled storage, sandboxed
 * origin), so any failure yields null and T14 keeps chrome state in memory, reporting it in the inspector.
 */
export function guardedLocalStorage(host: StorageHost | undefined = typeof window === 'undefined' ? undefined : (window as StorageHost)): UiStatePort | null {
  try {
    const storage = host?.localStorage;
    return storage && typeof storage.getItem === 'function' && typeof storage.setItem === 'function' ? storage : null;
  } catch {
    return null;
  }
}

/**
 * Shell-facing deactivate. T14's flush is already idempotent (it writes only dirty entries and touches only
 * session keys); this wrapper makes sure a storage failure can never escape into the shell's effect cleanup.
 */
export function createDeactivate(core: { readonly deactivate: () => void }): () => void {
  return () => {
    try { core.deactivate(); } catch { /* chrome state stays in memory; never block leaving Design */ }
  };
}
