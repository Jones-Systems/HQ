// Item detail panel. Choice fields save immediately with undo; text fields
// save on blur/Enter (notes also after a pause) and show their own saved
// state. If another device changed the same field, the owner's typed text is
// kept on screen and they choose which version wins.

import { ApiError } from './api.js';
import { moveItem, patchItem, setArchived } from './actions.js';
import { openDateEditor } from './date-editor.js';
import {
  KIND_HINT, KIND_LABEL, PRECISION_LABEL, dateState, formatValue, periodBounds, relativeDays, viewerLocalTime,
} from './dates.js';
import { announce, button, clear, h, icon } from './dom.js';
import { registerDragType } from './drag.js';
import {
  HORIZONS, KINDS, MOTIVATIONS, PRIORITIES, REFERENCE_KINDS, REFERENCE_LABEL, STATUSES, areasOf, isOpen,
} from './model.js';
import { api } from './api.js';
import { displayZone, getItem, isPending, state } from './state.js';
import { openMenu, segmented, selectControl, toast } from './ui.js';
import { ago } from './views/glance.js';

const NOTES_DEBOUNCE_MS = 1200;

let panel = null;
let currentId = null;
let signature = '';
const dirty = new Map(); // field key -> unsaved text value
let notesTimer = null;
let ctxRef = null;
let historyOpen = false;

export function mountDetail(el, ctx) {
  panel = el;
  ctxRef = ctx;
}

export function detailOpenId() {
  return currentId;
}

export function closeDetailPanel() {
  flushNotes();
  currentId = null;
  signature = '';
  dirty.clear();
  historyOpen = false;
  panel.hidden = true;
  panel.replaceChildren();
  document.body.classList.remove('detail-open');
}

export function renderDetail(id, ctx) {
  ctxRef = ctx;
  if (!id) {
    if (currentId) closeDetailPanel();
    return;
  }
  const item = getItem(id);
  if (!item) {
    if (state.phase === 'ready') {
      if (currentId) closeDetailPanel();
      panel.hidden = false;
      document.body.classList.add('detail-open');
      panel.replaceChildren(h('div', { class: 'detail-missing' },
        h('p', { text: 'That item is not in the planning store.' }),
        button('Close', { onClick: () => ctx.closeItem() })));
    }
    return;
  }
  const sig = `${item.id}|${item.revision}|${isPending(item.id)}|${state.connection}|${state.items.length}`;
  if (id !== currentId) {
    flushNotes();
    dirty.clear();
    historyOpen = false;
  } else if (sig === signature) {
    return;
  }
  const wasOpen = currentId === id;
  currentId = id;
  signature = sig;
  const focus = captureFocus();
  const scroll = panel.querySelector('.detail-scroll')?.scrollTop || 0;
  build(item, ctx);
  panel.hidden = false;
  document.body.classList.add('detail-open');
  if (focus) restoreFocus(focus);
  else if (!wasOpen) panel.querySelector('.detail-title')?.focus({ preventScroll: true });
  const sc = panel.querySelector('.detail-scroll');
  if (sc && wasOpen) sc.scrollTop = scroll;
}

function captureFocus() {
  const el = document.activeElement;
  if (!el || !panel.contains(el) || !el.dataset.field) return null;
  return { key: el.dataset.field, start: el.selectionStart, end: el.selectionEnd };
}

function restoreFocus({ key, start, end }) {
  const el = panel.querySelector(`[data-field="${CSS.escape(key)}"]`);
  if (!el) return;
  el.focus({ preventScroll: true });
  if (typeof start === 'number' && el.setSelectionRange) {
    try { el.setSelectionRange(start, end); } catch { /* not a text control */ }
  }
}

function setSaveState(text, kind = '') {
  const el = panel?.querySelector('.detail-save');
  if (!el) return;
  el.className = `detail-save ${kind}`;
  el.textContent = text;
}

// ----------------------------------------------------------------- saving

