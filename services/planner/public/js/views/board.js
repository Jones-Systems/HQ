// Board: manual status columns with drag across and within columns, a
// keyboard path (Alt+arrows) and a Move-to menu on every card.

import { moveItem } from '../actions.js';
import { announce, h, icon } from '../dom.js';
import { registerDragType } from '../drag.js';
import { STATUSES, STATUS_LABEL, columnItems, isLive, matchesFilters } from '../model.js';
import { anchorsForDrop, stepAnchors } from '../ordering.js';
import { getItem, state } from '../state.js';
import { itemCard } from './common.js';

const COLLAPSE_KEY = 'planning.board.collapsed';
const MOBILE_COLUMN_KEY = 'planning.board.mobileColumn';

function readCollapsed() {
  try {
    const raw = JSON.parse(localStorage.getItem(COLLAPSE_KEY) || 'null');
    return new Set(Array.isArray(raw) ? raw : ['dropped']);
  } catch {
    return new Set(['dropped']);
  }
}
const collapsed = readCollapsed();
function saveCollapsed() {
  try { localStorage.setItem(COLLAPSE_KEY, JSON.stringify([...collapsed])); } catch { /* preference only */ }
}

let mobileColumn = (() => {
  try { return localStorage.getItem(MOBILE_COLUMN_KEY) || 'inbox'; } catch { return 'inbox'; }
})();

export function showColumn(status) {
  mobileColumn = status;
  try { localStorage.setItem(MOBILE_COLUMN_KEY, status); } catch { /* preference only */ }
}

export function visibleColumn(items, status, filters) {
  return columnItems(items.filter((it) => isLive(it) && matchesFilters(it, filters)), status);
}

export function renderBoard(root, ctx) {
  const live = state.items.filter(isLive);
  const filtered = live.filter((it) => matchesFilters(it, ctx.filters));
  const isFiltered = filtered.length !== live.length;

  const tabs = h('div', { class: 'status-tabs', role: 'group', 'aria-label': 'Board column', dataset: { scrollKey: 'status-tabs' } });
  for (const s of STATUSES) {
    const count = filtered.filter((it) => it.status === s.id).length;
    const tab = h('button', {
      type: 'button', class: ['status-tab', `st-${s.id}`, mobileColumn === s.id && 'is-selected'],
      'aria-pressed': String(mobileColumn === s.id),
      dataset: { drop: 'status-chip', status: s.id, focusKey: `tab:${s.id}` },
      on: {
        click: () => {
          showColumn(s.id);
          ctx.rerender();
        },
      },
    }, h('span', { class: 'st-dot', 'aria-hidden': 'true' }), s.label, h('span', { class: 'count', text: String(count) }));
    tabs.append(tab);
  }

  const board = h('div', { class: 'board', dataset: { scrollKey: 'board' } });
  for (const s of STATUSES) {
    const items = columnItems(filtered, s.id);
    const total = live.filter((it) => it.status === s.id).length;
    const isCollapsed = collapsed.has(s.id);
    const col = h('section', {
      class: ['column', `st-${s.id}`, isCollapsed && 'is-collapsed', mobileColumn === s.id && 'is-mobile-current'],
      'aria-label': `${s.label}, ${items.length} item${items.length === 1 ? '' : 's'}`,
      dataset: { drop: 'board-col', status: s.id },
    });
    const head = h('header', { class: 'col-head' });
    const toggle = h('button', {
      type: 'button', class: 'col-toggle', 'aria-expanded': String(!isCollapsed), dataset: { focusKey: `col-toggle:${s.id}` },
      title: isCollapsed ? `Expand ${s.label}` : `Collapse ${s.label}`,
      on: {
        click: () => {
          if (collapsed.has(s.id)) collapsed.delete(s.id); else collapsed.add(s.id);
          saveCollapsed();
          ctx.rerender();
        },
      },
    }, h('span', { class: 'st-dot', 'aria-hidden': 'true' }), h('span', { class: 'col-name', text: s.label }),
    h('span', { class: 'count', text: isFiltered ? `${items.length}/${total}` : String(items.length) }));
    head.append(toggle);
    if (!isCollapsed) {
      head.append(h('button', {
        type: 'button', class: 'btn btn-icon btn-ghost col-add', 'aria-label': `New item in ${s.label}`,
        title: `New item in ${s.label}`, on: { click: () => ctx.openCapture({ status: s.id }) },
      }, icon('plus', { size: 16 })));
    }
    col.append(head);
    // A collapsed column keeps its list (hidden by CSS on desktop) so the
    // one-column phone layout can still show it; its header is hidden there.
    const list = h('div', { class: 'col-list', dataset: { colList: s.id, scrollKey: `col:${s.id}` } });
    for (const item of items) list.append(itemCard(item, ctx));
    if (!items.length) {
      list.append(h('div', { class: 'col-empty' },
        h('span', { text: isFiltered && total ? 'No matches here' : s.hint }),
        h('span', { class: 'col-empty-hint', text: 'Drop cards here' })));
    }
    col.append(list);
    if (isCollapsed) col.append(h('div', { class: 'col-collapsed-hint', text: 'Drop here' }));
    board.append(col);
  }

  root.append(h('div', { class: 'board-wrap' }, tabs, board));
  root.addEventListener('keydown', (e) => onCardKey(e, ctx));
  root.addEventListener('click', (e) => onCardClick(e, ctx));
}

