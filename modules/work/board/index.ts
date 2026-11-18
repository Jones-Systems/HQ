// Work board surface (task.work-board.001): the status Board, its single move
// path, Undo toasts and save/freshness state. The Work domain entry consumes these.

export { changeStatus, failureMessage, isTyping, reportWrite, runMove, undoFromToast, undoLatest, UNCONFIRMED_TOAST } from './actions';
export { createDragController, MOUSE_THRESHOLD_PX, TOUCH_HOLD_MS, TOUCH_SLOP_PX, type DragController, type DragView, type DropTarget } from './drag';
export { createFeedback, PLANNING_ONLY_META, sharedFeedback, TOAST_LIMIT, useFeedback, type Feedback, type WorkToast } from './feedback';
export {
  anchorAt, boardColumns, cardKey, describeMove, moveMenuEntries, neighbourStatus, resolveMove,
  type BoardColumns, type CardKey, type MoveIntent, type MoveMenuEntry, type MoveRequest,
} from './moves';
export { dateChip, DateChip, ItemChips, KindIcon, stepProgress, type DateChipModel } from './parts';
export { DEFAULT_COLLAPSED, PROJECT_SCOPE_NOTE, StatusBoard, type StatusBoardProps } from './StatusBoard';
export { describeWrite, Freshness, OFFLINE_BANNER, POSSIBLY_SAVED_NOTE, SaveState, SyncBanners } from './SyncStatus';
export { useUndoShortcut, WorkToasts } from './WorkToasts';