async function saveField(item, key, value, { label, undo = false, message = null } = {}) {
  const base = getItem(item.id);
  if (!base) return false;
  const before = base[key];
  if (JSON.stringify(before) === JSON.stringify(value)) {
    dirty.delete(key);
    return true;
  }
  setSaveState('Saving…', 'is-saving');
  try {
    await patchItem(base, { [key]: value }, { label, undo, message, report: false });
    dirty.delete(key);
    setSaveState('Saved', 'is-saved');
    return true;
  } catch (err) {
    if (err instanceof ApiError && err.code === 'revision_conflict') {
      const latest = getItem(item.id);
      // Untouched elsewhere: the conflict was another field, so re-apply ours.
      if (latest && JSON.stringify(latest[key]) === JSON.stringify(before)) {
        try {
          await patchItem(latest, { [key]: value }, { label, undo, message, report: false });
          dirty.delete(key);
          setSaveState('Saved', 'is-saved');
          return true;
        } catch (err2) {
          return failed(err2, label);
        }
      }
      showConflict(item, key, value, label);
      return false;
    }
    return failed(err, label);
  }
}

function failed(err, label) {
  const detail = err.payload?.errors?.map((e) => e.message).join(' ') || err.message;
  setSaveState('Not saved', 'is-error');
  toast(`${label}: not saved`, { kind: 'error', detail });
  return false;
}

function showConflict(item, key, mine, label) {
  dirty.set(key, typeof mine === 'string' ? mine : JSON.stringify(mine));
  setSaveState('Changed elsewhere', 'is-error');
  const host = panel.querySelector('.detail-conflict');
  if (!host) return;
  host.hidden = false;
  host.replaceChildren(
    h('div', { class: 'conflict-text' }, icon('alert', { size: 16 }),
      h('span', { text: `${label} was changed on another device. Your version is still shown.` })),
    h('div', { class: 'conflict-actions' },
      button('Keep mine', {
        kind: 'primary', onClick: async () => {
          host.hidden = true;
          await saveField(item, key, mine, { label });
          signature = '';
          renderDetail(item.id, ctxRef);
        },
      }),
      button('Use theirs', {
        onClick: () => {
          host.hidden = true;
          dirty.delete(key);
          signature = '';
          renderDetail(item.id, ctxRef);
        },
      })));
}

function flushNotes() {
  if (notesTimer) {
    clearTimeout(notesTimer);
    notesTimer = null;
    const item = currentId && getItem(currentId);
    if (item && dirty.has('notes')) saveField(item, 'notes', dirty.get('notes'), { label: 'Notes' });
  }
}

// ------------------------------------------------------------------ build

