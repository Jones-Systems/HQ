// Card detail panel (task.work-board.001, RV-3).

export { CardDetail, type CardDetailProps } from './CardDetail';
export { Checklist, type ChecklistProps } from './Checklist';
export { DateEditor, relativeText, type DateEditorProps } from './DateEditor';
export { createDetailState, sharedDetailState, useDetailState, type DetailState, type FieldConflict, type TextBuffer, type TextField } from './detail-state';
export { createEditor, fieldWords, NOTES_DEBOUNCE_MS, sameValue, writableValue, type Editor, type SaveOptions } from './edits';
export { References, type ReferencesProps } from './References';
