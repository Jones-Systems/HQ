import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Button, type ButtonSize, type ButtonVariant } from './Button';
import { cx } from './cx';

export interface MenuItem {
  readonly id: string;
  readonly label: string;
  /** Called on activation. Selecting an item is the only effect; opening or moving through the menu has none. */
  readonly onSelect: () => void;
  /** Disabled items stay focusable (so they can be discovered) but never activate. */
  readonly disabled?: boolean;
  readonly tone?: 'danger';
}

export interface MenuProps {
  /** Visible trigger content. */
  readonly trigger: ReactNode;
  /** Accessible name of the trigger when its content is not text, for example an icon. */
  readonly triggerLabel?: string;
  readonly items: readonly MenuItem[];
  readonly variant?: ButtonVariant;
  readonly size?: ButtonSize;
  readonly align?: 'start' | 'end';
  readonly className?: string;
}

/**
 * Menu button (WAI-ARIA APG pattern) with roving focus: Enter/Space/ArrowDown open on the first item, ArrowUp on
 * the last; Arrow keys wrap, Home/End jump, a printable key jumps to the next matching label; Escape closes and
 * returns focus to the trigger; Tab closes and lets focus move on.
 */
export function Menu({ trigger, triggerLabel, items, variant = 'secondary', size = 'md', align = 'start', className }: MenuProps) {
  const id = useId();
  const triggerId = `${id}-trigger`;
  const menuId = `${id}-menu`;
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<(HTMLLIElement | null)[]>([]);

  useEffect(() => {
    if (open) itemRefs.current[active]?.focus();
  }, [open, active]);

  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [open]);

  const openAt = (index: number) => {
    if (items.length === 0) return;
    setActive(index);
    setOpen(true);
  };
  const close = (refocus: boolean) => {
    setOpen(false);
    if (refocus) triggerRef.current?.focus();
  };
  const activate = (item: MenuItem) => {
    if (item.disabled) return;
    close(true);
    item.onSelect();
  };

  const onTriggerKey = (event: KeyboardEvent<HTMLButtonElement>) => {
    // Enter and Space reach onClick through the native button, as do assistive-technology clicks.
    if (event.key === 'ArrowDown') { event.preventDefault(); openAt(0); }
    else if (event.key === 'ArrowUp') { event.preventDefault(); openAt(items.length - 1); }
  };

  const onMenuKey = (event: KeyboardEvent<HTMLUListElement>) => {
    const last = items.length - 1;
    switch (event.key) {
      case 'ArrowDown': event.preventDefault(); setActive((i) => (i >= last ? 0 : i + 1)); return;
      case 'ArrowUp': event.preventDefault(); setActive((i) => (i <= 0 ? last : i - 1)); return;
      case 'Home': event.preventDefault(); setActive(0); return;
      case 'End': event.preventDefault(); setActive(last); return;
      case 'Escape': event.preventDefault(); close(true); return;
      case 'Tab': close(false); return;
      case 'Enter': case ' ': {
        event.preventDefault();
        const item = items[active];
        if (item) activate(item);
        return;
      }
      default:
        if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
          const key = event.key.toLowerCase();
          for (let step = 1; step <= items.length; step += 1) {
            const index = (active + step) % items.length;
            if (items[index]!.label.toLowerCase().startsWith(key)) { setActive(index); return; }
          }
        }
    }
  };

  return (
    <div ref={rootRef} className={cx('hq-menu', className)}>
      <Button
        ref={triggerRef}
        id={triggerId}
        variant={variant}
        size={size}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={triggerLabel}
        onClick={() => (open ? close(false) : openAt(0))}
        onKeyDown={onTriggerKey}
      >
        {trigger}
      </Button>
      {open && (
        <ul id={menuId} role="menu" aria-labelledby={triggerId} className={cx('hq-menu-list', align === 'end' && 'hq-menu-list--end')} onKeyDown={onMenuKey}>
          {items.map((item, index) => (
            <li
              key={item.id}
              ref={(node) => { itemRefs.current[index] = node; }}
              role="menuitem"
              tabIndex={index === active ? 0 : -1}
              aria-disabled={item.disabled || undefined}
              className={cx('hq-menu-item', item.tone === 'danger' && 'hq-menu-item--danger')}
              onClick={() => activate(item)}
              onPointerMove={() => { if (index !== active) setActive(index); }}
            >
              {item.label}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