function build(item, ctx) {
  const offline = state.connection === 'offline';
  const root = h('div', { class: 'detail-inner' });

  // Header
  const head = h('header', { class: 'detail-head' },
    button('Close details', { icon: 'x', iconOnly: true, kind: 'ghost', onClick: () => ctx.closeItem(), attrs: { 'data-detail-close': '' } }),
    h('span', { class: ['detail-save', isPending(item.id) && 'is-saving'], role: 'status', text: isPending(item.id) ? 'Saving…' : offline ? 'Offline — read only' : 'All changes saved' }),
    h('div', { class: 'detail-head-actions' },
      button('More actions', { icon: 'more', iconOnly: true, kind: 'ghost', onClick: (e) => moreMenu(item, e.currentTarget) })));
  root.append(head);

  const scroll = h('div', { class: 'detail-scroll' });
  const conflict = h('div', { class: 'detail-conflict', role: 'alert', hidden: true });
  scroll.append(conflict);

  if (item.archived_at) {
    scroll.append(h('div', { class: 'banner banner-muted' }, icon('archive', { size: 16 }),
      h('span', { text: 'Archived. Hidden from the board, calendar and glance.' }),
      button('Restore', { kind: 'subtle', onClick: () => setArchived(item, false).catch(() => {}) })));
  }
  if (item.is_example) {
    scroll.append(h('div', { class: 'banner banner-example' }, icon('sparkle', { size: 16 }),
      h('span', { text: 'Example item — not one of your records. Remove all examples from Data & settings.' })));
  }

  // Title
  const title = h('textarea', {
    class: 'detail-title', rows: 1, maxLength: 200, 'aria-label': 'Title', disabled: offline,
    dataset: { field: 'title' }, value: dirty.get('title') ?? item.title, enterkeyhint: 'done',
  });
  autosize(title);
  title.addEventListener('input', () => { dirty.set('title', title.value); autosize(title); setSaveState('Unsaved', 'is-dirty'); });
  title.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); title.blur(); }
    if (e.key === 'Escape' && dirty.has('title')) { e.stopPropagation(); dirty.delete('title'); title.value = item.title; setSaveState('All changes saved'); }
  });
  title.addEventListener('blur', () => {
    if (!dirty.has('title')) return;
    const value = title.value.trim();
    if (!value) {
      toast('A title is required.', { kind: 'error' });
      title.value = item.title;
      dirty.delete('title');
      return;
    }
    saveField(item, 'title', value, { label: 'Title' });
  });
  scroll.append(h('div', { class: 'detail-title-row' }, h('span', { class: 'detail-kind' }, icon(KINDS.find((k) => k.id === item.kind)?.icon || 'idea', { size: 20 })), title));

  // Status chips
  const statusRow = h('div', { class: 'status-picker', role: 'radiogroup', 'aria-label': 'Status' });
  for (const s of STATUSES) {
    const on = item.status === s.id;
    statusRow.append(h('button', {
      type: 'button', role: 'radio', 'aria-checked': String(on), disabled: offline,
      class: ['status-option', `st-${s.id}`, on && 'is-selected'], title: s.hint,
      on: { click: () => { if (!on) moveItem(getItem(item.id), s.id, { place: 'top' }).catch(() => {}); } },
    }, h('span', { class: 'st-dot', 'aria-hidden': 'true' }), s.label));
  }
  scroll.append(group('Status', statusRow));

  const props = h('div', { class: 'prop-grid' });
  props.append(prop('Why', choice('motivation', MOTIVATIONS, item, offline)));
  props.append(prop('Horizon', choice('horizon', HORIZONS, item, offline)));
  props.append(prop('Kind', choice('kind', KINDS, item, offline, { required: true })));
  props.append(prop('Priority', choice('priority', PRIORITIES, item, offline)));
  const area = h('input', {
    type: 'text', class: 'input', maxLength: 40, list: 'area-options', disabled: offline, placeholder: 'e.g. Home, Health, Work',
    dataset: { field: 'area' }, value: dirty.get('area') ?? (item.area || ''), 'aria-label': 'Area', autocomplete: 'off',
  });
  ensureAreaList();
  area.addEventListener('input', () => { dirty.set('area', area.value); });
  area.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); area.blur(); } });
  area.addEventListener('change', () => saveField(item, 'area', area.value.trim() || null, { label: 'Area', undo: true }));
  props.append(prop('Area', area));
  scroll.append(props);

  // Dates
  const dates = h('section', { class: 'detail-section' });
  dates.append(sectionHead('Dates', 'calendar', button('Add date', {
    icon: 'plus', kind: 'subtle', disabled: offline, onClick: () => openDateEditor({ item: getItem(item.id) }),
  })));
  if (!item.dates.length) {
    dates.append(h('p', { class: 'muted small', text: 'No dates. That is fine — unscheduled is a normal state.' }));
  }
  const zone = displayZone();
  const sorted = [...item.dates].sort((a, b) => (periodBounds(a.precision, a.value)?.[0] || '').localeCompare(periodBounds(b.precision, b.value)?.[0] || ''));
  for (const entry of sorted) {
    const st = dateState(entry, ctx.today, isOpen(item));
    const bounds = periodBounds(entry.precision, entry.value);
    const rel = entry.precision === 'day' && bounds ? relativeDays(ctx.today, bounds[0]) : st === 'current' ? 'this period' : '';
    const localText = viewerLocalTime(entry, zone);
    const row = h('div', { class: ['date-row', `dk-${entry.kind}`, `ds-${st}`] },
      h('span', { class: 'date-kind', title: KIND_HINT[entry.kind] }, icon(entry.kind, { size: 16 }), KIND_LABEL[entry.kind]),
      h('div', { class: 'date-main' },
        h('div', { class: 'date-value', text: formatValue(entry, ctx.today) }),
        h('div', { class: 'date-sub' },
          h('span', { text: [PRECISION_LABEL[entry.precision], entry.tz, rel, st === 'overdue' ? 'overdue' : st === 'passed' && entry.kind === 'target' ? 'target passed' : ''].filter(Boolean).join(' · ') }),
          localText ? h('span', { text: ` · ${localText} for you` }) : ''),
        entry.note ? h('div', { class: 'date-note', text: entry.note }) : ''),
      button('Edit date', {
        icon: 'edit', iconOnly: true, kind: 'ghost', disabled: offline,
        onClick: () => openDateEditor({ item: getItem(item.id), entry }),
      }));
    dates.append(row);
  }
  scroll.append(dates);

  // Next steps
  scroll.append(stepsSection(item, offline));

  // Notes
  const notes = h('textarea', {
    class: 'input notes', rows: 5, maxLength: 20000, disabled: offline, placeholder: 'Background, ideas, links in prose…',
    dataset: { field: 'notes' }, value: dirty.get('notes') ?? item.notes, 'aria-label': 'Notes',
  });
  autosize(notes, 120);
  notes.addEventListener('input', () => {
    dirty.set('notes', notes.value);
    autosize(notes, 120);
    setSaveState('Unsaved', 'is-dirty');
    clearTimeout(notesTimer);
    notesTimer = setTimeout(() => {
      notesTimer = null;
      if (dirty.has('notes')) saveField(getItem(item.id) || item, 'notes', dirty.get('notes'), { label: 'Notes' });
    }, NOTES_DEBOUNCE_MS);
  });
  notes.addEventListener('blur', () => flushNotes());
  scroll.append(h('section', { class: 'detail-section' }, sectionHead('Notes', 'note'), notes));

  // References
  scroll.append(referencesSection(item, offline));

  // Meta & history
  const meta = h('section', { class: 'detail-section detail-meta' });
  meta.append(h('p', { class: 'muted small', text: `Created ${ago(item.created_at)} · updated ${ago(item.updated_at)} · revision ${item.revision}` }));
  const histBtn = button(historyOpen ? 'Hide history' : 'Show history', { icon: 'history', kind: 'ghost', attrs: { 'aria-expanded': String(historyOpen) } });
  const histHost = h('div', { class: 'history', hidden: !historyOpen });
  histBtn.addEventListener('click', () => {
    historyOpen = !historyOpen;
    histHost.hidden = !historyOpen;
    histBtn.setAttribute('aria-expanded', String(historyOpen));
    histBtn.querySelector('span').textContent = historyOpen ? 'Hide history' : 'Show history';
    if (historyOpen) loadHistory(item.id, histHost);
  });
  if (historyOpen) loadHistory(item.id, histHost);
  meta.append(histBtn, histHost);
  scroll.append(meta);

  root.append(scroll);
  panel.replaceChildren(root);
}

