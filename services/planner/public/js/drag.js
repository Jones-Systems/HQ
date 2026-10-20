// Pointer-based drag and drop that behaves the same for mouse, pen and touch.
// Mouse/pen drags start after a small movement; touch drags start after a
// short press-and-hold so ordinary scrolling keeps working. Escape cancels.
// Each drag type registers handlers; every drop has a non-drag alternative
// (menus, keyboard shortcuts, date editors) implemented elsewhere.

import { announce, h } from './dom.js';

const handlers = new Map();
const MOUSE_SLOP = 5;
const TOUCH_SLOP = 10;
const HOLD_MS = 320;
const EDGE = 56;
const MAX_SPEED = 22;

let pending = null;
let active = null;
let suppressClick = false;
let canStart = () => true;

export function registerDragType(type, handler) {
  handlers.set(type, handler);
}

export function isDragging() {
  return Boolean(active);
}

/** `guard()` returns null to allow a drag or a message explaining why not. */
export function initDrag(guard) {
  canStart = guard;
  document.addEventListener('pointerdown', onPointerDown);
  // Non-passive so an active touch drag can stop the page from scrolling.
  document.addEventListener('touchmove', (e) => {
    if (active || (pending && pending.touch && pending.armed)) e.preventDefault();
  }, { passive: false });
  document.addEventListener('click', (e) => {
    if (suppressClick) {
      e.preventDefault();
      e.stopPropagation();
      suppressClick = false;
    }
  }, true);
  document.addEventListener('contextmenu', (e) => {
    if (active || (pending && pending.touch)) e.preventDefault();
  });
}

function onPointerDown(e) {
  if (e.button !== 0 || active) return;
  const source = e.target.closest('[data-drag-type]');
  if (!source) return;
  if (e.target.closest('button, a, input, select, textarea, label, [data-no-drag]')
    && !e.target.closest('[data-drag-handle]')) return;
  const handler = handlers.get(source.dataset.dragType);
  if (!handler) return;
  const touch = e.pointerType === 'touch';
  pending = {
    source, handler, touch, armed: false,
    pointerId: e.pointerId, startX: e.clientX, startY: e.clientY, x: e.clientX, y: e.clientY,
    payload: { ...source.dataset },
    timer: null,
  };
  if (touch) {
    pending.timer = setTimeout(() => {
      if (!pending) return;
      pending.armed = true;
      begin();
    }, HOLD_MS);
  }
  document.addEventListener('pointermove', onPointerMove);
  document.addEventListener('pointerup', onPointerUp);
  document.addEventListener('pointercancel', onPointerCancel);
  document.addEventListener('keydown', onKeyDown, true);
}

function onPointerMove(e) {
  if (pending && e.pointerId === pending.pointerId && !active) {
    pending.x = e.clientX;
    pending.y = e.clientY;
    const dist = Math.hypot(e.clientX - pending.startX, e.clientY - pending.startY);
    if (pending.touch) {
      if (dist > TOUCH_SLOP) teardown(); // a scroll, not a hold
    } else if (dist > MOUSE_SLOP) {
      begin();
    }
    return;
  }
  if (!active || e.pointerId !== active.pointerId) return;
  e.preventDefault();
  active.x = e.clientX;
  active.y = e.clientY;
  placeGhost();
  updateTarget();
}

function begin() {
  const { source, handler, payload } = pending;
  const refusal = canStart(payload);
  if (refusal) {
    teardown();
    handler.onRefused?.(refusal);
    return;
  }
  clearTimeout(pending.timer);
  const rect = source.getBoundingClientRect();
  const ghost = source.cloneNode(true);
  ghost.removeAttribute('id');
  ghost.querySelectorAll('[id]').forEach((n) => n.removeAttribute('id'));
  ghost.classList.add('drag-ghost');
  ghost.setAttribute('aria-hidden', 'true');
  ghost.style.width = `${rect.width}px`;
  ghost.style.height = `${rect.height}px`;
  const badge = h('div', { class: 'drag-badge', hidden: true });
  const layer = h('div', { class: 'drag-layer' }, ghost, badge);
  document.body.append(layer);
  active = {
    ...pending,
    layer, ghost, badge,
    offsetX: pending.startX - rect.left,
    offsetY: pending.startY - rect.top,
    target: null,
    raf: 0,
  };
  pending = null;
  source.classList.add('drag-source');
  document.body.classList.add('is-dragging');
  if (active.touch && navigator.vibrate) navigator.vibrate(8);
  active.handler.onStart?.(active.payload, source, { touch: active.touch });
  placeGhost();
  updateTarget();
  active.raf = requestAnimationFrame(autoScroll);
  announce('Dragging. Move to a destination and release, or press Escape to cancel.');
}

