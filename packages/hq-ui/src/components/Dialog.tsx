import { useEffect, useId, useRef, type KeyboardEvent, type ReactNode, type RefObject } from 'react';
import { cx } from './cx';

const FOCUSABLE = [
  'a[href]', 'button:not([disabled])', 'input:not([disabled]):not([type="hidden"])', 'select:not([disabled])',
  'textarea:not([disabled])', 'iframe', '[tabindex]:not([tabindex="-1"])', '[contenteditable="true"]',
].join(',');

export function focusableWithin(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => !el.closest('[inert]') && !el.hidden);
}

export interface DialogProps {
  readonly open: boolean;
  /** Called for Escape, the scrim (when `dismissOnScrim`) and any close control the caller renders. */
  readonly onClose: () => void;
  readonly title: ReactNode;
  readonly description?: ReactNode;
  readonly children?: ReactNode;
  /** Footer actions, typically Buttons. */
  readonly actions?: ReactNode;
  /** Element to focus on open; defaults to the first focusable element, then the dialog itself. */
  readonly initialFocusRef?: RefObject<HTMLElement | null>;
  readonly dismissOnScrim?: boolean;
  readonly role?: 'dialog' | 'alertdialog';
  readonly className?: string;
}

/**
 * Modal dialog: focus moves in on open, Tab and Shift+Tab cycle inside it, focus that escapes is pulled back,
 * Escape closes, and focus returns to the element that had it before opening.
 */
export function Dialog({
  open, onClose, title, description, children, actions, initialFocusRef, dismissOnScrim = true, role = 'dialog', className,
}: DialogProps) {
  const id = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const panel = panelRef.current;
    if (!panel) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    (initialFocusRef?.current ?? focusableWithin(panel)[0] ?? panel).focus();
    const keepFocus = (event: FocusEvent) => {
      if (event.target instanceof Node && !panel.contains(event.target)) (focusableWithin(panel)[0] ?? panel).focus();
    };
    document.addEventListener('focusin', keepFocus);
    return () => {
      document.removeEventListener('focusin', keepFocus);
      if (opener?.isConnected) opener.focus();
    };
  }, [open, initialFocusRef]);

  if (!open) return null;

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      onCloseRef.current();
      return;
    }
    if (event.key !== 'Tab' || !panelRef.current) return;
    const items = focusableWithin(panelRef.current);
    if (items.length === 0) { event.preventDefault(); return; }
    const first = items[0]!;
    const last = items[items.length - 1]!;
    const current = document.activeElement;
    if (event.shiftKey && (current === first || current === panelRef.current)) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && current === last) { event.preventDefault(); first.focus(); }
  };

  return (
    <div className="hq-dialog-layer">
      <div className="hq-dialog-scrim" aria-hidden="true" onClick={dismissOnScrim ? () => onCloseRef.current() : undefined} />
      <div
        ref={panelRef}
        role={role}
        aria-modal="true"
        aria-labelledby={`${id}-title`}
        aria-describedby={description ? `${id}-description` : undefined}
        tabIndex={-1}
        className={cx('hq-dialog', className)}
        onKeyDown={onKeyDown}
      >
        <h2 id={`${id}-title`} className="hq-dialog-title">{title}</h2>
        {description && <p id={`${id}-description`} className="hq-dialog-description">{description}</p>}
        {children && <div className="hq-dialog-body">{children}</div>}
        {actions && <div className="hq-dialog-actions">{actions}</div>}
      </div>
    </div>
  );
}