function ensureAreaList() {
  let list = document.getElementById('area-options');
  if (!list) {
    list = h('datalist', { id: 'area-options' });
    document.body.append(list);
  }
  clear(list);
  for (const a of areasOf(state.items)) list.append(h('option', { value: a }));
}

const CHOICE_LABEL = { motivation: 'Why', horizon: 'Horizon', kind: 'Kind', priority: 'Priority' };

function choice(key, options, item, offline, { required = false } = {}) {
  const control = segmented({
    name: key, label: CHOICE_LABEL[key], compact: true, allowNone: !required,
    options: options.map((o) => ({ id: o.id, label: o.label, hint: o.hint, icon: key === 'kind' ? o.icon : null })),
    value: item[key],
    onChange: (v) => saveField(item, key, v, { label: CHOICE_LABEL[key], undo: true }),
  });
  if (offline) control.querySelectorAll('button').forEach((b) => { b.disabled = true; });
  return control;
}

function prop(label, control) {
  return h('div', { class: 'prop' }, h('span', { class: 'prop-label', text: label }), control);
}

function group(label, control) {
  return h('div', { class: 'prop prop-wide' }, h('span', { class: 'prop-label', text: label }), control);
}

function sectionHead(title, iconName, action = null) {
  return h('div', { class: 'detail-section-head' },
    h('h3', null, icon(iconName, { size: 16 }), h('span', { text: title })), action || '');
}

