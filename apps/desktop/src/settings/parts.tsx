import {
  forwardRef, useEffect, useId, useLayoutEffect, useRef, useState,
  type HTMLAttributes, type ReactNode, type Ref,
} from 'react';
import { Button, FieldError, InlineNotice, Presence, StatusChip, StatusIndicator, fieldErrorProps, type ButtonProps } from '@hq/ui';
import type { Failure } from './actions';
import type { Chip } from './status';

export const cx = (...names: readonly (string | false | null | undefined)[]) => names.filter(Boolean).join(' ');

/** 18 px stroke icons in the rail's style. Decorative: every use sits beside a text label. */
const ICONS = {
  overview: <><rect x="4" y="4" width="6.5" height="6.5" rx="1.5" /><rect x="13.5" y="4" width="6.5" height="6.5" rx="1.5" /><rect x="4" y="13.5" width="6.5" height="6.5" rx="1.5" /><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.5" /></>,
  services: <><rect x="4" y="4" width="16" height="6.5" rx="1.5" /><rect x="4" y="13.5" width="16" height="6.5" rx="1.5" /><path d="M8 7.25h.01M8 16.75h.01" /></>,
  wiki: <><path d="M12 5c-3-2-6-2-9-1v15c3-1 6-1 9 1 3-2 6-2 9-1V4c-3-1-6-1-9 1Z" /><path d="M12 5v15" /></>,
  projects: <path d="M3.5 7.5a2 2 0 0 1 2-2h4l2 2.5h7a2 2 0 0 1 2 2v7.5a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2Z" />,
  appearance: <><circle cx="12" cy="12" r="8" /><path d="M12 4a8 8 0 0 1 0 16Z" fill="currentColor" /></>,
  updates: <path d="M12 4v11m0 0-4-4m4 4 4-4M5 19.5h14" />,
  social: <><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="4" /></>,
  work: <><rect x="4" y="4" width="16" height="16" rx="2" /><path d="M8 9h8M8 15h8" /></>,
  jones: <path d="M5.5 5.5h13a1 1 0 0 1 1 1v8.5a1 1 0 0 1-1 1h-6.5l-4 3.5V16h-2.5a1 1 0 0 1-1-1V6.5a1 1 0 0 1 1-1Z" />,
  rotate: <><path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3" /><path d="M19.5 4.5v4.2h-4.2" /></>,
  chevron: <path d="m9.5 6 6 6-6 6" />,
} as const;
export type IconName = keyof typeof ICONS;

export function Icon({ name, className }: { name: IconName; className?: string }) {
  return <svg className={cx('settings-icon', className)} aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">{ICONS[name]}</svg>;
}

/** `h2` for a category plus one short sentence of help. The heading takes focus when the category changes. */
export function SettingsHeading({ id, title, children, actions }: { id: string; title: string; children?: ReactNode; actions?: ReactNode }) {
  return <div className="settings-section-heading">
    <div className="settings-section-copy"><h2 id={id} tabIndex={-1}>{title}</h2>{children && <p>{children}</p>}</div>
    {actions && <div className="settings-section-actions">{actions}</div>}
  </div>;
}

export function Panel({ busy, className, children, ...rest }: HTMLAttributes<HTMLDivElement> & { busy?: boolean }) {
  return <div {...rest} className={cx('settings-group', className)} aria-busy={busy || undefined}>{children}</div>;
}

export function restartFlash(element: HTMLElement | null) {
  if (!element) return;
  element.classList.remove('hq-flash');
  void element.offsetWidth;
  element.classList.add('hq-flash');
}

export interface RowProps {
  /** Landmark name; a named row is a region so deep links and tests can find it. */
  readonly region?: string;
  readonly id?: string;
  readonly title: ReactNode;
  readonly description?: ReactNode;
  readonly icon?: IconName;
  readonly status?: ReactNode;
  /** Put the status on the title line (summary lists) instead of under the description. */
  readonly statusInline?: boolean;
  readonly control?: ReactNode;
  /** Increment to play `hq-flash` on this row once (reduced motion keeps it: it is colour only). */
  readonly flash?: number;
  readonly target?: boolean;
  readonly className?: string;
  /** Names the row for `useListMotion` lists. */
  readonly motionKey?: string;
  /** Notices and disclosures that open under the row, full width. */
  readonly children?: ReactNode;
}

