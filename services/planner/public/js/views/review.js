// Review: gentle prompts for a periodic look-over. Every action here is an
// explicit owner choice; nothing moves or reschedules on its own.

import { markReviewed, moveItem, patchItem, saveSettings } from '../actions.js';
import { openDateEditor } from '../date-editor.js';
import { h, icon } from '../dom.js';
import { HORIZONS, MOTIVATIONS, isLive, matchesFilters, reviewBuckets, untouchedDays } from '../model.js';
import { displayZone, getItem, state } from '../state.js';
import { emptyState } from '../ui.js';
import { dateChip, itemRow, sectionHeader } from './common.js';

export function renderReview(root, ctx) {
  const { today } = ctx;
  const items = state.items.filter((it) => isLive(it) && matchesFilters(it, ctx.filters));
  const b = reviewBuckets(items, today, state.settings);
  const total = b.inbox.length + b.overdue.length + b.passedTargets.length + b.stale.length
    + b.mismatched.length + b.unsorted.length;

  root.append(h('p', { class: 'view-hint' }, icon('review', { size: 14 }),
    'Prompts only. Nothing here changes unless you choose an action.'));
  if (!total) {
    root.append(emptyState({ iconName: 'check', title: 'All clear', message: 'Inbox is empty, no dates have slipped past, and active items are fresh.' }));
  }

  if (b.inbox.length) {
    const sec = section('Sort the Inbox', 'inbox', b.inbox.length, 'Give each capture a reason and a horizon, then move it on.');
    for (const item of b.inbox) {
      const actions = h('div', { class: 'review-actions' });
      const why = h('div', { class: 'mini-seg', role: 'group', 'aria-label': `Why for ${item.title}` });
      for (const m of MOTIVATIONS) {
        why.append(h('button', {
          type: 'button', class: ['seg', `seg-motivation-${m.id}`, item.motivation === m.id && 'is-selected'],
          'aria-pressed': String(item.motivation === m.id), text: m.label, dataset: { focusKey: `inbox-why:${item.id}:${m.id}` },
          on: { click: () => patch(item, { motivation: item.motivation === m.id ? null : m.id }, 'Why') },
        }));
      }
      const hz = h('div', { class: 'mini-seg', role: 'group', 'aria-label': `Horizon for ${item.title}` });
      for (const x of HORIZONS) {
        hz.append(h('button', {
          type: 'button', class: ['seg', item.horizon === x.id && 'is-selected'], 'aria-pressed': String(item.horizon === x.id),
          text: x.label, dataset: { focusKey: `inbox-hz:${item.id}:${x.id}` }, on: { click: () => patch(item, { horizon: item.horizon === x.id ? null : x.id }, 'Horizon') },
        }));
      }
      actions.append(why, hz,
        h('button', { type: 'button', class: 'btn btn-subtle btn-xs', 'aria-haspopup': 'menu', on: { click: (e) => ctx.openMoveMenu(getItem(item.id), e.currentTarget) } }, 'Move to…'));
      sec.append(h('div', { class: 'review-row' }, itemRow(item, ctx, { scope: 'inbox' }), actions));
    }
    root.append(sec);
  }

  if (b.overdue.length) {
    const sec = section('Overdue deadlines', 'deadline', b.overdue.length, 'Deadlines are the only dates that can be overdue.', 'is-alert');
    for (const { item, entry } of b.overdue) {
      sec.append(h('div', { class: 'review-row' }, itemRow(item, ctx, { trailing: dateChip(entry, 'overdue', today), scope: `overdue:${entry.id}` }),
        h('div', { class: 'review-actions' },
          h('button', { type: 'button', class: 'btn btn-subtle btn-xs', text: 'Reschedule', on: { click: () => openDateEditor({ item: getItem(item.id), entry, title: 'Reschedule' }) } }),
          h('button', { type: 'button', class: 'btn btn-subtle btn-xs', text: 'Mark done', on: { click: () => move(item, 'done') } }))));
    }
    root.append(sec);
  }

  if (b.passedTargets.length) {
    const sec = section('Targets that have passed', 'target', b.passedTargets.length, 'A passed target is a hint, not a failure.');
    for (const { item, entry } of b.passedTargets) {
      sec.append(h('div', { class: 'review-row' }, itemRow(item, ctx, { trailing: dateChip(entry, 'passed', today), scope: `passed:${entry.id}` }),
        h('div', { class: 'review-actions' },
          h('button', { type: 'button', class: 'btn btn-subtle btn-xs', text: 'New target', on: { click: () => openDateEditor({ item: getItem(item.id), entry, title: 'Set a new target' }) } }))));
    }
    root.append(sec);
  }

  const staleControl = h('label', { class: 'inline-setting' }, 'Quiet after ',
    h('input', {
      type: 'number', class: 'input input-xs', min: '1', max: '365', value: String(state.settings.stale_days),
      'aria-label': 'Days before an active item counts as quiet', dataset: { focusKey: 'stale-days' },
      on: {
        change: async (e) => {
          const n = Number(e.target.value);
          if (Number.isInteger(n) && n >= 1 && n <= 365) {
            try { await saveSettings({ stale_days: n }); } catch { /* reported */ }
          }
        },
      },
    }), ' days');
  if (b.stale.length) {
    const sec = section('Active but quiet', 'clock', b.stale.length, 'Active items you have not touched for a while.', '', staleControl);
    for (const item of b.stale) {
      sec.append(h('div', { class: 'review-row' }, itemRow(item, ctx, { sub: `untouched ${untouchedDays(item, today, displayZone())} days`, scope: 'stale' }),
        h('div', { class: 'review-actions' },
          h('button', { type: 'button', class: 'btn btn-subtle btn-xs', text: 'Still active', on: { click: () => markReviewed(getItem(item.id)).catch(() => {}) } }),
          h('button', { type: 'button', class: 'btn btn-subtle btn-xs', text: 'Move to…', 'aria-haspopup': 'menu', on: { click: (e) => ctx.openMoveMenu(getItem(item.id), e.currentTarget) } }))));
    }
    root.append(sec);
  } else {
    root.append(h('div', { class: 'review-setting' }, staleControl));
  }

  if (b.mismatched.length) {
    const sec = section('Horizon and date disagree', 'alert', b.mismatched.length, 'Both are valid; this is just a second look.');
    for (const { item, reason } of b.mismatched) sec.append(h('div', { class: 'review-row' }, itemRow(item, ctx, { sub: reason, scope: 'mismatch' })));
    root.append(sec);
  }

  if (b.unsorted.length) {
    const sec = section('No “why” yet', 'help', b.unsorted.length, 'Need, Want or Exploring helps the glance view.');
    for (const item of b.unsorted) {
      const why = h('div', { class: 'mini-seg', role: 'group', 'aria-label': `Why for ${item.title}` });
      for (const m of MOTIVATIONS) {
        why.append(h('button', { type: 'button', class: ['seg', `seg-motivation-${m.id}`], text: m.label, on: { click: () => patch(item, { motivation: m.id }, 'Why') } }));
      }
      sec.append(h('div', { class: 'review-row' }, itemRow(item, ctx, { scope: 'unsorted' }), h('div', { class: 'review-actions' }, why)));
    }
    root.append(sec);
  }
}

function section(title, iconName, count, hint, cls = '', action = null) {
  const sec = h('section', { class: ['review-section', cls] }, sectionHeader(title, { iconName, count, action }));
  sec.append(h('p', { class: 'section-hint', text: hint }));
  return sec;
}

async function patch(item, fields, label) {
  try { await patchItem(getItem(item.id), fields, { label }); } catch { /* reported */ }
}

async function move(item, status) {
  try { await moveItem(getItem(item.id), status, { place: 'top' }); } catch { /* reported */ }
}
