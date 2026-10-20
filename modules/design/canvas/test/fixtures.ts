import {
  artboardId, canvasId, canvasItemId, projectId, providerId, type CanvasArrangement, type CanvasItemRef, type Rect,
} from '../src/contract.ts';
import { addArtboard, addPlacement, emptyArrangement } from '../src/arrangement.ts';
import { createFakeProvider } from '../src/fakes.ts';

export const PROJECT = projectId('synthetic-project-a');
export const CANVAS = canvasId('synthetic-canvas-1');
export const VIEWS = providerId('synthetic-views');

export const ref = (entityId: string, revision: string): CanvasItemRef => ({ providerId: VIEWS, entityId, revision });
export const rect = (x: number, y: number, width: number, height: number): Rect => ({ x, y, width, height });

export const A = canvasItemId('item-a');
export const B = canvasItemId('item-b');
export const C = canvasItemId('item-c');
export const BOARD = artboardId('board-1');

/** Two versions of one view plus another view; one artboard containing A. */
export function sampleArrangement(): CanvasArrangement {
  let arrangement = emptyArrangement(CANVAS, PROJECT);
  arrangement = addArtboard(arrangement, { id: BOARD, name: 'Desktop', frame: rect(0, 0, 1000, 800) });
  arrangement = addPlacement(arrangement, { id: A, ref: ref('view-home', 'version-1'), frame: rect(40, 40, 320, 200) });
  arrangement = addPlacement(arrangement, { id: B, ref: ref('view-home', 'version-2'), frame: rect(1200, 40, 320, 200) });
  arrangement = addPlacement(arrangement, { id: C, ref: ref('view-pricing', 'version-7'), frame: rect(1200, 400, 160, 120) });
  return arrangement;
}

export function sampleProvider() {
  const bytes = (text: string) => new TextEncoder().encode(text);
  return createFakeProvider(VIEWS, 'Synthetic views', [
    { entityId: 'view-home', revision: 'version-1', title: 'Home v1', kind: 'view-version', provenance: 'static-capture', bytes: bytes('<html>home v1</html>') },
    { entityId: 'view-home', revision: 'version-2', title: 'Home v2', kind: 'view-version', provenance: 'live-preview', bytes: bytes('<html>home v2</html>') },
    { entityId: 'view-pricing', revision: 'version-7', title: 'Pricing v7', kind: 'view-version', provenance: 'web-approximation', bytes: bytes('<html>pricing</html>') },
  ]);
}

export const close = (actual: number, expected: number, epsilon = 1e-9): boolean => Math.abs(actual - expected) <= epsilon * Math.max(1, Math.abs(expected));
