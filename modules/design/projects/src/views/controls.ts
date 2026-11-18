import { createElement as h, useCallback, useId, useRef, useState, type ReactNode } from 'react';

export interface ActionButtonProps {
  readonly label: string;
  readonly variant?: 'primary' | 'secondary' | 'ghost';
  readonly onClick: () => void;
  /** Why the action is unavailable. Present means the button stays visible and focusable but does nothing. */
  readonly reason?: string | undefined;
  readonly busy?: boolean;
  readonly busyLabel?: string;
  readonly icon?: ReactNode;
  readonly expanded?: boolean;
  readonly controls?: string;
  readonly className?: string;
  readonly buttonRef?: { current: HTMLButtonElement | null };
}

/**
 * A button for an action that may be unavailable. Unavailable actions stay in place with `aria-disabled` (so they
 * keep keyboard focus), name their reason through `aria-describedby`, and ignore every activation path.
 */
export function ActionButton({ label, variant = 'secondary', onClick, reason, busy = false, busyLabel, icon, expanded, controls, className, buttonRef }: ActionButtonProps) {
  const reasonId = useId();
  const unavailable = reason !== undefined;
  return h('span', { className: 'hqp-action' },
    h('button', {
      ref: buttonRef, type: 'button', className: `hq-btn hq-btn--${variant}${className ? ` ${className}` : ''}`,
      'aria-disabled': unavailable || undefined, 'aria-describedby': unavailable ? reasonId : undefined,
      'aria-busy': busy || undefined, 'aria-expanded': expanded, 'aria-controls': controls,
      onClick: (event: { preventDefault(): void }) => {
        if (unavailable || busy) { event.preventDefault(); return; }
        onClick();
      },
    }, busy ? h('span', { className: 'hq-spinner', 'aria-hidden': true }) : icon ?? null, busy ? busyLabel ?? label : label),
    unavailable ? h('span', { id: reasonId, role: 'tooltip', className: 'hqp-reason' }, reason) : null);
}

/** A labelled control. The render prop receives the ids that tie the label and the field error to the control. */
export function Field({ label, grow = false, children }: {
  readonly label: string;
  readonly grow?: boolean;
  readonly children: (ids: { readonly inputId: string; readonly errorId: string }) => ReactNode;
}) {
  const inputId = useId();
  const errorId = useId();
  return h('div', { className: `hqp-field${grow ? ' hqp-field-grow' : ''}` },
    h('label', { htmlFor: inputId }, label),
    children({ inputId, errorId }));
}

/** Runs one submit at a time; a second activation while the first is pending is ignored, not queued. */
export function useSingleFlight(): { readonly pending: boolean; readonly run: <T>(work: () => Promise<T>) => Promise<T | undefined> } {
  const flying = useRef(false);
  const [pending, setPending] = useState(false);
  const run = useCallback(async <T,>(work: () => Promise<T>): Promise<T | undefined> => {
    if (flying.current) return undefined;
    flying.current = true;
    setPending(true);
    try { return await work(); } finally { flying.current = false; setPending(false); }
  }, []);
  return { pending, run };
}

export type FieldRender = (ids: { readonly inputId: string; readonly errorId: string }) => ReactNode;

/** `Field` with its render function as an argument, so createElement's child typing stays out of the way. */
export const field = (label: string, children: FieldRender, grow = false) => h(Field, { label, grow, children });
