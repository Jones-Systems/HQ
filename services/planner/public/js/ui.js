// Shared UI primitives: toasts, modal dialogs, popover menus and confirms.

import { announce, button, clear, h, icon } from './dom.js';

// ------------------------------------------------------------------ toasts

const TOAST_MS = 7000;

export function toast(message, { kind = 'info', action = null, timeout = TOAST_MS, detail = null } = {}) {
  const host = document.getElementById('toasts');
  const el = h('div', { class: ['toast', `toast-${kind}`], role: kind === 'error' ? 'alert' : 'status' });
  el.append(icon(kind === 'error' ? 'alert' : kind === 'success' ? 'check' : 'clock', { className: 'toast-icon' }));
  const body = h('div', { class: 'toast-body' }, h('div', { class: 'toast-msg', text: message }));
  if (detail) body.append(h('div', { class: 'toast-detail', text: detail }));
  el.append(body);
  let timer = null;
  const close = () => {
    clearTimeout(timer);
    el.classList.add('toast-leaving');
    setTimeout(() => el.remove(), 180);
  };
  if (action) {
    el.append(button(action.label, {
      icon: action.icon || null,
      kind: 'toast-action',
      onClick: async () => {
        close();
        await action.run();
      },
    }));
  }
  el.append(button('Dismiss', { icon: 'x', iconOnly: true, kind: 'ghost', onClick: close }));
  host.append(el);
  while (host.children.length > 4) host.firstChild.remove();
  if (timeout) {
    const arm = () => { clearTimeout(timer); timer = setTimeout(close, timeout); };
    el.addEventListener('pointerenter', () => clearTimeout(timer));
    el.addEventListener('pointerleave', arm);
    el.addEventListener('focusin', () => clearTimeout(timer));
    el.addEventListener('focusout', (e) => { if (!el.contains(e.relatedTarget)) arm(); });
    arm();
  }
  if (kind !== 'error') announce(message);
  return close;
}

// ----------------------------------------------------------------- dialogs

/**
 * Modal dialog built on <dialog>, which supplies focus containment, Escape and
 * an inert background. Returns {el, body, close}.
 */
export function openDialog({ title, description = null, content = null, actions = [], size = 'md',
  onClose = null, initialFocus = null, className = '' }) {
  const dialog = h('dialog', { class: ['dialog', `dialog-${size}`, className] });
  const titleId = `dlg-${Math.random().toString(36).slice(2, 8)}`;
  dialog.setAttribute('aria-labelledby', titleId);
  const head = h('header', { class: 'dialog-head' },
    h('h2', { id: titleId, class: 'dialog-title', text: title }),
    button('Close', { icon: 'x', iconOnly: true, kind: 'ghost', onClick: () => close() }));
  const body = h('div', { class: 'dialog-body' });
  if (description) body.append(h('p', { class: 'dialog-desc', text: description }));
  if (content) body.append(content);
  dialog.append(head, body);
  if (actions.length) {
    const foot = h('footer', { class: 'dialog-foot' });
    for (const a of actions) {
      foot.append(button(a.label, {
        kind: a.kind || '', icon: a.icon || null, disabled: a.disabled,
        attrs: a.attrs || {},
        onClick: () => a.onClick({ close, dialog, body }),
      }));
    }
    dialog.append(foot);
  }
  let closed = false;
  const opener = document.activeElement;
  function close(result) {
    if (closed) return;
    closed = true;
    if (dialog.open) dialog.close();
    dialog.remove();
    if (onClose) onClose(result);
    if (opener && opener.isConnected && typeof opener.focus === 'function') opener.focus();
  }
  dialog.addEventListener('cancel', (e) => {
    e.preventDefault();
    close();
  });
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) close();
  });
  document.body.append(dialog);
  dialog.showModal();
  const focusTarget = initialFocus ? dialog.querySelector(initialFocus) : null;
  (focusTarget || dialog.querySelector('input, select, textarea, button:not(.btn-ghost)') || dialog).focus();
  return { el: dialog, body, close };
}

