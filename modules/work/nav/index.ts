// Work domain composition (task.work-domain.001): destinations, the module-level Work session, the outer undo
// shortcut and the domain surface that mounts the board, planning views, card detail and capture.

export { EXAMPLE_NOTE, WorkDomain, type WorkDomainProps } from './WorkDomain';
export {
  itemDestination, NAV_ITEMS, PAGE_LABELS, pageDestination, parseWorkDestination, viewLinkDestination,
  type NavItem, type WorkPage, type WorkRoute,
} from './routes';
export {
  EMPTY_CAPTURE, examplePlanner, resetWorkSessions, setWorkSessionPort, useWorkUi, workSession,
  type CaptureDraft, type ScrollPosition, type WorkSession, type WorkUi, type WorkUiState,
} from './session';
export { TOOLBAR_CAPTURE_NOTE, ToolbarCapture, type ToolbarCaptureProps } from './ToolbarCapture';
export { isTypingControl, isUndoKey, shouldUndo, workUndoHandler } from './undo';
