import { useEffect, useRef, type PointerEvent } from 'react';

export interface SplitterProps {
  label: string;
  value: number;
  min: number;
  max: number;
  onResize: (value: number) => void;
  onToggle?: () => void;
  side?: 'start' | 'end';
}

/** Sizes are CSS pixels. A start-side panel grows rightward; an end-side panel grows leftward. */
export function Splitter({ label, value, min, max, onResize, onToggle, side = 'start' }: SplitterProps) {
  const drag = useRef<{ id: number; x: number; value: number; element: HTMLDivElement } | null>(null);
  const direction = side === 'start' ? 1 : -1;
  const resize = (next: number) => onResize(Math.min(max, Math.max(min, next)));
  const release = () => {
    const active = drag.current;
    drag.current = null;
    if (active?.element.hasPointerCapture?.(active.id)) active.element.releasePointerCapture(active.id);
  };
  useEffect(() => release, []);
  const start = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || drag.current) return;
    event.preventDefault();
    event.currentTarget.focus();
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { id: event.pointerId, x: event.clientX, value, element: event.currentTarget };
  };
  return <div className="hq-splitter" role="separator" tabIndex={0} aria-label={label}
    aria-orientation="vertical" aria-valuemin={min} aria-valuemax={max} aria-valuenow={value}
    aria-valuetext={`${value} pixels`} title={`${label} · drag or use arrow keys${onToggle ? ' · double-click to toggle' : ''}`}
    onPointerDown={start} onPointerMove={event => {
      const active = drag.current;
      if (active?.id === event.pointerId) resize(active.value + (event.clientX - active.x) * direction);
    }} onPointerUp={event => { if (drag.current?.id === event.pointerId) release(); }}
    onPointerCancel={event => { if (drag.current?.id === event.pointerId) release(); }}
    onLostPointerCapture={() => { drag.current = null; }} onDoubleClick={onToggle}
    onKeyDown={event => {
      const step = event.shiftKey ? 32 : 8;
      if (event.key === 'ArrowLeft') resize(value - step * direction);
      else if (event.key === 'ArrowRight') resize(value + step * direction);
      else if (event.key === 'Home') resize(min);
      else if (event.key === 'End') resize(max);
      else if (event.key === 'Enter' && onToggle) onToggle();
      else return;
      event.preventDefault();
    }} />;
}
