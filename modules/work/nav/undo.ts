import type { KeyboardEvent } from 'react';
import { undoLatest, type Feedback } from '../board';
import type { WorkStore } from '../core';

// The Work-level Ctrl/⌘+Z (RW-8). Inner surfaces, such as the planning views, handle the shortcut first and mark it
// handled with preventDefault; this outer handler then leaves it alone, so one keypress consumes exactly one undo
// entry. It also stays out of typing controls, where Ctrl/⌘+Z belongs to the text.

/** True for a control that owns its own Ctrl/⌘+Z: input, textarea, select or contenteditable. */
export function isTypingControl(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  if (target instanceof HTMLElement && target.isContentEditable) return true;
  if (target.closest('[contenteditable]:not([contenteditable="false"])')) return true;
  return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement;
}

export function isUndoKey(event: Pick<KeyboardEvent, 'ctrlKey' | 'metaKey' | 'shiftKey' | 'altKey' | 'key'>): boolean {
  return (event.ctrlKey || event.metaKey) && !event.shiftKey && !event.altKey && event.key.toLowerCase() === 'z';
}

/** Whether the Work-level handler should take this keydown. */
export function shouldUndo(event: KeyboardEvent): boolean {
  if (!isUndoKey(event)) return false;
  // React shares one synthetic event across the bubble path; the native flag is the one inner handlers set.
  if (event.isDefaultPrevented() || event.nativeEvent.defaultPrevented) return false;
  return !isTypingControl(event.target);
}

/** The outer keydown handler for the Work domain root. */
export function workUndoHandler(store: WorkStore, feedback: Feedback) {
  return (event: KeyboardEvent): void => {
    if (!shouldUndo(event)) return;
    event.preventDefault();
    void undoLatest(store, feedback);
  };
}
