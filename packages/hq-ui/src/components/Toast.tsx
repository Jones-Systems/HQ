import type { KeyboardEvent, ReactNode } from 'react';
import { Button, IconButton } from './Button';
import { cx } from './cx';

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
      <div role="status" aria-live="polite" className="hq-toast-stack">{children}</div>
    </section>
  );
}

export interface ToastAction {
  /** Usually "Undo". */
  readonly label: string;
  readonly onAction: () => void;
}

export interface ToastProps {
  readonly message: ReactNode;
  /** Secondary mono line, for example "Planning change only · no run started". */
  readonly meta?: ReactNode;
  readonly action?: ToastAction;
  /** Adds a Dismiss button and lets Escape dismiss while focus is inside the toast. */
  readonly onDismiss?: () => void;
  readonly className?: string;
}

/**
 * One toast. It never dismisses itself: an Undo that times out would fail WCAG 2.2.1, so the caller decides when
 * a toast leaves. The action is a real button; activating it runs only the caller's handler.
 */
export function Toast({ message, meta, action, onDismiss, className }: ToastProps) {
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape' && onDismiss) { event.stopPropagation(); onDismiss(); }
  };
  return (
    <div className={cx('hq-toast', className)} onKeyDown={onKeyDown}>
      <div className="hq-toast-text">
        <span>{message}</span>
        {meta && <span className="hq-meta">{meta}</span>}
      </div>
      {action && <Button size="sm" variant="secondary" onClick={action.onAction}>{action.label}</Button>}
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
