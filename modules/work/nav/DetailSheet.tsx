import { useEffect, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { CloseIcon } from './icons';

/** The content width (px) of the work area below which the card detail becomes an overlay sheet instead of a side panel. */
export const SHEET_BREAKPOINT = 720;

export interface DetailSheetProps {
  readonly children: ReactNode;
  readonly label: string;
  /** Closes the sheet: the scrim, the close button and Escape all call it. */
  readonly onClose: () => void;
}

/**
 * The card detail as an overlay sheet from the end, for a work area too narrow to share (F7-X6). It has a scrim, a close
 * button and Escape; focus moves into it on open and returns to where it was when it closes; the page behind is inert
 * while it is open. It slides in with the shared `hq-enter-slide-end` motion, instantly under reduced motion.
 */
export function DetailSheet({ children, label, onClose }: DetailSheetProps) {
  const sheet = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLElement | null>(document.activeElement instanceof HTMLElement ? document.activeElement : null);

  useEffect(() => {
    // Focus lands on the sheet itself, so a screen reader hears its name; Tab then walks its controls.
    sheet.current?.focus({ preventScroll: true });
    const back = opener.current;
    return () => { if (back?.isConnected) back.focus({ preventScroll: true }); };
  }, []);

  const onKeyDown = (event: KeyboardEvent) => {
    // A control inside that handled Escape itself (a menu, an open field) marks it defaultPrevented.
    if (event.key !== 'Escape' || event.defaultPrevented) return;
    event.preventDefault();
    event.stopPropagation();
    onClose();
  };

  return (
    <div className="wd-sheet-layer">
      <div className="wd-sheet-scrim hq-enter-fade" aria-hidden="true" onClick={onClose} />
      <div
        ref={sheet}
        className="wd-sheet hq-enter-slide-end" role="dialog" aria-modal="true" aria-label={label} tabIndex={-1} onKeyDown={onKeyDown}
      >
        <div className="wd-sheet-bar">
          <button type="button" className="wd-sheet-close" aria-label="Close details" onClick={onClose}>
            <CloseIcon />
            <span>Close</span>
          </button>
        </div>
        <div className="wd-sheet-body">{children}</div>
      </div>
    </div>
  );
}
