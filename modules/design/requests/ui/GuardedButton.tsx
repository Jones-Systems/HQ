import { Button, type ButtonProps } from '@hq/ui';
import { useId, type MouseEvent } from 'react';

export const cx = (...names: readonly (string | false | null | undefined)[]): string => names.filter(Boolean).join(' ');

export interface GuardedButtonProps extends Omit<ButtonProps, 'disabled' | 'aria-disabled'> {
  /**
   * Why the action is unavailable, or null/undefined when it is available. An unavailable button stays visible
   * and keyboard-focusable, the reason is read out through `aria-describedby` and shown on hover and focus, and
   * every activation path (click, Enter, Space, form submit) is refused.
   */
  readonly unavailable?: string | null;
  /** An element that already shows the reason. The button points at it instead of drawing its own tooltip. */
  readonly reasonId?: string;
}

/** A button that explains itself when it cannot be used, instead of going silently dead. */
export function GuardedButton({ unavailable, reasonId, onClick, className, 'aria-describedby': describedBy, children, ...rest }: GuardedButtonProps) {
  const ownId = useId();
  const blocked = Boolean(unavailable);
  const tooltip = blocked && reasonId === undefined;
  const guarded = (event: MouseEvent<HTMLButtonElement>) => {
    if (blocked) { event.preventDefault(); return; }
    onClick?.(event);
  };
  return <span className="hqr-action">
    <Button {...rest} className={className} aria-disabled={blocked || undefined}
      aria-describedby={cx(blocked && (reasonId ?? ownId), describedBy) || undefined} onClick={guarded}>{children}</Button>
    {tooltip && <span id={ownId} role="tooltip" className="hqr-reason">{unavailable}</span>}
  </span>;
}
