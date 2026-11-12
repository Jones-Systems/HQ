import { useLayoutEffect, useRef, type KeyboardEvent } from 'react';
import { DOMAIN_IDS, type DomainId } from '@hq/contracts';
import { DOMAIN_LABELS } from '../domain-metadata';
import { ShellIcon } from './icons';

export interface RailProps {
  readonly current: DomainId;
  readonly settingsOpen: boolean;
  /** Icon over label at the 64 px width; icon beside label when dragged wider. */
  readonly compact: boolean;
  readonly onNavigate: (domain: DomainId) => void;
  readonly onOpenSettings: (opener: HTMLElement) => void;
}

const MOVES: Readonly<Record<string, (index: number, count: number) => number>> = {
  ArrowDown: (index, count) => (index + 1) % count,
  ArrowUp: (index, count) => (index - 1 + count) % count,
  Home: () => 0,
  End: (_index, count) => count - 1,
};

/**
 * Primary navigation. The domains are one tab stop (arrow keys, Home and End move between them; Enter or Space
 * opens one), Settings sits at the foot. One selection pill slides to the selected item; the selected label is
 * also bolder, so selection never depends on colour alone.
 */
export function Rail({ current, settingsOpen, compact, onNavigate, onOpenSettings }: RailProps) {
  const root = useRef<HTMLElement>(null);
  const selected = settingsOpen ? 'settings' : current;

  useLayoutEffect(() => {
    const rail = root.current;
    if (!rail) return;
    const place = () => {
      const item = rail.querySelector<HTMLElement>(`[data-rail-item="${selected}"]`);
      if (!item) return;
      rail.style.setProperty('--shell-pill-x', `${item.offsetLeft}px`);
      rail.style.setProperty('--shell-pill-y', `${item.offsetTop}px`);
      rail.style.setProperty('--shell-pill-w', `${item.offsetWidth}px`);
      rail.style.setProperty('--shell-pill-h', `${item.offsetHeight}px`);
    };
    place();
    // The first placement appears in place; later ones slide.
    const ready = window.requestAnimationFrame(() => { rail.dataset.pillReady = ''; });
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(place) : null;
    observer?.observe(rail);
    return () => { window.cancelAnimationFrame(ready); observer?.disconnect(); };
  }, [selected, compact]);

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    const move = MOVES[event.key];
    if (!move || event.altKey || event.ctrlKey || event.metaKey) return;
    const items = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('.shell-rail-item')];
    const index = items.indexOf(document.activeElement as HTMLButtonElement);
    if (index < 0) return;
    event.preventDefault();
    items[move(index, items.length)]!.focus();
  };

  return (
    <aside ref={root} className={compact ? 'shell-rail is-compact' : 'shell-rail'} aria-label="HQ navigation">
      <span className="shell-rail-pill" aria-hidden="true" />
      <nav aria-label="Domains" onKeyDown={onKeyDown}>
        {DOMAIN_IDS.map((domain) => (
          <button key={domain} type="button" className="shell-rail-item" data-rail-item={domain} title={DOMAIN_LABELS[domain]}
            aria-current={selected === domain ? 'page' : undefined} tabIndex={domain === current ? 0 : -1}
            onClick={() => onNavigate(domain)}>
            <ShellIcon name={domain} />
            <span className="shell-rail-label">{DOMAIN_LABELS[domain]}</span>
          </button>
        ))}
      </nav>
      <button type="button" className="shell-rail-item shell-rail-settings" data-rail-item="settings" title="Settings"
        aria-label="Settings" aria-current={settingsOpen ? 'page' : undefined} onClick={(event) => onOpenSettings(event.currentTarget)}>
        <ShellIcon name="settings" />
        <span className="shell-rail-label">Settings</span>
      </button>
    </aside>
  );
}