function placeGhost() {
  const { ghost, badge, x, y, offsetX, offsetY } = active;
  ghost.style.transform = `translate(${Math.round(x - offsetX)}px, ${Math.round(y - offsetY)}px) rotate(1.2deg)`;
  badge.style.transform = `translate(${Math.round(x + 14)}px, ${Math.round(y + 18)}px)`;
}

function updateTarget() {
  const el = document.elementFromPoint(active.x, active.y);
  const target = el ? active.handler.findTarget(el, active.x, active.y, active.payload, active.source) : null;
  const label = active.handler.indicate(target, active.target, active.payload, active.source);
  active.target = target;
  if (label) {
    active.badge.textContent = label;
    active.badge.hidden = false;
  } else {
    active.badge.hidden = true;
  }
}

function scrollableAncestors(el) {
  const out = [];
  for (let node = el; node && node !== document.body; node = node.parentElement) {
    const style = getComputedStyle(node);
    const canX = /(auto|scroll)/.test(style.overflowX) && node.scrollWidth > node.clientWidth;
    const canY = /(auto|scroll)/.test(style.overflowY) && node.scrollHeight > node.clientHeight;
    if (canX || canY) out.push({ node, canX, canY });
  }
  return out;
}

function speed(distanceToEdge) {
  if (distanceToEdge >= EDGE) return 0;
  return Math.ceil(((EDGE - Math.max(0, distanceToEdge)) / EDGE) * MAX_SPEED);
}

function autoScroll() {
  if (!active) return;
  const { x, y } = active;
  const under = document.elementFromPoint(x, y);
  let scrolled = false;
  for (const { node, canX, canY } of under ? scrollableAncestors(under) : []) {
    const r = node.getBoundingClientRect();
    if (canX) {
      const dx = speed(x - r.left) ? -speed(x - r.left) : speed(r.right - x);
      if (dx) { node.scrollLeft += dx; scrolled = true; }
    }
    if (canY) {
      const dy = speed(y - r.top) ? -speed(y - r.top) : speed(r.bottom - y);
      if (dy) { node.scrollTop += dy; scrolled = true; }
    }
  }
  const wy = speed(y) ? -speed(y) : speed(window.innerHeight - y);
  if (wy) { window.scrollBy(0, wy); scrolled = true; }
  if (scrolled) updateTarget();
  active.raf = requestAnimationFrame(autoScroll);
}

function onPointerUp(e) {
  if (active && e.pointerId === active.pointerId) {
    const { handler, target, payload, source } = active;
    const point = { x: active.x, y: active.y };
    finish();
    suppressClick = true;
    setTimeout(() => { suppressClick = false; }, 0);
    if (target) handler.drop(target, payload, source, point);
    else announce('Drop cancelled.');
    return;
  }
  teardown();
}

function onPointerCancel() {
  if (active) {
    finish();
    announce('Drag cancelled.');
  }
  teardown();
}

function onKeyDown(e) {
  if (e.key === 'Escape' && active) {
    e.preventDefault();
    e.stopPropagation();
    finish();
    announce('Drag cancelled.');
  }
}

function finish() {
  if (!active) return;
  cancelAnimationFrame(active.raf);
  active.handler.indicate(null, active.target, active.payload, active.source);
  active.handler.onEnd?.(active.payload, active.source);
  active.source.classList.remove('drag-source');
  active.layer.remove();
  document.body.classList.remove('is-dragging');
  active = null;
  teardown();
  document.dispatchEvent(new CustomEvent('planning:dragend'));
}

function teardown() {
  if (pending) clearTimeout(pending.timer);
  pending = null;
  document.removeEventListener('pointermove', onPointerMove);
  document.removeEventListener('pointerup', onPointerUp);
  document.removeEventListener('pointercancel', onPointerCancel);
  document.removeEventListener('keydown', onKeyDown, true);
}
