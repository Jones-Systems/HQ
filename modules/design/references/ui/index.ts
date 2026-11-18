/** React entry for the reference library. Root mounts the panel with opened ports. */
export type { ReferenceLibraryPanelProps } from './ReferenceLibraryPanel.tsx';
export { ReferenceLibraryPanel } from './ReferenceLibraryPanel.tsx';
export type { ReferenceLibraryActions, ReferenceLibraryViewProps } from './ReferenceLibraryView.tsx';
export { ReferenceLibraryView } from './ReferenceLibraryView.tsx';
export type { RevealedReference } from './ReferenceGrid.tsx';
export type {
  LibraryViewModel, LibraryViewOptions, LightboxPosition, ProjectRef, ReferenceCard, ReferenceDetail, ReferenceTasteSubject, ViewSelection,
} from './view-model.ts';
export { buildLibraryView, gridFocusTarget, lightboxPosition } from './view-model.ts';
export type { ReferenceGraphPanelProps } from './ReferenceGraphPanel.tsx';
export { ReferenceGraphPanel } from './ReferenceGraphPanel.tsx';
export type { ReferenceGraphActions, ReferenceGraphViewProps } from './ReferenceGraphView.tsx';
export { ReferenceGraphView } from './ReferenceGraphView.tsx';
export type { AnchorRow, CaptureRow, GraphSelection, GraphViewModel, SubjectRow } from './graph-view-model.ts';
export { AVAILABILITY_TEXT, buildGraphView } from './graph-view-model.ts';
