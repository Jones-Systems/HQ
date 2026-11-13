import { useId, useLayoutEffect, useRef, type KeyboardEvent } from 'react';
import { DisclosureNav, type DisclosureNavProps } from './DisclosureNav';

export interface CompactNavProps extends DisclosureNavProps {
  readonly triggerLabel: string;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  /** After destination selection closes the flyout and restores the trigger, the host may focus its workspace. */
  readonly onWorkspaceFocus: () => void;
}

function focusableWithin(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])')]
    .filter(element => element.tabIndex >= 0 && !element.closest('[hidden], [inert]'));
}

/** Inline modal layer, with no Portal or global keyboard registration. Hosts own placement and background inertness. */
export function CompactNav({ triggerLabel, open, onOpenChange, onWorkspaceFocus, onNavigate, ...nav }: CompactNavProps) {
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const flyout = useRef<HTMLDivElement>(null);
  const workspacePending = useRef(false);
  const workspaceFocus = useRef(onWorkspaceFocus);
  workspaceFocus.current = onWorkspaceFocus;
  useLayoutEffect(() => {
    if (!open || !flyout.current) return;
    const panel = flyout.current;
    const opener = trigger.current;
    const first = () => {
      const items = focusableWithin(panel);
      return items.find(element => element.getAttribute('aria-current') === 'page') ?? items[0] ?? panel;
    };
    first().focus();
    const keepFocus = (event: FocusEvent) => {
      if (event.target instanceof Node && !panel.contains(event.target)) first().focus();
    };
    const ownerDocument = panel.ownerDocument;
    ownerDocument.addEventListener('focusin', keepFocus);
    return () => {
      ownerDocument.removeEventListener('focusin', keepFocus);
      if (opener?.isConnected) opener.focus();
      if (workspacePending.current) {
        workspacePending.current = false;
        workspaceFocus.current();
      }
    };
  }, [open]);

  const close = () => { workspacePending.current = false; onOpenChange(false); };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.defaultPrevented) return;
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); return; }
    if (event.key !== 'Tab' || !flyout.current) return;
    const items = focusableWithin(flyout.current);
    const first = items[0];
    const last = items[items.length - 1];
    if (!first || !last) { event.preventDefault(); return; }
    const active = flyout.current.ownerDocument.activeElement;
    if (event.shiftKey && (active === first || active === flyout.current)) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && active === last) { event.preventDefault(); first.focus(); }
  };

  return <div className="hq-compact-nav">
    <button ref={trigger} type="button" className="hq-compact-nav-trigger" aria-haspopup="dialog" aria-expanded={open}
      aria-controls={open ? id : undefined} onClick={() => onOpenChange(!open)}>{triggerLabel}</button>
    {open && <div className="hq-compact-nav-layer">
      <div className="hq-compact-nav-scrim" aria-hidden="true" onMouseDown={event => event.preventDefault()} onClick={close} />
      <div ref={flyout} id={id} role="dialog" aria-modal="true" aria-label={nav.label} tabIndex={-1}
        className="hq-compact-nav-flyout" onKeyDown={onKeyDown}>
        <DisclosureNav {...nav} onNavigate={(destination, node) => {
          onNavigate(destination, node);
          workspacePending.current = true;
          onOpenChange(false);
        }} />
        <button type="button" className="hq-compact-nav-close" onClick={close}>Close navigation</button>
      </div>
    </div>}
  </div>;
}
