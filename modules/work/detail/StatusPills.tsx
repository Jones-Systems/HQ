import { useLayoutEffect, useRef } from 'react';
import { STATUSES, type Status } from '../core';

export interface StatusPillsProps {
  /** Id of the heading that names this group. */
  readonly labelledBy: string;
  readonly status: Status;
  /** Called with the chosen status. Choosing the current one is the caller's no-op. */
  readonly onSelect: (status: Status) => void;
}

/**
 * The status row of the detail panel: one pill per status, the current one pressed. A single indicator sits behind the
 * pressed pill and glides to the next one when the status changes (from here, the board, an Undo or another device),
 * so the move is seen. Its place is measured and set as custom properties through CSSOM (the app CSP has no inline
 * style attributes). The pills are the real controls, so it works the same without the glide.
 */
export function StatusPills({ labelledBy, status, onSelect }: StatusPillsProps) {
  const group = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const root = group.current;
    if (!root) return undefined;
    // The first placement is instant; the glide switches on one frame later.
    const first = !root.dataset.glide;
    if (first) root.dataset.glide = 'off';
    const place = () => {
      const pressed = root.querySelector<HTMLElement>('[aria-pressed="true"]');
      if (!pressed) return;
      root.style.setProperty('--glide-x', `${pressed.offsetLeft}px`);
      root.style.setProperty('--glide-y', `${pressed.offsetTop}px`);
      root.style.setProperty('--glide-w', `${pressed.offsetWidth}px`);
      root.style.setProperty('--glide-h', `${pressed.offsetHeight}px`);
      root.style.setProperty('--glide-hue', `var(--work-st-${status})`);
    };
    place();
    const frame = first ? requestAnimationFrame(() => { root.dataset.glide = 'on'; }) : 0;
    // Wrapping changes when the panel is resized; follow it without gliding. The first callback only reports the
    // starting size, so it must not cancel the glide a status change has just started.
    let width = root.offsetWidth;
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(() => {
      if (root.offsetWidth === width) return;
      width = root.offsetWidth;
      root.dataset.glide = 'off';
      place();
      requestAnimationFrame(() => { root.dataset.glide = 'on'; });
    }) : null;
    observer?.observe(root);
    return () => { if (frame) cancelAnimationFrame(frame); observer?.disconnect(); };
  }, [status]);

  return (
    <div className="work-pills" role="group" aria-labelledby={labelledBy} ref={group}>
      <span className="work-pill-glide" aria-hidden="true" />
      {STATUSES.map((option) => (
        <button
          key={option.id}
          type="button"
          className={`work-pill work-pill--${option.id}`}
          aria-pressed={status === option.id}
          title={option.hint}
          onClick={() => onSelect(option.id as Status)}
        >
          <span className={`wk-dot wk-dot--${option.id}`} aria-hidden="true" />{option.label}
        </button>
      ))}
    </div>
  );
}