function onCardClick(e, ctx) {
  const menuBtn = e.target.closest('[data-card-menu]');
  if (menuBtn) {
    e.stopPropagation();
    const item = getItem(menuBtn.dataset.cardMenu);
    if (item) ctx.openMoveMenu(item, menuBtn);
    return;
  }
  const card = e.target.closest('.card');
  if (card) ctx.openItem(card.dataset.id);
}

function visibleIdsIn(status, ctx) {
  return visibleColumn(state.items, status, ctx.filters).map((it) => it.id);
}

async function onCardKey(e, ctx) {
  const card = e.target.closest('.card');
  if (!card || e.target !== card) return;
  const item = getItem(card.dataset.id);
  if (!item) return;
  const order = STATUSES.map((s) => s.id);
  const statusIndex = order.indexOf(item.status);
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    ctx.openItem(item.id);
  } else if (e.key === 'm' || e.key === 'M') {
    e.preventDefault();
    ctx.openMoveMenu(item, card.querySelector('[data-card-menu]') || card);
  } else if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
    e.preventDefault();
    const anchors = stepAnchors(visibleIdsIn(item.status, ctx), item.id, e.key === 'ArrowUp' ? -1 : 1);
    if (!anchors) {
      announce(e.key === 'ArrowUp' ? 'Already at the top.' : 'Already at the bottom.');
      return;
    }
    ctx.keepFocus(`card:${item.id}`);
    try { await moveItem(item, item.status, anchors); } catch { /* reported */ }
  } else if (e.altKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
    e.preventDefault();
    const next = order[statusIndex + (e.key === 'ArrowLeft' ? -1 : 1)];
    if (!next) return;
    ctx.keepFocus(`card:${item.id}`);
    try { await moveItem(item, next, { place: 'top' }); } catch { /* reported */ }
  } else if (!e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
    e.preventDefault();
    const cards = [...card.parentElement.querySelectorAll('.card')];
    const i = cards.indexOf(card) + (e.key === 'ArrowUp' ? -1 : 1);
    cards[i]?.focus();
  } else if (!e.altKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
    e.preventDefault();
    const columns = [...document.querySelectorAll('.column:not(.is-collapsed)')];
    const col = card.closest('.column');
    const position = [...col.querySelectorAll('.card')].indexOf(card);
    let ci = columns.indexOf(col);
    for (;;) {
      ci += e.key === 'ArrowLeft' ? -1 : 1;
      const target = columns[ci];
      if (!target) return;
      const cards = [...target.querySelectorAll('.card')];
      if (cards.length) {
        cards[Math.min(position, cards.length - 1)].focus();
        return;
      }
    }
  }
}

