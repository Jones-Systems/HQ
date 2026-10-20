import { useEffect, useLayoutEffect, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { Button, IconButton } from './Button';
import { cx } from './cx';

export const TOAST_AUTO_DISMISS_MS = 8000;

export interface ToastRegionProps {
  /** Accessible name of the landmark, for example "Notifications". */
  readonly label: string;
  readonly children?: ReactNode;
  readonly className?: string;
}

/**
 * Polite live region for toasts. Render it once and keep it mounted, so new toasts are announced. It sits in DOM
 * order, so its buttons are reachable with Tab like any other control.
 */
export function ToastRegion({ label, children, className }: ToastRegionProps) {
  return (
    <section className={cx('hq-toast-region', className)} aria-label={label}>
      <div role="status" aria-live="polite" aria-atomic="false" className="hq-toast-stack">{children}</div>
    </section>
  );
}

export interface ToastAction {
  /** Usually "Undo". */
  readonly label: string;
  readonly onAction: () => void;
  readonly keyshortcuts?: string;
}

interface ToastContentProps {
  readonly message: ReactNode;
  /** Secondary mono line, for example "Planning change only · no run started". */
  readonly meta?: ReactNode;
  readonly action?: ToastAction;
  /** Adds a Dismiss button and lets Escape dismiss while focus is inside the toast. */
  readonly onDismiss?: () => void;
  readonly className?: string;
}

export type ToastProps = ToastContentProps & (
  | { readonly autoDismissMs: number; readonly onDismiss: () => void }
  | { readonly autoDismissMs?: undefined; readonly onDismiss?: () => void }
);

/** Persistent by default. Opt-in expiry pauses during hover, focus within, and document hiding. */
export function Toast({ message, meta, action, onDismiss, autoDismissMs, className }: ToastProps) {
  const hovered = useRef(false);
  const focused = useRef(false);
  const dismiss = useRef(onDismiss);
  const syncTimer = useRef<(() => void) | null>(null);
  useLayoutEffect(() => { dismiss.current = onDismiss; }, [onDismiss]);
  useEffect(() => {
    if (autoDismissMs === undefined || !Number.isFinite(autoDismissMs) || autoDismissMs < 0) return;
    let remaining = autoDismissMs;
    let started = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let expired = false;
    const pause = () => {
      if (timer === undefined) return;
      clearTimeout(timer);
      timer = undefined;
      remaining = Math.max(0, remaining - (Date.now() - started));
    };
    const sync = () => {
      if (hovered.current || focused.current || document.hidden) { pause(); return; }
      if (timer !== undefined || expired) return;
      started = Date.now();
      timer = setTimeout(() => {
        timer = undefined;
        expired = true;
        dismiss.current?.();
      }, remaining);
    };
    syncTimer.current = sync;
    document.addEventListener('visibilitychange', sync);
    sync();
    return () => {
      pause();
      syncTimer.current = null;
      document.removeEventListener('visibilitychange', sync);
    };
  }, [autoDismissMs, message]);
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape' && onDismiss) { event.stopPropagation(); onDismiss(); }
  };
  return (
    <div className={cx('hq-toast', className)} onKeyDown={onKeyDown}
      onMouseEnter={() => { hovered.current = true; syncTimer.current?.(); }}
      onMouseLeave={() => { hovered.current = false; syncTimer.current?.(); }}
      onFocusCapture={() => { focused.current = true; syncTimer.current?.(); }}
      onBlurCapture={(event) => {
        if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
        focused.current = false;
        syncTimer.current?.();
      }}>
      <div className="hq-toast-text">
        <span>{message}</span>
        {meta && <span className="hq-meta">{meta}</span>}
      </div>
      {action && <Button size="sm" variant="secondary" onClick={action.onAction} aria-keyshortcuts={action.keyshortcuts}>{action.label}</Button>}
      {onDismiss && (
        <IconButton
          size="sm"
          label="Dismiss"
          onClick={onDismiss}
          icon={<svg viewBox="0 0 24 24"><path d="m7 7 10 10M17 7 7 17" /></svg>}
        />
      )}
    </div>
  );
}