function autosize(el, min = 0) {
  requestAnimationFrame(() => {
    el.style.height = 'auto';
    el.style.height = `${Math.max(min, el.scrollHeight)}px`;
  });
}

// ------------------------------------------------------------- next steps

function stepsSection(item, offline) {
  const sec = h('section', { class: 'detail-section' });
  const done = item.next_steps.filter((s) => s.done).length;
  sec.append(sectionHead('Next steps', 'steps', item.next_steps.length
    ? h('span', { class: 'muted small', text: `${done} of ${item.next_steps.length} done` }) : null));
  const list = h('ol', { class: 'steps-list', dataset: { stepList: item.id } });
  item.next_steps.forEach((step, index) => {
    const key = `step:${step.id}`;
    const check = h('input', {
      type: 'checkbox', checked: step.done, disabled: offline, 'aria-label': `Done: ${step.text}`,
      on: {
        change: () => {
          const steps = getItem(item.id).next_steps.map((s) => (s.id === step.id ? { ...s, done: check.checked } : s));
          saveField(item, 'next_steps', steps, { label: 'Next step' });
        },
      },
    });
    const text = h('input', {
      type: 'text', class: ['step-text', step.done && 'is-done'], value: dirty.get(key) ?? step.text, maxLength: 300,
      disabled: offline, dataset: { field: key }, 'aria-label': `Step ${index + 1}`,
    });
    text.addEventListener('input', () => dirty.set(key, text.value));
    text.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); text.blur(); }
    });
    text.addEventListener('blur', () => {
      if (!dirty.has(key)) return;
      const value = text.value.trim();
      dirty.delete(key);
      const current = getItem(item.id).next_steps;
      const steps = value ? current.map((s) => (s.id === step.id ? { ...s, text: value } : s)) : current.filter((s) => s.id !== step.id);
      saveField(item, 'next_steps', steps, { label: 'Next step' });
    });
    const handle = h('span', { class: 'step-grip', title: 'Drag to reorder, or Alt+↑/↓', 'aria-hidden': 'true' }, icon('grip', { size: 14 }));
    const li = h('li', {
      class: 'step', dataset: { stepId: step.id, ...(offline ? {} : { dragType: 'step', id: item.id }) },
    }, handle, check, text,
    button('Remove step', {
      icon: 'x', iconOnly: true, kind: 'ghost', disabled: offline,
      onClick: () => {
        const steps = getItem(item.id).next_steps.filter((s) => s.id !== step.id);
        saveField(item, 'next_steps', steps, { label: 'Remove step', undo: true, message: 'Step removed.' });
      },
    }));
    text.addEventListener('keydown', (e) => {
      if (!e.altKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
      e.preventDefault();
      reorderStep(item, step.id, e.key === 'ArrowUp' ? -1 : 1);
    });
    list.append(li);
  });
  sec.append(list);
  const add = h('input', {
    type: 'text', class: 'input', maxLength: 300, placeholder: 'Add a next step and press Enter', disabled: offline,
    dataset: { field: 'new-step' }, value: dirty.get('new-step') ?? '', 'aria-label': 'New next step',
  });
  add.addEventListener('input', () => dirty.set('new-step', add.value));
  add.addEventListener('keydown', async (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const value = add.value.trim();
    if (!value) return;
    const steps = [...getItem(item.id).next_steps, { text: value, done: false }];
    dirty.delete('new-step');
    add.value = '';
    const ok = await saveField(item, 'next_steps', steps, { label: 'Next step' });
    if (!ok) { add.value = value; dirty.set('new-step', value); }
  });
  sec.append(add);
  return sec;
}

