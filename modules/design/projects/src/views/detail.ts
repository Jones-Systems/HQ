import { createElement as h, useLayoutEffect, useRef, useState } from 'react';
import { VIEW_KINDS, versionsOf, type ProjectContent, type VersionRecord, type ViewKind, type ViewRecord } from '../content.ts';
import type { ProjectsController, ProjectsSnapshot } from '../controller.ts';
import { memoryFor } from '../session.ts';
import { useThumbnail } from './hooks.ts';

function VersionCard({ controller, version, selected }: { controller: ProjectsController; version: VersionRecord; selected: boolean }) {
  const state = useThumbnail(controller.thumbnails, version.thumbnail, 'visible');
  const { viewport } = version.capture;
  return h('button', {
    type: 'button', className: 'hqp-version', 'aria-pressed': selected, 'data-version': version.id,
    onClick: () => controller.select(version.viewId, version.id),
  },
  state.status === 'ready'
    ? h('img', { className: 'hqp-thumb', src: state.value, alt: '', decoding: 'async', draggable: false })
    : h('div', { className: `hqp-thumb hqp-thumb-${version.thumbnail ? state.status : 'empty'}`, 'aria-hidden': true }, version.thumbnail ? '' : 'No preview'),
  h('span', { className: 'hqp-tile-title' }, `v${version.ordinal} · ${version.label}`),
  h('span', { className: 'hqp-tile-meta' }, `${version.capture.route} · ${viewport.w}×${viewport.h}@${viewport.dpr}x`));
}

function ViewSection({ controller, content, view, collapsed, selectedVersion }: {
  controller: ProjectsController; content: ProjectContent; view: ViewRecord; collapsed: boolean; selectedVersion: string | null;
}) {
  const versions = versionsOf(content, view.id);
  const bodyId = `hqp-view-${view.id}`;
  return h('section', { className: 'hqp-view', 'data-view': view.id },
    h('h3', { className: 'hqp-view-title' },
      h('button', { type: 'button', 'aria-expanded': !collapsed, 'aria-controls': bodyId, onClick: () => controller.toggleView(view.id) },
        h('span', { className: 'hqp-chevron', 'aria-hidden': true }, collapsed ? '▸' : '▾'),
        view.title, h('span', { className: 'hqp-badge' }, view.kind), h('span', { className: 'hqp-count' }, `${versions.length} versions`))),
    collapsed ? null : h('div', { id: bodyId, className: 'hqp-versions' },
      versions.length === 0 ? h('p', { className: 'hqp-empty' }, 'No versions yet.') : null,
      versions.map((version) => h(VersionCard, { key: version.id, controller, version, selected: version.id === selectedVersion }))));
}

function AddViewForm({ controller, disabled }: { controller: ProjectsController; disabled: boolean }) {
  const [title, setTitle] = useState('');
  const [kind, setKind] = useState<ViewKind>('page');
  return h('form', {
    className: 'hqp-inline-form', 'aria-label': 'Add view',
    onSubmit: (event: { preventDefault(): void }) => {
      event.preventDefault();
      if (title.trim() === '') return;
      void controller.addView(title, kind).then((result) => { if (result.ok) setTitle(''); });
    },
  },
  h('input', { 'aria-label': 'View title', placeholder: 'New view title', value: title, disabled,
    onChange: (event: { target: { value: string } }) => setTitle(event.target.value) }),
  h('select', { 'aria-label': 'View kind', value: kind, disabled, onChange: (event: { target: { value: string } }) => setKind(event.target.value as ViewKind) },
    VIEW_KINDS.map((option) => h('option', { key: option, value: option }, option))),
  h('button', { type: 'submit', disabled: disabled || title.trim() === '' }, 'Add view'));
}

