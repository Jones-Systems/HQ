import { useEffect, useRef, type PointerEvent as ReactPointerEvent } from 'react';
import { settleInto } from './calendar-motion';
import type { PlanCard } from './plan-week-model';

type Point = { x: number; y: number };
export function usePlanDrag(onDrop: (card: PlanCard, zone: string, point: Point) => void, preview: (card: PlanCard, zone: string) => string) {
  const active = useRef<(() => void) | null>(null);
  useEffect(() => () => active.current?.(), []);
  return (event: ReactPointerEvent<HTMLElement>, card: PlanCard) => {
    if (event.button !== 0 || (event.target as HTMLElement).closest('button, input, a, [role=menu]')) return;
    active.current?.();
    const source = event.currentTarget;
    const origin = { x: event.clientX, y: event.clientY };
    let point = origin;
    let ghost: HTMLElement | null = null;
    let zone: HTMLElement | null = null;
    let frame = 0;
    let badge: HTMLElement | null = null;
    let previousX = origin.x;
    const paint = () => {
      if (!ghost) return;
      ghost.style.setProperty('--plan-tilt', `${Math.max(-5, Math.min(5, (point.x - previousX) * 0.15))}deg`);
      previousX = point.x;
      ghost.style.setProperty('--plan-x', `${point.x + 12}px`);
      ghost.style.setProperty('--plan-y', `${point.y + 12}px`);
      const hit = document.elementFromPoint(point.x, point.y)?.closest<HTMLElement>('[data-plan-zone]') ?? null;
      if (hit !== zone) { zone?.removeAttribute('data-over'); zone = hit; zone?.setAttribute('data-over', 'true'); }
      if (badge) badge.textContent = hit?.dataset.planZone ? preview(card, hit.dataset.planZone) : 'Release to cancel';
      const board = source.closest('.wv-week-board');
      if (board) {
        const rect = board.getBoundingClientRect();
        board.scrollLeft += point.x > rect.right - 40 ? 12 : point.x < rect.left + 40 ? -12 : 0;
      }
      let scroll: HTMLElement | null = source.parentElement;
      while (scroll && !/(auto|scroll)/.test(getComputedStyle(scroll).overflowY)) scroll = scroll.parentElement;
      if (scroll) { const rect = scroll.getBoundingClientRect(); scroll.scrollTop += point.y > rect.bottom - 40 ? 12 : point.y < rect.top + 40 ? -12 : 0; }
      frame = requestAnimationFrame(paint);
    };
    const start = () => {
      if (ghost) return;
      ghost = source.cloneNode(true) as HTMLElement;
      ghost.removeAttribute('id'); ghost.removeAttribute('data-plan-item'); ghost.removeAttribute('data-hq-motion-key');
      ghost.setAttribute('aria-hidden', 'true'); ghost.inert = true;
      ghost.classList.add('wk-overlay', 'wv-plan-ghost');
      ghost.style.setProperty('--plan-width', `${source.getBoundingClientRect().width}px`);
      badge = document.createElement('p'); badge.className = 'wv-plan-drop-badge'; ghost.appendChild(badge);
      document.body.appendChild(ghost); source.setAttribute('data-drag-source', 'true'); paint();
    };
    const timer = window.setTimeout(() => { if (event.pointerType === 'touch') start(); }, 320);
    const cleanup = () => {
      clearTimeout(timer); cancelAnimationFrame(frame); ghost?.remove(); zone?.removeAttribute('data-over'); source.removeAttribute('data-drag-source');
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', cancel); window.removeEventListener('keydown', key);
      active.current = null;
    };
    const move = (e: PointerEvent) => {
      if (e.pointerId !== event.pointerId) return;
      point = { x: e.clientX, y: e.clientY };
      if (!ghost && Math.hypot(point.x - origin.x, point.y - origin.y) >= 5) {
        if (event.pointerType === 'touch') { cleanup(); return; }
        start();
      }
      if (ghost) e.preventDefault();
    };
    const up = (e: PointerEvent) => {
      if (e.pointerId !== event.pointerId) return;
      const target = zone?.dataset.planZone; const dragged = !!ghost;
      cleanup();
      if (dragged && target) onDrop(card, target, point);
      else if (dragged) settleInto(source, point);
    };
    const cancel = () => { const dragged = !!ghost; cleanup(); if (dragged) settleInto(source, point); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); cancel(); } };
    window.addEventListener('pointermove', move, { passive: false }); window.addEventListener('pointerup', up); window.addEventListener('pointercancel', cancel); window.addEventListener('keydown', key);
    active.current = cleanup;
  };
}