export function confirmDialog({ title, message, confirmLabel = 'Confirm', danger = false }) {
  return new Promise((resolve) => {
    let answered = false;
    openDialog({
      title,
      description: message,
      size: 'sm',
      actions: [
        { label: 'Cancel', onClick: ({ close }) => close() },
        {
          label: confirmLabel,
          kind: danger ? 'danger' : 'primary',
          onClick: ({ close }) => {
            answered = true;
            close();
          },
        },
      ],
      onClose: () => resolve(answered),
      initialFocus: '.dialog-foot .btn:last-child',
    });
  });
}

// ------------------------------------------------------------------- menus

let openMenuState = null;

export function closeMenu() {
  if (!openMenuState) return;
  const { el, anchor, onClose } = openMenuState;
  openMenuState = null;
  el.remove();
  document.removeEventListener('pointerdown', outsideHandler, true);
  if (anchor && anchor.isConnected) anchor.setAttribute('aria-expanded', 'false');
  if (onClose) onClose();
}

function outsideHandler(e) {
  if (openMenuState && !openMenuState.el.contains(e.target) && e.target !== openMenuState.anchor
    && !openMenuState.anchor?.contains(e.target)) closeMenu();
}

/**
 * Popover menu. `entries`: [{label, icon, hint, checked, disabled, danger,
 * onSelect} | {heading} | {separator: true}]. Position from an element or a point.
 */
export function openMenu({ anchor = null, point = null, entries, label = 'Menu', onClose = null,
  returnFocus = true }) {
  closeMenu();
  const menu = h('div', { class: 'menu', role: 'menu', 'aria-label': label, tabindex: '-1' });
  const buttons = [];
  for (const entry of entries) {
    if (entry.separator) {
      menu.append(h('div', { class: 'menu-sep', role: 'separator' }));
      continue;
    }
    if (entry.heading) {
      menu.append(h('div', { class: 'menu-heading', text: entry.heading }));
      continue;
    }
    const item = h('button', {
      type: 'button',
      class: ['menu-item', entry.danger && 'menu-danger', entry.checked && 'is-checked'],
      role: entry.checked !== undefined ? 'menuitemradio' : 'menuitem',
      'aria-checked': entry.checked !== undefined ? String(Boolean(entry.checked)) : null,
      disabled: entry.disabled,
    });
    item.append(entry.icon ? icon(entry.icon) : h('span', { class: 'menu-icon-space' }));
    item.append(h('span', { class: 'menu-label', text: entry.label }));
    if (entry.hint) item.append(h('span', { class: 'menu-hint', text: entry.hint }));
    if (entry.checked) item.append(icon('check', { className: 'menu-check' }));
    item.addEventListener('click', () => {
      const back = returnFocus ? anchor : null;
      closeMenu();
      if (back && back.isConnected) back.focus();
      entry.onSelect();
    });
    buttons.push(item);
    menu.append(item);
  }
  menu.addEventListener('keydown', (e) => {
    const enabled = buttons.filter((b) => !b.disabled);
    const index = enabled.indexOf(document.activeElement);
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      enabled[(index + 1) % enabled.length]?.focus();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      enabled[(index - 1 + enabled.length) % enabled.length]?.focus();
    } else if (e.key === 'Home') {
      e.preventDefault();
      enabled[0]?.focus();
    } else if (e.key === 'End') {
      e.preventDefault();
      enabled[enabled.length - 1]?.focus();
    } else if (e.key === 'Escape' || e.key === 'Tab') {
      e.preventDefault();
      const back = anchor;
      closeMenu();
      if (back && back.isConnected) back.focus();
    }
  });
  document.body.append(menu);
  positionFloating(menu, anchor, point);
  if (anchor) anchor.setAttribute('aria-expanded', 'true');
  openMenuState = { el: menu, anchor, onClose };
  setTimeout(() => document.addEventListener('pointerdown', outsideHandler, true), 0);
  (buttons.find((b) => b.classList.contains('is-checked') && !b.disabled) || buttons.find((b) => !b.disabled))?.focus();
  return closeMenu;
}