async function reorderStep(item, stepId, delta) {
  const steps = [...getItem(item.id).next_steps];
  const i = steps.findIndex((s) => s.id === stepId);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= steps.length) return;
  [steps[i], steps[j]] = [steps[j], steps[i]];
  await saveField(item, 'next_steps', steps, { label: 'Reorder steps', undo: true, message: 'Steps reordered.' });
  announce(`Step moved to position ${j + 1}.`);
}

let stepIndicator = null;
registerDragType('step', {
  findTarget(el, x, y, payload, source) {
    const list = source.parentElement;
    const row = el.closest('.step');
    if (!row || row.parentElement !== list) {
      if (!list.contains(el)) return null;
    }
    const rows = [...list.querySelectorAll('.step')].filter((r) => r !== source);
    let index = rows.findIndex((r) => {
      const rect = r.getBoundingClientRect();
      return y < rect.top + rect.height / 2;
    });
    if (index < 0) index = rows.length;
    return { list, rows, index };
  },
  indicate(target) {
    stepIndicator?.classList.remove('drop-before', 'drop-after');
    stepIndicator = null;
    if (!target) return null;
    const row = target.rows[target.index] || target.rows[target.rows.length - 1];
    if (row) {
      stepIndicator = row;
      row.classList.add(target.rows[target.index] ? 'drop-before' : 'drop-after');
    }
    return 'Reorder step';
  },
  onEnd() {
    stepIndicator?.classList.remove('drop-before', 'drop-after');
    stepIndicator = null;
  },
  drop(target, payload, source) {
    const item = getItem(payload.id);
    if (!item) return;
    const moving = source.dataset.stepId;
    const steps = item.next_steps.filter((s) => s.id !== moving);
    const order = target.rows.map((r) => r.dataset.stepId);
    const beforeId = order[target.index];
    const insertAt = beforeId ? steps.findIndex((s) => s.id === beforeId) : steps.length;
    steps.splice(insertAt, 0, item.next_steps.find((s) => s.id === moving));
    if (steps.map((s) => s.id).join() === item.next_steps.map((s) => s.id).join()) return;
    saveField(item, 'next_steps', steps, { label: 'Reorder steps', undo: true, message: 'Steps reordered.' });
  },
});

// ------------------------------------------------------------- references