function AddVersionForm({ controller, content, disabled, defaultView }: {
  controller: ProjectsController; content: ProjectContent; disabled: boolean; defaultView: string | null;
}) {
  const [view, setView] = useState(defaultView ?? content.views[0]?.id ?? '');
  const [label, setLabel] = useState('');
  const [route, setRoute] = useState('/');
  const target = content.views.find((candidate) => candidate.id === view) ?? content.views[0];
  if (!target) return null;
  return h('form', {
    className: 'hqp-inline-form', 'aria-label': 'Add version',
    onSubmit: (event: { preventDefault(): void }) => {
      event.preventDefault();
      if (label.trim() === '' || route.trim() === '') return;
      void controller.addVersion({
        viewId: target.id, label: label.trim(), origin: 'owner-created',
        capture: { route: route.trim(), viewport: { w: 1280, h: 800, dpr: 1 } },
      }).then((result) => { if (result.ok) setLabel(''); });
    },
  },
  h('select', { 'aria-label': 'Version view', value: target.id, disabled, onChange: (event: { target: { value: string } }) => setView(event.target.value) },
    content.views.map((option) => h('option', { key: option.id, value: option.id }, option.title))),
  h('input', { 'aria-label': 'Version label', placeholder: 'Version label', value: label, disabled,
    onChange: (event: { target: { value: string } }) => setLabel(event.target.value) }),
  h('input', { 'aria-label': 'Captured route', placeholder: 'Route', value: route, disabled,
    onChange: (event: { target: { value: string } }) => setRoute(event.target.value) }),
  h('button', { type: 'submit', disabled: disabled || label.trim() === '' }, 'Add version'));
}

function Selection({ content, versionId }: { content: ProjectContent; versionId: string | null }) {
  const version = content.versions.find((candidate) => candidate.id === versionId);
  if (!version) return h('aside', { className: 'hqp-selection', 'aria-label': 'Selected version' }, h('p', { className: 'hqp-empty' }, 'Select a version to see its capture binding.'));
  const view = content.views.find((candidate) => candidate.id === version.viewId);
  const { capture } = version;
  const rows: Array<[string, string]> = [
    ['View', view?.title ?? version.viewId], ['Version', `v${version.ordinal} · ${version.label}`], ['Version ID', version.id],
    ['Route', capture.route], ['Viewport', `${capture.viewport.w}×${capture.viewport.h} @ ${capture.viewport.dpr}x`],
    ['Source revision', capture.sourceRevision ?? 'not recorded'], ['Capture digest', capture.captureDigest ?? 'not recorded'],
    ['Origin', version.origin], ['Created', version.createdAt],
  ];
  return h('aside', { className: 'hqp-selection', 'aria-label': 'Selected version' },
    h('h3', null, 'Selected version'),
    h('dl', null, rows.flatMap(([term, value]) => [h('dt', { key: `${term}-t` }, term), h('dd', { key: `${term}-d` }, value)])),
    h('p', { className: 'hqp-note' }, 'Versions are immutable. Adding a version never changes earlier ones.'));
}

function Links({ controller, snapshot, content, disabled }: { controller: ProjectsController; snapshot: ProjectsSnapshot; content: ProjectContent; disabled: boolean }) {
  const [choice, setChoice] = useState('');
  const linked = new Set(content.links.map((link) => link.sourceProjectId));
  const candidates = snapshot.catalog.filter((entry) => !linked.has(entry.sourceProjectId));
  const entry = candidates.find((candidate) => candidate.sourceProjectId === choice);
  return h('section', { className: 'hqp-links', 'aria-label': 'Linked sources' },
    h('h3', null, 'Linked sources'),
    content.links.length === 0 ? h('p', { className: 'hqp-empty' }, 'No source entries linked. Linking is always explicit.') : null,
    h('ul', null, content.links.map((link) => {
      const source = snapshot.catalog.find((candidate) => candidate.sourceProjectId === link.sourceProjectId);
      return h('li', { key: link.sourceProjectId },
        h('span', null, source ? `${source.displayName} (${source.hostLabel})` : `${link.sourceProjectId} (not in current catalog)`),
        h('button', { type: 'button', disabled, onClick: () => void controller.unlinkSource(link.sourceProjectId) }, 'Unlink'));
    })),
    candidates.length > 0 ? h('div', { className: 'hqp-inline-form' },
      h('select', { 'aria-label': 'Source entry to link', value: choice, disabled, onChange: (event: { target: { value: string } }) => setChoice(event.target.value) },
        h('option', { value: '' }, 'Choose a source entry…'),
        candidates.map((candidate) => h('option', { key: candidate.sourceProjectId, value: candidate.sourceProjectId },
          `${candidate.displayName} · ${candidate.hostLabel} · ${candidate.relativePath}`))),
      h('button', { type: 'button', disabled: disabled || !entry, onClick: () => { if (entry) void controller.linkSource(entry).then(() => setChoice('')); } }, 'Link')) : null);
}

