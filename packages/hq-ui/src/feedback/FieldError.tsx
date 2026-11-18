import type { ReactNode } from 'react';
import { cx } from '../components/cx';

export interface FieldErrorProps {
  /** Referenced by the field's `aria-describedby`; see `fieldErrorProps`. */
  readonly id: string;
  /** The message. Nothing renders when it is empty, so the layout only grows when there is an error. */
  readonly children?: ReactNode;
  /** Announce the message as it appears (use for errors raised while typing, not on submit). Default false. */
  readonly announce?: boolean;
  readonly className?: string;
}

/** Field-level error under an input: glyph plus words, tied to the input through `aria-describedby`. */
export function FieldError({ id, children, announce = false, className }: FieldErrorProps) {
  if (children === undefined || children === null || children === false || children === '') return null;
  return (
    <p id={id} className={cx('hq-field-error', className)} role={announce ? 'alert' : undefined}>
      <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5v5.5M12 16.5h.01" /></svg>
      <span>{children}</span>
    </p>
  );
}

/** Spread onto the input: marks it invalid and points it at its `FieldError` while there is an error. */
export function fieldErrorProps(id: string, error: unknown): { 'aria-invalid'?: true; 'aria-describedby'?: string } {
  return error ? { 'aria-invalid': true, 'aria-describedby': id } : {};
}