/** Left copy (label, description, status) and a right control cluster; extra content opens inside the same row. */
export function Row({ region, id, title, description, icon, status, statusInline, control, flash = 0, target, className, motionKey, children }: RowProps) {
  const element = useRef<HTMLElement>(null);
  const played = useRef(flash);
  useEffect(() => {
    if (flash !== played.current) { played.current = flash; restartFlash(element.current); }
  }, [flash]);
  const body = <>
    <div className="settings-row">
      {icon && <span className="settings-row-icon"><Icon name={icon} /></span>}
      <div className="settings-row-copy">
        {statusInline && status ? <div className="settings-row-head"><h3>{title}</h3>{status}</div> : <h3>{title}</h3>}
        {description && <p>{description}</p>}
        {!statusInline && status && <div className="settings-row-status">{status}</div>}
      </div>
      {control && <div className="settings-row-control">{control}</div>}
    </div>
    {children}
  </>;
  const classes = cx('settings-source', target && 'is-target', className);
  const motion = motionKey ? { 'data-hq-motion-key': motionKey } : {};
  return region
    ? <section ref={element} id={id} className={classes} aria-label={region} {...motion}>{body}</section>
    : <div ref={element as Ref<HTMLDivElement>} id={id} className={classes} {...motion}>{body}</div>;
}

export interface FieldControlProps { readonly id: string; readonly 'aria-describedby'?: string; readonly 'aria-invalid'?: true }

/** Label above the input, help below it; an error replaces the help and marks the input invalid. */
export function Field({ label, help, error, children }: { label: string; help?: ReactNode; error?: ReactNode; children: (props: FieldControlProps) => ReactNode }) {
  const id = useId();
  const props: FieldControlProps = { id, ...(error ? fieldErrorProps(`${id}-error`, error) : help ? { 'aria-describedby': `${id}-help` } : {}) };
  return <div className="settings-field">
    <label htmlFor={id}>{label}</label>
    {children(props)}
    {error ? <FieldError id={`${id}-error`}>{error}</FieldError> : help ? <p id={`${id}-help`} className="settings-field-help">{help}</p> : null}
  </div>;
}

const FIRST_FIELD = 'input:not([type="hidden"]):not([disabled]), select:not([disabled]), textarea:not([disabled])';

/** Collapses to nothing when closed. Moving from closed to open puts focus on the first field. */
export function Disclosure({ open, id, label, children }: { open: boolean; id: string; label: string; children: ReactNode }) {
  const inner = useRef<HTMLDivElement>(null);
  const wasOpen = useRef(open);
  useEffect(() => {
    if (open && !wasOpen.current) inner.current?.querySelector<HTMLElement>(FIRST_FIELD)?.focus();
    wasOpen.current = open;
  }, [open]);
  return <Presence show={open} motion="collapse" id={id} initial={false}>
    <div ref={inner} className="settings-disclosure" role="group" aria-label={label}>{children}</div>
  </Presence>;
}

/** Open state for a disclosure plus a ref to its trigger, so closing can put focus back where it started. */
export function useDisclosure(initial = false) {
  const [open, setOpen] = useState(initial);
  const trigger = useRef<HTMLButtonElement>(null);
  return {
    open, trigger,
    toggle: () => setOpen(value => !value),
    close: (restoreFocus = true) => { setOpen(false); if (restoreFocus) trigger.current?.focus(); },
  };
}

/** Escape closes an open disclosure from inside its fields without leaving Settings. */
export const closeOnEscape = (close: () => void) => (event: { key: string; preventDefault(): void; stopPropagation(): void }) => {
  if (event.key !== 'Escape') return;
  event.preventDefault(); event.stopPropagation(); close();
};

