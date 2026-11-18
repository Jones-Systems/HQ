import { forwardRef, type ButtonHTMLAttributes, type MouseEvent, type ReactNode } from 'react';
import { cx } from './cx';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'md' | 'sm';

export interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'style'> {
  readonly variant?: ButtonVariant;
  readonly size?: ButtonSize;
  /** Shows a spinner and `busyLabel`, keeps focus and ignores activation while work is in progress. */
  readonly busy?: boolean;
  /** The verb in progress, for example "Saving". Defaults to the children. */
  readonly busyLabel?: ReactNode;
}

/** Native `<button>`; Enter and Space activate it. Defaults to `type="button"` so it never submits a form by accident. */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', busy = false, busyLabel, className, type = 'button', onClick, children, ...rest },
  ref,
) {
  const guarded = (event: MouseEvent<HTMLButtonElement>) => {
    if (busy) { event.preventDefault(); return; }
    onClick?.(event);
  };
  return (
    <button
      {...rest}
      ref={ref}
      type={type}
      className={cx('hq-btn', `hq-btn--${variant}`, size === 'sm' && 'hq-btn--sm', className)}
      aria-busy={busy || undefined}
      onClick={guarded}
    >
      {busy ? <><span className="hq-spinner" aria-hidden="true" />{busyLabel ?? children}</> : children}
    </button>
  );
});

export interface IconButtonProps extends Omit<ButtonProps, 'children' | 'aria-label' | 'busyLabel'> {
  /** Accessible name and tooltip; an icon alone is never the only label. */
  readonly label: string;
  /** Decorative icon, hidden from assistive technology. */
  readonly icon: ReactNode;
  /** Toggle state for a two-state icon button. */
  readonly pressed?: boolean;
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, icon, pressed, variant = 'ghost', className, title, ...rest },
  ref,
) {
  return (
    <Button
      {...rest}
      ref={ref}
      variant={variant}
      aria-label={label}
      aria-pressed={pressed}
      title={title ?? label}
      className={cx('hq-btn--icon', className)}
    >
      <span className="hq-icon" aria-hidden="true">{icon}</span>
    </Button>
  );
});
