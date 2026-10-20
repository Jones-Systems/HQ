import { useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Button, Splitter } from '@hq/ui';

type PanelSize = { width: number; restored: number };
const prefix = 'hq.design.secondary.';

function readSize(name: string, initial: number, max: number): PanelSize {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(`${prefix}${name}.v1`) ?? 'null');
    if (saved && typeof saved === 'object' && 'width' in saved && 'restored' in saved
      && typeof saved.width === 'number' && Number.isFinite(saved.width) && saved.width >= 0 && saved.width <= max
      && typeof saved.restored === 'number' && Number.isFinite(saved.restored) && saved.restored > 0 && saved.restored <= max) {
      return { width: saved.width, restored: saved.restored };
    }
  } catch { /* Display preferences remain optional when storage is unavailable. */ }
  return { width: initial, restored: initial };
}

export function SecondaryPanel({ name, label, initial, max = 560, side = 'end', children }: {
  name: string; label: string; initial: number; max?: number; side?: 'start' | 'end'; children?: ReactNode;
}) {
  const [size, setSize] = useState(() => readSize(name, initial, max));
  const root = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const dragWidth = useRef<number | null>(null);
  const toggle = useRef<HTMLButtonElement>(null);
  const id = useId();
  const collapsed = size.width === 0;
  useLayoutEffect(() => {
    const element = root.current;
    if (!element) return;
    element.style.setProperty('display', 'flex');
    element.style.setProperty('position', 'relative');
    element.style.setProperty('flex', '0 0 auto');
    element.style.setProperty('width', `${size.width + 6}px`);
    element.style.setProperty('min-width', '0');
    element.style.setProperty('align-self', 'stretch');
    body.current?.style.setProperty('width', `${size.width}px`);
    body.current?.style.setProperty('min-width', '0');
    body.current?.style.setProperty('padding-top', '32px');
    body.current?.style.setProperty('box-sizing', 'border-box');
    body.current?.style.setProperty('overflow', 'auto');
    if (collapsed && body.current?.contains(element.ownerDocument.activeElement)) toggle.current?.focus();
    try { localStorage.setItem(`${prefix}${name}.v1`, JSON.stringify(size)); }
    catch { /* Resizing must still work when preference storage is blocked. */ }
  }, [name, size, collapsed]);
  const resize = (value: number) => setSize(current => {
    const width = Math.max(0, Math.min(max, value));
    return { width, restored: width > 0 ? width : current.restored };
  });
  const finishDrag = () => {
    const previous = dragWidth.current;
    dragWidth.current = null;
    if (previous !== null && previous > 0) setSize(current => current.width === 0 ? { ...current, restored: previous } : current);
  };
  const flip = () => setSize(current => ({ ...current, width: current.width === 0 ? current.restored : 0 }));
  const grip = <Splitter label={`Resize ${label}`} value={size.width} min={0} max={max} side={side} onResize={resize} onToggle={flip} />;
  const action = `${collapsed ? 'Show' : 'Hide'} ${label}`;
  return <div ref={root} data-secondary-panel={name} data-collapsed={collapsed}
    onPointerDownCapture={event => {
      if (event.button === 0 && (event.target as Element).getAttribute('role') === 'separator') dragWidth.current = size.width;
    }} onPointerUpCapture={finishDrag} onPointerCancelCapture={finishDrag}>
    {side === 'end' && grip}
    <Button size="sm" variant="ghost" ref={element => {
      toggle.current = element;
      if (!element) return;
      element.style.setProperty('position', 'absolute');
      element.style.setProperty('top', '2px');
      element.style.setProperty(side === 'start' ? 'left' : 'right', '6px');
      element.style.setProperty('z-index', '2');
      element.style.setProperty('padding', '2px 6px');
    }} aria-label={action} title={action} aria-expanded={!collapsed} aria-controls={id} onClick={flip}>
      {collapsed ? (side === 'start' ? '›' : '‹') : (side === 'start' ? '‹' : '›')}
    </Button>
    <div ref={body} id={id} hidden={collapsed}>{children}</div>
    {side === 'start' && grip}
  </div>;
}

export function SecondaryBar({ name, label, children }: { name: string; label: string; children?: ReactNode }) {
  const [open, setOpen] = useState(() => {
    try { return localStorage.getItem(`${prefix}${name}.v1`) !== 'closed'; } catch { return true; }
  });
  const id = useId();
  const action = `${open ? 'Hide' : 'Show'} ${label}`;
  const change = () => setOpen(current => {
    try { localStorage.setItem(`${prefix}${name}.v1`, current ? 'closed' : 'open'); } catch { /* Keep session controls usable. */ }
    return !current;
  });
  return <div data-secondary-bar={name}>
    <Button size="sm" variant="ghost" aria-label={action} title={action} aria-expanded={open} aria-controls={id} onClick={change}>{open ? '⌃' : '⌄'}</Button>
    <div id={id} hidden={!open}>{children}</div>
  </div>;
}