export interface ActionButtonProps extends ButtonProps {
  /** Why the action is unavailable right now. Present means unavailable: it stays focusable and says why. */
  readonly reason?: string | null;
  /** Busy without swapping the content for @hq/ui's spinner: icon buttons spin their own glyph instead. */
  readonly working?: boolean;
}

/**
 * Unavailable actions stay visible and focusable, state their reason on hover and keyboard focus
 * (`aria-describedby`), and ignore activation. A native `disabled` button cannot take focus, so it is never used.
 * The button keeps its width while busy so the control cluster does not shift.
 */
export const ActionButton = forwardRef<HTMLButtonElement, ActionButtonProps>(function ActionButton({ reason, busy, working, onClick, children, className, ...rest }, forwarded) {
  const reasonId = useId();
  const own = useRef<HTMLButtonElement | null>(null);
  const width = useRef(0);
  const holding = Boolean(busy || working);
  useLayoutEffect(() => {
    const element = own.current;
    if (!element) return;
    // @hq/ui's Button owns aria-busy for its own `busy`; `working` sets it by hand and clears it again.
    if (working) element.setAttribute('aria-busy', 'true'); else if (!busy) element.removeAttribute('aria-busy');
    if (!holding) { width.current = element.offsetWidth; element.style.removeProperty('min-width'); }
    else if (width.current > 0) element.style.setProperty('min-width', `${width.current}px`);
  }, [holding, working, busy]);
  const setRef = (element: HTMLButtonElement | null) => {
    own.current = element;
    if (typeof forwarded === 'function') forwarded(element); else if (forwarded) forwarded.current = element;
  };
  return <span className="settings-guarded">
    <Button {...rest} ref={setRef} busy={busy} className={className} aria-disabled={reason ? true : undefined} aria-describedby={reason ? reasonId : rest['aria-describedby']}
      onClick={event => { if (reason) { event.preventDefault(); return; } onClick?.(event); }}>{children}</Button>
    {reason && <span id={reasonId} role="tooltip" className="settings-reason">{reason}</span>}
  </span>;
});

/** The shared recheck/reindex glyph: it spins while `busy` and slows under reduced motion. */
export function RotateLabel({ busy, label, busyLabel }: { busy: boolean; label: string; busyLabel: string }) {
  return <><Icon name="rotate" className={busy ? 'is-spinning' : undefined} /><span>{busy ? busyLabel : label}</span></>;
}

/** A failed action, inline on its row. It collapses open and shut, and keeps its words while it leaves. */
export function FailureNotice({ failure, onDismiss }: { failure?: Failure; onDismiss: () => void }) {
  const last = useRef(failure);
  if (failure) last.current = failure;
  const shown = failure ?? last.current;
  const actions = shown ? [
    ...(shown.retry ? [{ label: 'Retry', onAction: shown.retry }] : []),
    ...(shown.check ? [{ label: 'Check', onAction: shown.check }] : []),
  ] : [];
  return <Presence show={Boolean(failure)} motion="collapse" initial={false}>
    {shown && <div className="settings-row-notice"><InlineNotice variant="bar" tone={shown.tone} live="off" title={shown.title} actions={actions} onDismiss={onDismiss}>{shown.detail}</InlineNotice></div>}
  </Presence>;
}

/** A row's ongoing state: shape, word and mono detail. Work in progress swaps the shape for a spinner and shimmers the word. */
export function ChipStatus({ chip, live = false }: { chip: Chip; live?: boolean }) {
  return <StatusIndicator tone={chip.tone} label={chip.label} {...(chip.detail ? { detail: chip.detail } : {})} busy={chip.busy ?? false} live={live}
    className={chip.busy ? 'settings-indicator--shimmer' : undefined} />;
}

/** The same chip as a static badge, for lists that summarise (Overview). */
export function ChipBadge({ chip }: { chip: Chip }) {
  return <StatusChip tone={chip.tone} label={chip.label} {...(chip.detail ? { detail: chip.detail } : {})} />;
}
