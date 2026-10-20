import { STATUS_LABEL, type Item, type PlannerError, type Status, type UndoOutcome, type WorkStore, type WriteOutcome } from '../core';
import { PLANNING_ONLY_META, type Feedback, type WorkToast } from './feedback';
import type { MoveRequest } from './moves';

// The one write path for card movement. Drag, keyboard, the move menu, the
// detail status pills and the List status select all end in store.move, so each
// status change records an exact restore anchor and offers Undo (RV-1, RW-7).
// Nothing here can start work: the store's port has no execution member.

export const UNCONFIRMED_TOAST = 'Not confirmed yet. It stays marked Unconfirmed until the same request is answered.';

/** Words for a failed write. Order conflicts and unavailability are already posted by the store as notices. */
export function failureMessage(error: PlannerError): string | null {
  switch (error.kind) {
    case 'revision_conflict': return 'Changed elsewhere, so nothing was changed. The latest version is shown.';
    case 'invalid': return error.errors.map((e) => e.message).join(' ');
    case 'not_found': return 'That item is no longer in the Planner.';
    case 'order_conflict': case 'unavailable': case 'request_id_reused': case 'unknown': return null;
  }
}

/** Posts the visible result of a write. A saved write with an undo entry offers Undo; a no-op posts nothing. */
export function reportWrite(feedback: Feedback, outcome: WriteOutcome, saved: string): void {
  if (outcome.status === 'saved') {
    if (outcome.undoId) feedback.push({ message: saved, meta: PLANNING_ONLY_META, tone: 'info', undoId: outcome.undoId });
  } else if (outcome.status === 'unconfirmed') {
    feedback.push({ message: UNCONFIRMED_TOAST, tone: 'warning' });
  } else {
    const message = failureMessage(outcome.error);
    if (message) feedback.push({ message, tone: 'warning' });
  }
}

/** Sends one resolved board move. */
export async function runMove(store: WorkStore, feedback: Feedback, request: MoveRequest, item: Pick<Item, 'title' | 'status'>): Promise<WriteOutcome> {
  const outcome = await store.move(request.id, request.status, request.anchor);
  reportWrite(feedback, outcome, request.status === item.status
    ? `Reordered “${item.title}”`
    : `Moved “${item.title}” to ${STATUS_LABEL[request.status]}`);
  return outcome;
}

/**
 * A status change from the detail pills or the List select (RW-7): a `move` to the top of the new status, never a
 * patch, so its Undo restores the card's exact place. Choosing the current status sends nothing.
 */
export function changeStatus(store: WorkStore, feedback: Feedback, item: Pick<Item, 'id' | 'title' | 'status'>, status: Status): Promise<WriteOutcome> | null {
  if (item.status === status) return null;
  return runMove(store, feedback, { id: item.id, status, anchor: { place: 'top' } }, item);
}

function reportUndo(feedback: Feedback, outcome: UndoOutcome, label: string): void {
  if (outcome.status === 'undone') feedback.push({ message: `Undone: ${label}`, meta: PLANNING_ONLY_META, tone: 'info' });
  else if (outcome.status === 'refused') feedback.push({ message: outcome.message, tone: 'warning' });
  else if (outcome.status === 'unconfirmed') feedback.push({ message: UNCONFIRMED_TOAST, tone: 'warning' });
  else if (outcome.status === 'failed') {
    const message = failureMessage(outcome.error);
    if (message) feedback.push({ message: `Not undone. ${message}`, tone: 'warning' });
  }
}

/** Ctrl/⌘+Z: consumes the newest undo entry once and removes the toast that offered it. */
export async function undoLatest(store: WorkStore, feedback: Feedback): Promise<UndoOutcome> {
  const entry = store.getState().undo.at(-1);
  if (entry) feedback.dismissUndo(entry.id);
  const outcome = await store.undo();
  if (entry) reportUndo(feedback, outcome, entry.label);
  return outcome;
}

/** A toast's Undo: consumes that entry if Ctrl/⌘+Z has not already. */
export async function undoFromToast(store: WorkStore, feedback: Feedback, toast: WorkToast): Promise<UndoOutcome> {
  feedback.dismiss(toast.id);
  if (!toast.undoId) return { status: 'empty' };
  const label = store.getState().undo.find((entry) => entry.id === toast.undoId)?.label ?? 'Change';
  const outcome = await store.undoEntry(toast.undoId);
  reportUndo(feedback, outcome, label);
  return outcome;
}

/** True while the user is typing, when board and undo shortcuts stay out of the way. */
export function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement;
}