function referencesSection(item, offline) {
  const sec = h('section', { class: 'detail-section' });
  sec.append(sectionHead('References', 'link'));
  sec.append(h('p', { class: 'muted small', text: 'Static links and labels for context. They never start or change anything elsewhere.' }));
  const list = h('ul', { class: 'refs' });
  for (const ref of item.references) {
    const label = ref.url
      ? h('a', { href: ref.url, target: '_blank', rel: 'noopener noreferrer', class: 'ref-link' }, h('span', { text: ref.label }), icon('external', { size: 13 }))
      : h('span', { class: 'ref-label', text: ref.label });
    list.append(h('li', { class: 'ref' },
      h('span', { class: 'ref-kind', text: REFERENCE_LABEL[ref.kind] || ref.kind }), label,
      ref.url && ref.url !== ref.label ? h('span', { class: 'ref-url', text: new URL(ref.url).host }) : '',
      button('Remove reference', {
        icon: 'x', iconOnly: true, kind: 'ghost', disabled: offline,
        onClick: () => saveField(item, 'references', getItem(item.id).references.filter((r) => r.id !== ref.id), { label: 'Remove reference', undo: true, message: 'Reference removed.' }),
      })));
  }
  sec.append(list);
  const kind = selectControl(REFERENCE_KINDS, 'url');
  kind.setAttribute('aria-label', 'Reference kind');
  const label = h('input', { type: 'text', class: 'input', placeholder: 'Label', maxLength: 200, 'aria-label': 'Reference label', disabled: offline });
  const url = h('input', { type: 'url', class: 'input', placeholder: 'https://… (optional)', maxLength: 2000, 'aria-label': 'Reference link', disabled: offline, inputmode: 'url' });
  const add = button('Add', {
    icon: 'plus', kind: 'subtle', disabled: offline,
    onClick: async () => {
      const l = label.value.trim();
      const u = url.value.trim();
      if (!l && !u) { label.focus(); return; }
      if (u && !/^https?:\/\//i.test(u)) { toast('Links must start with http:// or https://', { kind: 'error' }); url.focus(); return; }
      const refs = [...getItem(item.id).references, { kind: kind.value, label: l || u, url: u }];
      const ok = await saveField(item, 'references', refs, { label: 'Reference' });
      if (ok) { label.value = ''; url.value = ''; }
    },
  });
  sec.append(h('div', { class: 'ref-form' }, kind, label, url, add));
  return sec;
}

// ---------------------------------------------------------------- history

async function loadHistory(id, host) {
  host.replaceChildren(h('p', { class: 'muted small', text: 'Loading history…' }));
  try {
    const { history } = await api.history(id);
    host.replaceChildren();
    if (!history.length) host.append(h('p', { class: 'muted small', text: 'No history yet.' }));
    const list = h('ol', { class: 'history-list' });
    for (const entry of history) list.append(h('li', null, h('span', { class: 'history-when', text: ago(entry.at) }), h('span', { text: describeHistory(entry) })));
    host.append(list);
  } catch (err) {
    host.replaceChildren(h('p', { class: 'form-error', text: `History unavailable: ${err.message}` }));
  }
}

const STATUS_NAMES = Object.fromEntries(STATUSES.map((s) => [s.id, s.label]));
function describeHistory(entry) {
  const d = entry.detail || {};
  switch (entry.action) {
    case 'created': return d.example ? 'Example item created' : 'Created';
    case 'moved': return `Moved ${STATUS_NAMES[d.changes?.status?.[0]] || ''} → ${STATUS_NAMES[d.changes?.status?.[1]] || ''}`;
    case 'reordered': return 'Reordered on the board';
    case 'archived': return 'Archived';
    case 'restored': return 'Restored from archive';
    case 'reviewed': return 'Marked as reviewed';
    case 'imported': return 'Imported';
    default: {
      const parts = [];
      for (const [field, [, to]] of Object.entries(d.changes || {})) {
        parts.push(`${field === 'motivation' ? 'why' : field} → ${field === 'status' ? STATUS_NAMES[to] : (to ?? 'none')}`);
      }
      const others = (d.fields || []).filter((f) => !(f in (d.changes || {})) && f !== 'dates');
      if (others.length) parts.push(`edited ${others.map((f) => f.replace('_', ' ')).join(', ')}`);
      if (d.dates?.length) parts.push(...d.dates);
      return parts.join('; ') || 'Updated';
    }
  }
}

// ------------------------------------------------------------------- menu

function moreMenu(item, anchor) {
  const latest = getItem(item.id);
  openMenu({
    anchor,
    label: 'Item actions',
    entries: [
      {
        label: 'Copy link to this item', icon: 'link',
        onSelect: async () => {
          const url = `${location.origin}${location.pathname}#/${ctxRef.view()}?item=${encodeURIComponent(item.id)}`;
          try { await navigator.clipboard.writeText(url); toast('Link copied.', { timeout: 2500 }); } catch { toast(url, { timeout: 10000 }); }
        },
      },
      { label: 'Add date…', icon: 'calendar', disabled: state.connection === 'offline', onSelect: () => openDateEditor({ item: getItem(item.id) }) },
      { separator: true },
      latest.archived_at
        ? { label: 'Restore from archive', icon: 'restore', onSelect: () => setArchived(getItem(item.id), false).catch(() => {}) }
        : {
          label: 'Archive', icon: 'archive', disabled: state.connection === 'offline',
          onSelect: async () => {
            try {
              await setArchived(getItem(item.id), true);
              ctxRef.closeItem();
            } catch { /* reported */ }
          },
        },
    ],
  });
}
