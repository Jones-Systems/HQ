import { createElement as h, useEffect, useMemo, useSyncExternalStore, type ReactElement } from 'react';
import type { ProjectId } from './contract.ts';
import {
  createImportsController, EXPORT_CHOICES,
  type ImportsCapabilities, type ImportsController, type ImportsState,
} from './controller.ts';
import type { ImportDeps } from './importer.ts';

/**
 * Imports surface. Written with createElement so Node can run it without a
 * JSX transform. Styling uses the shell's CSS variables; class names are
 * section-prefixed so root can scope them.
 */

export interface ImportsActions {
  readonly choose: () => void;
  readonly apply: () => void;
  readonly undo: ImportsController['undo'];
  readonly resolve: ImportsController['resolve'];
  readonly setExportChoice: ImportsController['setExportChoice'];
  readonly setConfirmPrivate: ImportsController['setConfirmPrivate'];
  readonly exportNow: () => void;
}

const formatBytes = (bytes: number): string =>
  bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;

/** Stateless view; rendered in tests with react-dom/server. */
export function ImportsView({ state, actions }: { readonly state: ImportsState; readonly actions: ImportsActions }): ReactElement {
  const busy = state.status === 'busy';
  const summary = state.summary;
  const draftChoice = state.exportChoice === 'draft-backup';
  return h('section', { className: 'hqd-imports', 'aria-labelledby': 'hqd-imports-title', 'aria-busy': busy },
    h('header', { className: 'hqd-imports__header' },
      h('h2', { id: 'hqd-imports-title' }, 'Import and export'),
      h('p', null, 'Bring in design files you have the rights to use. Re-importing never overwrites your edits.')),

    h('div', { className: 'hqd-imports__group', role: 'group', 'aria-labelledby': 'hqd-imports-import' },
      h('h3', { id: 'hqd-imports-import' }, 'Import'),
      h('p', { className: 'hqd-imports__hint' }, 'PNG screens, MP4 or WebM recordings, HTML bundles and URLs.'),
      h('button', { type: 'button', onClick: actions.choose, disabled: busy || !state.canPick, 'aria-describedby': state.canPick ? undefined : 'hqd-imports-pick-unavailable' }, 'Choose files…'),
      state.canPick ? null : h('p', { id: 'hqd-imports-pick-unavailable', className: 'hqd-imports__unavailable' }, 'File selection is unavailable in this build.'),
      summary === null ? null : h('div', { className: 'hqd-imports__plan', 'data-status': state.status },
        h('p', { className: 'hqd-imports__headline', role: 'status' }, summary.headline),
        summary.detail === '' ? null : h('p', { className: 'hqd-imports__detail' }, summary.detail),
        summary.rows.length === 0 ? null : h('ul', { className: 'hqd-imports__rows', 'aria-label': 'Import preview' },
          summary.rows.map((row) => h('li', { key: row.key, 'data-tone': row.tone },
            h('span', { className: 'hqd-imports__key' }, row.key), h('span', { className: 'hqd-imports__action' }, row.action)))),
        summary.canApply && state.status === 'planned'
          ? h('button', { type: 'button', className: 'hqd-imports__primary', onClick: actions.apply, disabled: busy }, 'Apply import')
          : null)),

    state.conflicts.length === 0 ? null : h('div', { className: 'hqd-imports__group', role: 'group', 'aria-labelledby': 'hqd-imports-conflicts' },
      h('h3', { id: 'hqd-imports-conflicts' }, `Conflicts (${state.conflicts.length})`),
      h('ul', { className: 'hqd-imports__rows' }, state.conflicts.map((conflict) => h('li', { key: conflict.recordId, 'data-tone': 'attention' },
        h('span', { className: 'hqd-imports__key' }, conflict.label),
        h('span', { className: 'hqd-imports__buttons' },
          h('button', { type: 'button', onClick: () => void actions.resolve(conflict.recordId, 'keep-current'), disabled: busy }, 'Keep mine'),
          h('button', { type: 'button', onClick: () => void actions.resolve(conflict.recordId, 'take-incoming'), disabled: busy }, 'Take incoming')))))),

    h('div', { className: 'hqd-imports__group', role: 'group', 'aria-labelledby': 'hqd-imports-history' },
      h('h3', { id: 'hqd-imports-history' }, 'History'),
      state.history.length === 0
        ? h('p', { className: 'hqd-imports__hint' }, 'No imports yet.')
        : h('ul', { className: 'hqd-imports__rows' }, state.history.map((entry) => h('li', { key: entry.importId, 'data-undone': entry.undone },
          h('span', { className: 'hqd-imports__key' }, h('time', { dateTime: entry.importedAt }, entry.importedAt.slice(0, 16).replace('T', ' ')), ' · ', entry.label),
          entry.undone ? h('span', { className: 'hqd-imports__action' }, 'Undone')
            : h('button', { type: 'button', onClick: () => void actions.undo(entry.importId), disabled: busy, 'aria-label': `Undo import from ${entry.importedAt}` }, 'Undo'))))),

    h('fieldset', { className: 'hqd-imports__group' },
      h('legend', null, 'Backup and export'),
      EXPORT_CHOICES.map((choice) => h('label', { key: choice.kind, className: 'hqd-imports__choice' },
        h('input', { type: 'radio', name: 'hqd-imports-export', value: choice.kind, checked: state.exportChoice === choice.kind, onChange: () => actions.setExportChoice(choice.kind) }),
        h('span', null, h('strong', null, choice.label), h('small', null, choice.description)))),
      draftChoice ? h('label', { className: 'hqd-imports__confirm' },
        h('input', { type: 'checkbox', checked: state.confirmPrivate, onChange: (event: { target: { checked: boolean } }) => actions.setConfirmPrivate(event.target.checked) }),
        'I understand this file contains private drafts and will keep it private.') : null,
      h('button', { type: 'button', onClick: actions.exportNow, disabled: busy || (draftChoice && !state.confirmPrivate) }, draftChoice ? 'Create private draft backup' : 'Create bundle'),
      state.canSave ? null : h('p', { className: 'hqd-imports__unavailable' }, 'Saving to disk is unavailable in this build.'),
      state.lastExport === null ? null : h('dl', { className: 'hqd-imports__export' },
        h('dt', null, 'Digest'), h('dd', null, h('code', null, state.lastExport.digest)),
        h('dt', null, 'Size'), h('dd', null, formatBytes(state.lastExport.bytes)),
        h('dt', null, 'Included'), h('dd', null, state.lastExport.coverage.included.map((item) => `${item.namespace} (${item.documents} records, ${item.blobs} files)`).join(', ') || 'Nothing'),
        h('dt', null, 'Left out'), h('dd', null, state.lastExport.coverage.omitted.map((item) => `${item.namespace}: ${item.reason.replaceAll('-', ' ')}`).join(', ') || 'Nothing'))),

    state.message === null ? null : h('p', { className: 'hqd-imports__message', role: state.status === 'error' || state.status === 'rejected' ? 'alert' : 'status' }, state.message));
}

/** Pass referentially stable `deps`/`capabilities`; a new object recreates the controller. */
export interface ImportsPanelProps {
  readonly deps: ImportDeps;
  readonly projectId: ProjectId;
  readonly capabilities?: ImportsCapabilities;
}

/** Container: binds the controller to the view. Root injects deps/capabilities. */
export function ImportsPanel({ deps, projectId, capabilities }: ImportsPanelProps): ReactElement {
  const controller = useMemo(() => createImportsController(deps, projectId, capabilities), [deps, projectId, capabilities]);
  const state = useSyncExternalStore(controller.subscribe, controller.getState, controller.getState);
  useEffect(() => { void controller.refresh(); }, [controller]);
  const actions = useMemo<ImportsActions>(() => ({
    choose: () => void controller.choose(),
    apply: () => void controller.apply(),
    undo: controller.undo,
    resolve: controller.resolve,
    setExportChoice: controller.setExportChoice,
    setConfirmPrivate: controller.setConfirmPrivate,
    exportNow: () => void controller.exportNow(),
  }), [controller]);
  return h(ImportsView, { state, actions });
}
