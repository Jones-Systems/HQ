import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';

/** The words every card's `aria-describedby` points at: the board's input model, for screen readers. */
export const BOARD_KEYS_TEXT = 'Drag a card, or use its Move menu. On a focused card: Alt+←/→ changes status, Alt+↑/↓ reorders, M opens the move menu, Enter opens it.';

const Keys = ({ children }: { children: ReactNode }) => <span className="work-keys">{children}</span>;
const K = ({ children }: { children: ReactNode }) => <kbd className="wk-kbd">{children}</kbd>;

const ROWS: { keys: ReactNode; does: string }[] = [
  { keys: <Keys><K>Alt</K><K>←</K><K>→</K></Keys>, does: 'Change status' },
  { keys: <Keys><K>Alt</K><K>↑</K><K>↓</K></Keys>, does: 'Reorder in the column' },
  { keys: <Keys><K>M</K></Keys>, does: 'Open the move menu' },
  { keys: <Keys><K>Enter</K></Keys>, does: 'Open the card' },
  { keys: <Keys><K>←</K><K>→</K><K>↑</K><K>↓</K></Keys>, does: 'Move focus between cards' },
  { keys: <Keys><K>Esc</K></Keys>, does: 'Cancel a drag' },
];

/**
 * A compact "Keyboard" control with a popover, replacing the three-line paragraph. The popover is a disclosure, not a
 * modal: Escape or a click outside closes it, and focus returns to the button.
 */
export function KeyboardHint() {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const panelId = useId();

  useEffect(() => {
    if (!open) return undefined;
    const outside = (event: PointerEvent) => { if (root.current && !root.current.contains(event.target as Node)) setOpen(false); };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [open]);

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== 'Escape' || !open) return;
    event.preventDefault();
    event.stopPropagation();
    setOpen(false);
    button.current?.focus();
  };

  return (
    <div className="work-keyhint" ref={root} onKeyDown={onKeyDown}>
      <button ref={button} type="button" className="work-keyhint-button" aria-expanded={open} aria-controls={open ? panelId : undefined} onClick={() => setOpen((value) => !value)}>
        Keyboard <kbd className="wk-kbd" aria-hidden="true">?</kbd>
      </button>
      {open && (
        <div id={panelId} className="work-keyhint-panel hq-enter-scale" role="group" aria-label="Board keyboard shortcuts">
          <p className="work-keyhint-lead">Drag a card, or use its <strong>⋯</strong> menu. On a focused card:</p>
          <dl className="work-keyhint-list">
            {ROWS.map((row) => (
              <div key={row.does} className="work-keyhint-row"><dt>{row.keys}</dt><dd>{row.does}</dd></div>
            ))}
          </dl>
        </div>
      )}
    </div>
  );
}
