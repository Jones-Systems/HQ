import { useEffect, useState, type PointerEvent, type MouseEvent } from 'react';
import { CheckIcon } from './icons';

export interface DoneButtonProps {
  /** Accessible name naming the item, for example `Mark “Renew the library card” done`. */
  readonly label: string;
  /** Makes the move (status Done, place top, with Undo). Called once per activation. */
  readonly onDone: () => void;
  readonly disabled?: boolean;
}

/** How long the filled check holds before the control can be used again, if the row is still there (a refused move). */
const HOLD_MS = 600;

/**
 * The round "mark done" control (flow assessment D-1), the same on the board, Plan week, Glance and List. It is a
 * real button: one click, Enter or Space calls `onDone` once, and the caller makes the move. The fill and check draw
 * are decoration and collapse to an instant change under reduced motion. Pointer-down never reaches a drag handler.
 */
export function DoneButton({ label, onDone, disabled = false }: DoneButtonProps) {
  const [checked, setChecked] = useState(false);
  useEffect(() => {
    if (!checked) return undefined;
    const timer = setTimeout(() => setChecked(false), HOLD_MS);
    return () => clearTimeout(timer);
  }, [checked]);
  return (
    <button
      type="button" className="wk-done" aria-label={label} title={label} disabled={disabled}
      data-checked={checked ? 'true' : undefined}
      onPointerDown={(event: PointerEvent) => event.stopPropagation()}
      onClick={(event: MouseEvent) => {
        event.stopPropagation();
        if (checked) return;
        setChecked(true);
        onDone();
      }}
    >
      <CheckIcon />
    </button>
  );
}
