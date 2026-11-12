import { useEffect, useId, useRef, useState, type FocusEvent, type KeyboardEvent, type ReactNode } from 'react';
import { Button, IconButton, MOTION_DURATIONS } from '@hq/ui';

export interface ToolButtonProps {
  /** Accessible name. Also the tooltip text while the action is available. */
  readonly label: string;
  /** Shown after the label in the tooltip, for example `Shift+1`. */
  readonly shortcut?: string;
  /** Decorative icon. Omit it and pass `text` for a text button such as the zoom readout. */
  readonly icon?: ReactNode;
  readonly text?: ReactNode;
  /**
   * Why the action cannot run right now. The button stays visible and focusable (`aria-disabled`), nothing runs on
   * activation, and the reason is the tooltip and the accessible description.
   */
  readonly unavailable?: string | null;
  readonly expanded?: boolean;
  readonly haspopup?: 'dialog' | 'menu';
  /** Tooltip alignment against the button, so one near the right edge stays on screen. */
  readonly align?: 'start' | 'end';
  readonly onClick: () => void;
}

/** `:focus-visible` is how the browser says the focus came from the keyboard. Where it cannot say, treat focus as visible. */
function focusIsVisible(element: HTMLElement): boolean {
  try { return element.matches(':focus-visible'); } catch { return true; }
}

/** Hover waits this long, so passing over the toolbar stays quiet. Keyboard focus shows the tooltip at once. */
const HOVER_DELAY_MS = MOTION_DURATIONS.slow;

/**
 * Toolbar button with a tooltip that appears on hover and on keyboard focus and closes with Escape. An unavailable
 * action keeps its place and explains itself instead of disappearing or going silently dead.
 */
export function ToolButton({ label, shortcut, icon, text, unavailable = null, expanded, haspopup, align = 'start', onClick }: ToolButtonProps) {
  const tipId = useId();
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stop = () => { if (timer.current !== null) { clearTimeout(timer.current); timer.current = null; } };
  const show = (delay: number) => { stop(); if (delay === 0) setOpen(true); else timer.current = setTimeout(() => setOpen(true), delay); };
  const hide = () => { stop(); setOpen(false); };
  useEffect(() => stop, []);

  const reason = unavailable;
  const tip = reason ?? (shortcut ? `${label} (${shortcut})` : label);
  const common = {
    'aria-disabled': reason ? true : undefined,
    'aria-describedby': reason ? tipId : undefined,
    'aria-expanded': expanded,
    'aria-haspopup': haspopup,
    onClick: () => { if (!reason) onClick(); },
    onPointerDown: hide,
  } as const;

  return <span className="hq-canvas-tool" data-tip={open && expanded !== true ? 'open' : undefined} data-align={align} data-unavailable={reason ? true : undefined}
    onPointerEnter={() => show(HOVER_DELAY_MS)} onPointerLeave={hide}
    onFocus={(event: FocusEvent<HTMLElement>) => { if (focusIsVisible(event.target as HTMLElement)) show(0); }}
    onBlur={hide}
    onKeyDown={(event: KeyboardEvent<HTMLElement>) => {
      if (event.key === 'Escape' && open) { event.stopPropagation(); hide(); }
    }}>
    {icon !== undefined
      ? <IconButton {...common} size="sm" label={label} title="" icon={icon} className="hq-canvas-tool-button" />
      : <Button {...common} size="sm" variant="ghost" aria-label={label} className="hq-canvas-tool-button hq-canvas-tool-text">{text}</Button>}
    <span id={tipId} role="tooltip" className="hq-canvas-tip" aria-hidden={reason ? undefined : true}>{tip}</span>
  </span>;
}
