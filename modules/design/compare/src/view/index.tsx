/** React entry. Importing this module brings the section's stylesheet with it. */
import './compare.css';

export { CompareWorkspace, type CompareToolsContext, type CompareWorkspaceProps } from './CompareWorkspace.tsx';
export { ComparePanel, type ComparePanelProps, type PanelSlots } from './ComparePanel.tsx';
export { SwipeDivider, SwipeStage, type SwipeDividerProps, type SwipeStageProps } from './SwipeStage.tsx';
export type { CompareMode } from './swipe.ts';
export { ActionButton, Reason, type ActionButtonProps } from './parts.tsx';
