import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { ToastViewport, useToast, type ToastDismissReason, type ToastInput } from '@hq/ui';
import type { Notice, WorkState, WorkStore } from '../core';
import { isTyping, undoFromToast, undoLatest, UNCONFIRMED_TOAST } from './actions';
import { PLANNING_ONLY_META, useFeedback, type Feedback, type WorkToast } from './feedback';
import './feedback.css';

/** The words on a toast's action buttons. */
export const UNDO_LABEL = 'Undo';
export const CHECK_LABEL = 'Check';

/**
 * True when no toast viewport exists in the document: a component test, the evidence harness or a standalone views
 * host. The shell mounts the one real viewport, so inside the app this stays false and Work adds nothing of its own.
 */
function useNeedsViewport(): boolean {
  const [needed, setNeeded] = useState(false);
  useLayoutEffect(() => {
    if (typeof document !== 'undefined' && !document.querySelector('.hq-toast-viewport')) setNeeded(true);
  }, []);
  return needed;
}

function noticeInput(notice: Notice, onDismiss: (reason: ToastDismissReason) => void): ToastInput {
  return {
    tone: notice.tone === 'danger' ? 'danger' : notice.tone === 'warning' ? 'warning' : 'info',
    title: notice.text,
    // A store notice (an order conflict, an unreachable Planner) stays until it is dismissed, as it always did.
    duration: Infinity,
    onDismiss,
  };
}

/**
 * Work toasts and store notices, shown through the shared `@hq/ui` toast viewport (task: flow assessment X-3).
 *
 * `feedback` is the list Work code pushes to. This component mirrors it onto the toast store and writes dismissals
 * back, so a toast that times out or is closed also leaves the list. An Undo shows only while its entry is still on
 * the core undo stack and runs at most once: Ctrl/⌘+Z consumes the entry, removes the toast that offered it, and the
 * toast's own Undo consumes it the same way. An unconfirmed outcome offers Check, never a blind retry. Every toast
 * says that it is a planning change only.
 */
export function WorkToasts({ store, state, feedback }: { store: WorkStore; state: WorkState; feedback: Feedback }) {
  const toast = useToast();
  const toasts = useFeedback(feedback);
  const undoable = new Set(state.undo.map((entry) => entry.id));
  const mirrored = useRef(new Map<string, string>());
  const spent = useRef(new Set<string>());
  const ownViewport = useNeedsViewport();

  useEffect(() => {
    const wanted = new Set<string>();
    const show = (id: string, signature: string, input: ToastInput) => {
      wanted.add(id);
      const previous = mirrored.current.get(id);
      if (previous === signature) return;
      mirrored.current.set(id, signature);
      // A toast already shown that only lost its Undo keeps its place; anything else is (re)shown under the same id.
      if (previous !== undefined && previous.replace(/\|undo$/u, '') === signature.replace(/\|undo$/u, '')) {
        toast.update(id, { action: input.action });
      } else {
        toast.show({ ...input, id });
      }
    };

    for (const item of toasts) {
      const id = `${feedback.key}:${item.id}`;
      const canUndo = item.undoId !== undefined && undoable.has(item.undoId);
      const input = feedbackInput(item, canUndo, {
        undo: () => {
          if (item.undoId === undefined || spent.current.has(item.undoId)) return;
          spent.current.add(item.undoId);
          void undoFromToast(store, feedback, item);
        },
        check: () => void store.reconcile(),
        dismissed: (reason) => {
          if (reason === 'programmatic') return;
          mirrored.current.delete(id);
          feedback.dismiss(item.id);
        },
      });
      show(id, `${item.tone}|${item.message}|${item.meta ?? ''}${canUndo ? '|undo' : ''}`, input);
    }
    for (const notice of state.notices) {
      const id = `${feedback.key}:notice:${notice.id}`;
      show(id, `notice|${notice.tone}|${notice.text}`, noticeInput(notice, (reason) => {
        if (reason === 'programmatic') return;
        mirrored.current.delete(id);
        store.dismissNotice(notice.id);
      }));
    }
    for (const id of [...mirrored.current.keys()]) {
      if (wanted.has(id)) continue;
      mirrored.current.delete(id);
      toast.dismiss(id);
    }
  });

  // Leaving Work (a domain switch) takes its toasts out of the shared viewport; the list still holds them for the return.
  useEffect(() => {
    const live = mirrored.current;
    return () => {
      for (const id of live.keys()) toast.dismiss(id);
      live.clear();
    };
  }, [toast]);

  return ownViewport ? <ToastViewport label="Work notifications" /> : null;
}

interface Handlers {
  undo(): void;
  check(): void;
  dismissed(reason: ToastDismissReason): void;
}

/** One Work toast as a shared toast: its tone, words, provenance line and (when it applies) its one action. */
function feedbackInput(item: WorkToast, canUndo: boolean, handlers: Handlers): ToastInput {
  const unknown = item.tone === 'unknown' || (item.tone === 'warning' && item.message === UNCONFIRMED_TOAST);
  const base = { duration: 8000, title: item.message, meta: item.meta ?? PLANNING_ONLY_META, onDismiss: handlers.dismissed };
  if (unknown) {
    return { ...base, tone: 'unknown', duration: Infinity, action: { label: CHECK_LABEL, onAction: handlers.check } };
  }
  if (item.tone === 'danger') return { ...base, tone: 'danger', duration: Infinity };
  // A refused or failed write stays until it is dismissed, so what was kept is never missed.
  if (item.tone === 'warning') return { ...base, tone: 'warning', duration: Infinity };
  return {
    ...base,
    tone: item.undoId === undefined ? 'info' : 'success',
    ...(canUndo ? { action: { label: UNDO_LABEL, keyshortcuts: 'Control+Z Meta+Z', onAction: handlers.undo } } : {}),
  };
}

/** Ctrl/⌘+Z inside the Work surface undoes the newest entry; ignored while typing (RV-1, RW-8). */
export function useUndoShortcut(root: RefObject<HTMLElement | null>, store: WorkStore, feedback: Feedback): void {
  useEffect(() => {
    const element = root.current;
    if (!element) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.shiftKey || event.altKey || event.key.toLowerCase() !== 'z') return;
      if (isTyping(event.target)) return;
      event.preventDefault();
      void undoLatest(store, feedback);
    };
    element.addEventListener('keydown', onKeyDown);
    return () => element.removeEventListener('keydown', onKeyDown);
  }, [root, store, feedback]);
}