export function positionFloating(el, anchor, point) {
  el.style.position = 'fixed';
  el.style.visibility = 'hidden';
  el.style.left = '0px';
  el.style.top = '0px';
  const rect = el.getBoundingClientRect();
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  let x;
  let y;
  if (anchor) {
    const a = anchor.getBoundingClientRect();
    x = a.left;
    y = a.bottom + 6;
    if (y + rect.height > vh - 8) y = Math.max(8, a.top - rect.height - 6);
  } else if (point) {
    x = point.x;
    y = point.y + 8;
    if (y + rect.height > vh - 8) y = Math.max(8, point.y - rect.height - 8);
  } else {
    x = (vw - rect.width) / 2;
    y = (vh - rect.height) / 2;
  }
  x = Math.max(8, Math.min(x, vw - rect.width - 8));
  y = Math.max(8, Math.min(y, vh - rect.height - 8));
  el.style.left = `${Math.round(x)}px`;
  el.style.top = `${Math.round(y)}px`;
  el.style.visibility = '';
}

/** Small labelled field wrapper. */
export function field(labelText, control, { hint = null, id = null, className = '' } = {}) {
  const controlId = id || control.id || `f-${Math.random().toString(36).slice(2, 9)}`;
  control.id = controlId;
  const wrap = h('div', { class: ['field', className] },
    h('label', { class: 'field-label', for: controlId, text: labelText }), control);
  if (hint) {
    const hintId = `${controlId}-hint`;
    wrap.append(h('div', { class: 'field-hint', id: hintId, text: hint }));
    control.setAttribute('aria-describedby', hintId);
  }
  return wrap;
}

/** Segmented single-choice control rendered as a radio group. */
export function segmented({ name, options, value, onChange, allowNone = false, label, compact = false }) {
  const group = h('div', { class: ['segmented', compact && 'segmented-compact'], role: 'radiogroup', 'aria-label': label });
  const buttons = [];
  const all = allowNone ? [{ id: '', label: 'None' }, ...options] : options;
  // Keep one option tabbable even when the value matches none of them.
  const hasSelected = all.some((opt) => (value || '') === opt.id);
  for (const opt of all) {
    const selected = (value || '') === opt.id;
    const b = h('button', {
      type: 'button',
      role: 'radio',
      class: ['seg', selected && 'is-selected', opt.id && `seg-${name}-${opt.id}`],
      'aria-checked': String(selected),
      tabindex: selected || (!hasSelected && opt === all[0]) ? '0' : '-1',
      title: opt.hint || null,
      dataset: { value: opt.id },
    });
    if (opt.icon) b.append(icon(opt.icon, { size: 16 }));
    b.append(h('span', { text: opt.label }));
    b.addEventListener('click', () => select(opt.id, true));
    buttons.push(b);
    group.append(b);
  }
  function select(id, fire) {
    for (const b of buttons) {
      const on = b.dataset.value === id;
      b.classList.toggle('is-selected', on);
      b.setAttribute('aria-checked', String(on));
      b.tabIndex = on ? 0 : -1;
    }
    if (fire) onChange(id || null);
  }
  group.addEventListener('keydown', (e) => {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
    e.preventDefault();
    const index = buttons.indexOf(document.activeElement);
    const delta = e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 1;
    const next = buttons[(index + delta + buttons.length) % buttons.length];
    next.focus();
    select(next.dataset.value, true);
  });
  group.setValue = (id) => select(id || '', false);
  return group;
}

export function selectControl(options, value, { allowNone = false, noneLabel = 'None', id = null } = {}) {
  const sel = h('select', { class: 'select', id });
  if (allowNone) sel.append(h('option', { value: '', text: noneLabel }));
  for (const opt of options) sel.append(h('option', { value: opt.id, text: opt.label }));
  sel.value = value || '';
  return sel;
}

export function emptyState({ iconName = 'sparkle', title, message, actions = [] }) {
  const wrap = h('div', { class: 'empty' },
    h('div', { class: 'empty-icon' }, icon(iconName, { size: 28 })),
    h('h3', { class: 'empty-title', text: title }),
    message ? h('p', { class: 'empty-msg', text: message }) : null);
  if (actions.length) wrap.append(h('div', { class: 'empty-actions' }, actions));
  return wrap;
}

export { clear };
