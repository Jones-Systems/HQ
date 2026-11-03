import { useEffect, type RefObject } from 'react';
import { Toast, ToastRegion, TOAST_AUTO_DISMISS_MS } from '@hq/ui';
import type { WorkState, WorkStore } from '../core';
import { isTyping, undoFromToast, undoLatest } from './actions';
import { useFeedback, type Feedback } from './feedback';

/**
 * Work toasts and store notices. A toast offers Undo only while its entry is still on the core undo stack, so an
 * entry consumed by Ctrl/⌘+Z (or by another toast) can never run twice.
 */
export function WorkToasts({ store, state, feedback }: { store: WorkStore; state: WorkState; feedback: Feedback }) {
  const toasts = useFeedback(feedback);
  const live = new Set(state.undo.map((entry) => entry.id));
  return (
    <ToastRegion label="Work notifications">
      {toasts.map((toast) => (
        <Toast
          key={toast.id}
          className={`work-toast work-toast--${toast.tone}`}
          message={toast.message}
          meta={toast.meta}
          autoDismissMs={toast.tone === 'info' ? TOAST_AUTO_DISMISS_MS : undefined}
          action={toast.undoId && live.has(toast.undoId) ? { label: 'Undo', keyshortcuts: 'Control+Z Meta+Z', onAction: () => void undoFromToast(store, feedback, toast) } : undefined}
          onDismiss={() => feedback.dismiss(toast.id)}
        />
      ))}
      {state.notices.map((notice) => (
        <Toast
          key={notice.id}
          className={`work-toast work-toast--${notice.tone}`}
          message={notice.text}
          onDismiss={() => store.dismissNotice(notice.id)}
        />
      ))}
    </ToastRegion>
  );
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
