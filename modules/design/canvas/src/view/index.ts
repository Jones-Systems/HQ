/** React entry for the Design canvas. Root imports `./canvas.css` once alongside it. */
export { CanvasView, detectPlatform, type CanvasItemRenderer, type CanvasViewProps } from './CanvasView.tsx';
export { CanvasWorkspace, type CanvasWorkspaceProps } from './CanvasWorkspace.tsx';
export { Inspector } from './Inspector.tsx';
export { AUTOSAVE_DELAY_MS, useCanvasDocument, type CanvasDocument, type SaveStatus } from './useCanvasDocument.ts';