// ------------------------------------------------------------- drag & drop

let placeholder = null;
let activeColumn = null;
let activeChip = null;
let currentFilters = null;

export function setBoardFilters(filters) {
  currentFilters = filters;
}

function clearIndicators() {
  activeColumn?.classList.remove('drop-active');
  activeChip?.classList.remove('drop-active');
  activeColumn = null;
  activeChip = null;
}

registerDragType('card', {
  onStart(payload, source, { touch }) {
    placeholder = h('div', { class: 'card-placeholder', 'aria-hidden': 'true' });
    placeholder.style.height = `${source.getBoundingClientRect().height}px`;
    // A touch drag keeps the pressed card in the layout (dimmed) so the
    // browser keeps delivering its touch stream; mouse drags lift it out.
    if (!touch) {
      source.after(placeholder);
      source.classList.add('drag-hidden');
    }
  },
  findTarget(el, x, y) {
    const chip = el.closest('[data-drop="status-chip"]');
    if (chip) return { kind: 'chip', status: chip.dataset.status, el: chip };
    const col = el.closest('[data-drop="board-col"]');
    if (!col) return null;
    // A hidden list (collapsed column on desktop) has no positions: drop at the top.
    const shown = col.querySelector('[data-col-list]');
    const list = shown && shown.getClientRects().length ? shown : null;
    if (!list) return { kind: 'col', status: col.dataset.status, col, list: null, index: 0, ids: [] };
    const cards = [...list.querySelectorAll('.card:not(.drag-source)')];
    let index = cards.findIndex((c) => {
      const r = c.getBoundingClientRect();
      return y < r.top + r.height / 2;
    });
    if (index < 0) index = cards.length;
    return { kind: 'col', status: col.dataset.status, col, list, index, cards, ids: cards.map((c) => c.dataset.id) };
  },
  indicate(target, prev, payload) {
    if (!target) {
      clearIndicators();
      return null;
    }
    const item = getItem(payload.id);
    if (target.kind === 'chip') {
      if (activeChip !== target.el) {
        clearIndicators();
        activeChip = target.el;
        activeChip.classList.add('drop-active');
      }
      return `Move to top of ${STATUS_LABEL[target.status]}`;
    }
    if (activeColumn !== target.col) {
      clearIndicators();
      activeColumn = target.col;
      activeColumn.classList.add('drop-active');
    }
    if (target.list && placeholder) {
      const before = target.cards[target.index];
      if (before) {
        if (placeholder.nextElementSibling !== before) target.list.insertBefore(placeholder, before);
      } else if (target.list.lastElementChild !== placeholder) {
        target.list.append(placeholder);
      }
    }
    if (!target.list) return `Move to ${STATUS_LABEL[target.status]}`;
    return item && item.status === target.status ? 'Reorder' : `Move to ${STATUS_LABEL[target.status]}`;
  },
  onEnd(payload, source) {
    clearIndicators();
    placeholder?.remove();
    placeholder = null;
    source.classList.remove('drag-hidden');
  },
  onRefused(message) {
    announce(message);
  },
  async drop(target, payload) {
    const item = getItem(payload.id);
    if (!item) return;
    let anchors;
    if (target.kind === 'chip' || !target.list) {
      if (item.status === target.status) return;
      anchors = { place: 'top' };
    } else {
      const ids = target.ids.filter((id) => id !== item.id);
      if (item.status === target.status && currentFilters) {
        const visible = visibleIdsIn(item.status, { filters: currentFilters });
        const from = visible.indexOf(item.id);
        if (from === target.index) return; // dropped where it started
      }
      anchors = anchorsForDrop(ids, target.index);
    }
    try { await moveItem(item, target.status, anchors); } catch { /* reported */ }
  },
});
