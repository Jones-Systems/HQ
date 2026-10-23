// Archive: archived items keep their status, dates and notes; restoring puts
// them back where they were. Archiving is not the same as Done.

import { setArchived } from '../actions.js';
import { h } from '../dom.js';
import { STATUS_LABEL, matchesFilters } from '../model.js';
import { state } from '../state.js';
import { emptyState } from '../ui.js';
import { itemRow } from './common.js';
import { ago } from './glance.js';

export function renderArchive(root, ctx) {
  const items = state.items.filter((it) => it.archived_at && matchesFilters(it, ctx.filters))
    .sort((a, b) => (a.archived_at < b.archived_at ? 1 : -1));
  root.append(h('p', { class: 'view-hint', text: 'Archived items are hidden everywhere else. Restoring keeps their status and position.' }));
  if (!items.length) {
    root.append(emptyState({ iconName: 'archive', title: 'Archive is empty', message: 'Archive things you no longer want to see. Nothing is deleted.' }));
    return;
  }
  const list = h('div', { class: 'archive-list' });
  for (const item of items) {
    list.append(h('div', { class: 'review-row' },
      itemRow(item, ctx, { sub: `${STATUS_LABEL[item.status]} · archived ${ago(item.archived_at)}` }),
      h('div', { class: 'review-actions' },
        h('button', {
          type: 'button', class: 'btn btn-subtle btn-xs', text: 'Restore',
          on: { click: () => setArchived(item, false).catch(() => {}) },
        }))));
  }
  root.append(list);
}