export function ProjectDetail({ controller, snapshot }: { controller: ProjectsController; snapshot: ProjectsSnapshot }) {
  const active = snapshot.active;
  const scroller = useRef<HTMLDivElement | null>(null);
  const memory = memoryFor(snapshot.session, active?.projectId ?? null);
  const ready = active?.status === 'ready';

  // Restore this project's remembered scroll once its content is on screen.
  useLayoutEffect(() => {
    const node = scroller.current;
    if (!node || !ready) return;
    node.scrollTop = memory.scroll.y;
    node.scrollLeft = memory.scroll.x;
    // Keyed by project and readiness only; later positions come from scroll events.
  }, [active?.projectId, ready]);

  if (!active) return null;
  const title = active.record?.name ?? 'Unresolved project';
  const header = h('header', { className: 'hqp-detail-header' },
    h('button', { type: 'button', className: 'hqp-back', onClick: () => controller.backToGallery() }, '← Back to Gallery'),
    h('h2', null, title),
    active.record ? null : h('span', { className: 'hqp-badge hqp-badge-warning' }, 'Not in registry'),
    active.status === 'read-only' ? h('span', { className: 'hqp-badge hqp-badge-warning' }, 'Read-only') : null);

  if (active.status === 'loading') return h('section', { className: 'hqp-detail', 'aria-busy': true }, header, h('p', { className: 'hqp-empty' }, 'Loading project…'));
  if (active.status !== 'ready') return h('section', { className: 'hqp-detail' }, header, h('p', { className: 'hqp-empty', role: 'status' }, active.reason));

  const { content } = active;
  const needle = memory.filters.query.trim().toLocaleLowerCase();
  const views = content.views.filter((view) => (memory.filters.kinds.length === 0 || memory.filters.kinds.includes(view.kind))
    && (needle === '' || view.title.toLocaleLowerCase().includes(needle)));
  const saving = snapshot.edit.status === 'saving';

  return h('section', { className: 'hqp-detail', 'data-project': content.projectId },
    header,
    h('div', { className: 'hqp-filters', role: 'search' },
      h('label', { className: 'hqp-field hqp-field-grow' }, h('span', null, 'Filter views'),
        h('input', { type: 'search', value: memory.filters.query, placeholder: 'View title',
          onChange: (event: { target: { value: string } }) => controller.setDetailFilters({ query: event.target.value }) })),
      h('fieldset', { className: 'hqp-kinds' }, h('legend', null, 'Kinds'),
        VIEW_KINDS.map((kind) => h('label', { key: kind },
          h('input', { type: 'checkbox', checked: memory.filters.kinds.includes(kind),
            onChange: () => controller.setDetailFilters({ kinds: memory.filters.kinds.includes(kind)
              ? memory.filters.kinds.filter((other) => other !== kind) : [...memory.filters.kinds, kind] }) }), kind)))),
    h('div', { className: 'hqp-forms' },
      h(AddViewForm, { controller, disabled: saving }),
      h(AddVersionForm, { controller, content, disabled: saving, defaultView: memory.selection.viewId })),
    snapshot.edit.status === 'error' ? h('p', { className: 'hqp-error', role: 'alert' }, snapshot.edit.message) : null,
    h('div', { className: 'hqp-detail-body' },
      h('div', {
        ref: scroller, className: 'hqp-detail-scroller', 'data-testid': 'detail-scroller',
        onScroll: (event: { currentTarget: HTMLDivElement }) => controller.setDetailScroll(event.currentTarget.scrollLeft, event.currentTarget.scrollTop),
      },
      content.views.length === 0 ? h('p', { className: 'hqp-empty' }, 'This project has no views yet. Add one to start collecting versions.') : null,
      views.map((view) => h(ViewSection, { key: view.id, controller, content, view,
        collapsed: memory.collapsedViews.includes(view.id), selectedVersion: memory.selection.versionId }))),
      h('div', { className: 'hqp-side' },
        h(Selection, { content, versionId: memory.selection.versionId }),
        h(Links, { controller, snapshot, content, disabled: saving }))));
}
