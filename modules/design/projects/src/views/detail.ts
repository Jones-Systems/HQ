import { createElement as h, useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { versionsOf, type ProjectContent, type VersionRecord, type ViewRecord } from '../content.ts';
import type { ProjectsController, ProjectsSnapshot } from '../controller.ts';
import { memoryFor } from '../session.ts';
import {
  activeKind, captureChips, captureRatio, captureSummary, count, detailFilterControls, formatCaptureDate, kindLabel, kindTabs, originLabel,
  overviewLine, shortDigest, tabAfterKey, viewportLabel, visibleViews,
} from '../view-model.ts';
import { Chevron } from './chevron.ts';
import { ActionButton } from './controls.ts';
import { AddVersionForm, AddViewForm } from './forms.ts';
import { CaptureFrame } from './frame.ts';
import { scrollParent, useFlash } from './hooks.ts';
import { useProjectsUi } from './ui.ts';

/** Where the Overview's primary actions lead. Root supplies them; without one the action says it is unavailable. */
export interface ProjectActions {
  readonly openCanvas?: () => void;
  readonly compare?: () => void;
}

const PANEL_KEY = 'hq.design.secondary.project-information.v1';
function readInformationSize(): { width: number; restored: number } {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(PANEL_KEY) ?? 'null');
    if (saved && typeof saved === 'object' && 'width' in saved && 'restored' in saved
      && typeof saved.width === 'number' && Number.isFinite(saved.width) && saved.width >= 0 && saved.width <= 560
      && typeof saved.restored === 'number' && Number.isFinite(saved.restored) && saved.restored > 0 && saved.restored <= 560) return { width: saved.width, restored: saved.restored };
  } catch { /* Display preference storage is optional. */ }
  return { width: 280, restored: 280 };
}

function InformationPanel({ empty, children }: { empty: boolean; children?: ReactNode }) {
  const [size, setSize] = useState(readInformationSize);
  const root = useRef<HTMLDivElement>(null);
  const drag = useRef<{ id: number; x: number; width: number } | null>(null);
  const id = useId();
  useLayoutEffect(() => {
    root.current?.style.setProperty('--hqp-information-width', `${size.width}px`);
    try { localStorage.setItem(PANEL_KEY, JSON.stringify(size)); } catch { /* Keep resizing available. */ }
  }, [size]);
  const resize = (value: number) => setSize(current => {
    const width = Math.max(0, Math.min(560, value));
    return { width, restored: width > 0 ? width : current.restored };
  });
  const toggle = () => setSize(current => ({ ...current, width: current.width === 0 ? current.restored : 0 }));
  const action = `${size.width === 0 ? 'Show' : 'Hide'} Project information`;
  return h('div', { className: 'hqp-information', ref: root, 'data-empty': empty },
    h('div', { className: 'hq-splitter hqp-information-grip', role: 'separator', tabIndex: 0, 'aria-label': 'Resize Project information',
      'aria-orientation': 'vertical', 'aria-valuemin': 0, 'aria-valuemax': 560, 'aria-valuenow': size.width,
      title: 'Resize Project information · drag or use arrow keys · double-click to toggle',
      onPointerDown: event => {
        if (event.button !== 0 || drag.current) return;
        event.preventDefault(); event.currentTarget.focus(); event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = { id: event.pointerId, x: event.clientX, width: size.width };
      },
      onPointerMove: event => { if (drag.current?.id === event.pointerId) resize(drag.current.width - event.clientX + drag.current.x); },
      onPointerUp: event => {
        if (drag.current?.id !== event.pointerId) return;
        const previous = drag.current?.width;
        drag.current = null;
        if (previous !== undefined && previous > 0) setSize(current => current.width === 0 ? { ...current, restored: previous } : current);
        if (event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
      },
      onPointerCancel: event => {
        if (drag.current?.id !== event.pointerId) return;
        const previous = drag.current?.width;
        drag.current = null;
        if (previous !== undefined && previous > 0) setSize(current => current.width === 0 ? { ...current, restored: previous } : current);
        if (event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
      },
      onLostPointerCapture: () => { drag.current = null; }, onDoubleClick: toggle,
      onKeyDown: event => {
        const step = event.shiftKey ? 32 : 8;
        if (event.key === 'ArrowLeft') resize(size.width + step);
        else if (event.key === 'ArrowRight') resize(size.width - step);
        else if (event.key === 'Home') resize(0);
        else if (event.key === 'End') resize(560);
        else if (event.key === 'Enter') toggle();
        else return;
        event.preventDefault();
      },
    }),
    h('button', { className: 'hqp-information-toggle hq-btn hq-btn--ghost hq-btn--sm hq-btn--icon', type: 'button', 'aria-label': action, title: action, 'aria-controls': id, 'aria-expanded': size.width > 0, onClick: toggle },
      h(Chevron, { direction: size.width > 0 ? 'right' : 'left', className: 'hqp-toggle-chevron' })),
    h('div', { className: 'hqp-information-body', hidden: size.width === 0, id }, children));
}

function VersionCard({ controller, version, view, selected, flashing, onSelect }: {
  controller: ProjectsController; version: VersionRecord; view: ViewRecord; selected: boolean; flashing: boolean; onSelect: () => void;
}) {
  const chips = captureChips(version);
  const ratio = captureRatio(version);
  return h('button', {
    type: 'button', className: `hqp-version hq-lift hq-press${flashing ? ' hq-flash' : ''}`, 'aria-pressed': selected, 'data-version': version.id,
    'aria-label': `${view.title}, version ${version.ordinal}: ${version.label}, ${chips.viewport}, ${chips.origin}`,
    onClick: onSelect,
  },
  h('span', { className: 'hqp-mat' },
    h('span', { className: 'hqp-capture', style: { aspectRatio: `${ratio.w} / ${ratio.h}`, width: `min(100%, ${Math.round(280 * ratio.w / ratio.h)}px)` } },
      h(CaptureFrame, { loader: controller.thumbnails, preview: version.thumbnail, priority: 'visible', fit: 'contain' }))),
  h('span', { className: 'hqp-version-title' }, `v${version.ordinal} · ${version.label}`,
    selected ? h('svg', { className: 'hqp-selected-mark', width: 14, height: 14, viewBox: '0 0 16 16', 'aria-hidden': true, focusable: false, fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round' },
      h('path', { d: 'm3.5 8.5 3 3 6-6.5' })) : null),
  h('span', { className: 'hqp-chips' },
    h('span', { className: 'hqp-chip' }, chips.viewport),
    chips.density ? h('span', { className: 'hqp-chip' }, chips.density) : null,
    h('span', { className: 'hqp-chip hqp-chip-origin' }, chips.origin),
    chips.revision ? h('span', { className: 'hqp-chip hqp-chip-rev', title: version.capture.sourceRevision }, `rev ${chips.revision}`) : null),
  h('span', { className: 'hqp-tile-meta' }, version.capture.route));
}

function ViewGroup({ controller, content, view, collapsed, selectedVersion, flashId, onAddVersion, onSelect }: {
  controller: ProjectsController; content: ProjectContent; view: ViewRecord; collapsed: boolean; selectedVersion: string | null; flashId: string | null;
  onAddVersion: (view: ViewRecord) => void; onSelect: (view: ViewRecord, version: VersionRecord) => void;
}) {
  const ui = useProjectsUi();
  const versions = versionsOf(content, view.id);
  const bodyId = `hqp-view-${view.id}`;
  return h('section', { className: `hqp-view${flashId === view.id ? ' hq-flash' : ''}`, 'data-view': view.id },
    h('h2', { className: 'hqp-view-title' },
      h('button', { type: 'button', 'aria-expanded': !collapsed, 'aria-controls': bodyId, onClick: () => controller.toggleView(view.id) },
        h(Chevron, { direction: 'down' }),
        view.title, h('span', { className: 'hqp-badge' }, kindLabel(view.kind)), h('span', { className: 'hqp-count' }, count(versions.length, 'version')))),
    h(ui.Presence, { show: !collapsed, motion: 'collapse', initial: false, id: bodyId },
      h('div', { className: 'hqp-versions' },
        versions.length === 0
          ? h('div', { className: 'hqp-view-empty' }, h('p', { className: 'hqp-empty' }, 'No versions yet.'),
            h('button', { type: 'button', className: 'hq-btn hq-btn--secondary hq-btn--sm', onClick: () => onAddVersion(view) }, 'Add version'))
          : versions.map((version) => h(VersionCard, {
            key: version.id, controller, version, view, selected: version.id === selectedVersion, flashing: flashId === version.id,
            onSelect: () => onSelect(view, version),
          }))))
  );
}

function Selection({ content, versionId }: { content: ProjectContent; versionId: string | null }) {
  const version = content.versions.find((candidate) => candidate.id === versionId);
  if (!version) return h('aside', { className: 'hqp-selection', 'aria-label': 'Selected version' }, h('p', { className: 'hqp-empty' }, 'Select a version to see its capture details.'));
  const view = content.views.find((candidate) => candidate.id === version.viewId);
  const { capture } = version;
  const rows: Array<[string, string]> = [
    ['View', view?.title ?? 'Unknown view'], ['Version', `v${version.ordinal} · ${version.label}`],
    ['Route', capture.route], ['Viewport', `${viewportLabel(capture.viewport)} @ ${capture.viewport.dpr}x`],
    ['Source revision', capture.sourceRevision ?? 'not recorded'], ['Capture digest', capture.captureDigest ? shortDigest(capture.captureDigest) : 'not recorded'],
    ['Origin', originLabel(version.origin)], ['Captured', formatCaptureDate(version.createdAt)],
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
        h('button', { type: 'button', className: 'hq-btn hq-btn--ghost hq-btn--sm', disabled, onClick: () => void controller.unlinkSource(link.sourceProjectId) }, 'Unlink'));
    })),
    candidates.length > 0 ? h('div', { className: 'hqp-inline-form' },
      h('select', { 'aria-label': 'Source entry to link', value: choice, disabled, onChange: (event: { target: { value: string } }) => setChoice(event.target.value) },
        h('option', { value: '' }, 'Choose a source entry…'),
        candidates.map((candidate) => h('option', { key: candidate.sourceProjectId, value: candidate.sourceProjectId },
          `${candidate.displayName} · ${candidate.hostLabel} · ${candidate.relativePath}`))),
      h('button', { type: 'button', className: 'hq-btn hq-btn--secondary hq-btn--sm', disabled: disabled || !entry, onClick: () => { if (entry) void controller.linkSource(entry).then(() => setChoice('')); } }, 'Link')) : null);
}

function KindTabs({ controller, content, selected }: { controller: ProjectsController; content: ProjectContent; selected: ReturnType<typeof activeKind> }) {
  const tabs = kindTabs(content);
  const panelId = useId();
  const idFor = (kind: string | null) => `${panelId}-tab-${kind ?? 'all'}`;
  const activeIndex = Math.max(0, tabs.findIndex((tab) => tab.kind === selected));
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const choose = (index: number) => {
    const tab = tabs[index];
    if (!tab) return;
    controller.setDetailFilters({ kinds: tab.kind ? [tab.kind] : [] });
    refs.current[index]?.focus();
  };
  return h('div', { className: 'hqp-tabs', role: 'tablist', 'aria-label': 'Show views of kind' },
    tabs.map((tab, index) => h('button', {
      key: tab.kind ?? 'all', ref: (node: HTMLButtonElement | null) => { refs.current[index] = node; }, id: idFor(tab.kind), type: 'button', role: 'tab',
      className: 'hqp-tab hq-press', 'aria-selected': index === activeIndex, tabIndex: index === activeIndex ? 0 : -1, 'aria-controls': 'hqp-captures',
      onClick: () => choose(index),
      onKeyDown: (event: KeyboardEvent) => {
        const next = tabAfterKey(event.key, index, tabs.length);
        if (next === null) return;
        event.preventDefault();
        choose(next);
      },
    }, tab.label, h('span', { className: 'hqp-tab-count' }, String(tab.count))))
  );
}

export function ProjectDetail({ controller, snapshot, actions = {}, focusTitle = false }: {
  controller: ProjectsController; snapshot: ProjectsSnapshot; actions?: ProjectActions;
  /** Move focus to the project title on arrival, so keyboard and screen reader users land on the new screen. */
  focusTitle?: boolean;
}) {
  const ui = useProjectsUi();
  const active = snapshot.active;
  const root = useRef<HTMLElement | null>(null);
  const title = useRef<HTMLHeadingElement | null>(null);
  const body = useRef<HTMLDivElement | null>(null);
  const [panel, setPanel] = useState<{ readonly kind: 'view' } | { readonly kind: 'version'; readonly viewId: string | null } | null>(null);
  const flash = useFlash();
  const memory = memoryFor(snapshot.session, active?.projectId ?? null);
  const ready = active?.status === 'ready';
  const reduced = ui.useReducedMotion();

  // The page scrolls the whole section: start at the top, then restore this project's remembered position once its content is on screen.
  useLayoutEffect(() => {
    const port = scrollParent(root.current);
    if (port) port.scrollTop = 0;
    if (focusTitle) title.current?.focus({ preventScroll: true });
    // Mount only.
  }, []);
  useLayoutEffect(() => {
    const port = scrollParent(root.current);
    if (!port || !ready) return undefined;
    port.scrollTop = memory.scroll.y;
    port.scrollLeft = memory.scroll.x;
    const remember = () => controller.setDetailScroll(port.scrollLeft, port.scrollTop);
    port.addEventListener('scroll', remember, { passive: true });
    return () => port.removeEventListener('scroll', remember);
    // Keyed by project and readiness only; later positions come from scroll events.
  }, [active?.projectId, ready]);
  useEffect(() => { if (!ready) setPanel(null); }, [ready]);

  if (!active) return null;
  const name = active.record?.name ?? 'Unresolved project';
  const content = active.status === 'ready' ? active.content : null;
  const summary = content ? captureSummary(content) : null;
  const saving = snapshot.edit.status === 'saving';

  const noCanvas = !actions.openCanvas ? "Canvas isn't available here." : !content ? "This project isn't loaded." : undefined;
  const noCompare = !actions.compare ? "Compare isn't available here." : !content ? "This project isn't loaded."
    : content.versions.length === 0 ? 'Add a version to compare.' : undefined;
  const header = h('header', { className: 'hqp-page-head' },
    h('div', { className: 'hqp-head-text' },
      h('p', { className: 'hqp-eyebrow' }, 'Project'),
      h('h1', { className: 'hqp-title', ref: title, tabIndex: -1 }, name),
      h('p', { className: 'hqp-meta' }, active.status === 'loading' ? h(ui.Skeleton, { shape: 'text', width: '16rem' }) : summary ? overviewLine(summary) : ' '),
      active.record && active.status !== 'read-only' ? null : h('div', { className: 'hqp-badges' },
        active.record ? null : h('span', { className: 'hqp-badge hqp-badge-warning' }, 'Not in registry'),
        active.status === 'read-only' ? h('span', { className: 'hqp-badge hqp-badge-warning' }, 'Read-only') : null)),
    h('div', { className: 'hqp-head-actions' },
      h('button', { type: 'button', className: 'hq-btn hq-btn--ghost hq-press', onClick: () => controller.backToGallery() }, h(Chevron, { direction: 'left', className: 'hqp-toggle-chevron' }), 'All projects'),
      h(ActionButton, { label: 'Compare', variant: 'secondary', reason: noCompare, onClick: () => actions.compare?.() }),
      h(ActionButton, { label: 'Open canvas', variant: 'primary', reason: noCanvas, onClick: () => actions.openCanvas?.() })));

  if (active.status === 'loading') {
    return h('section', { ref: root, className: 'hqp-project', 'aria-busy': true, 'data-project': active.projectId }, header,
      h('p', { className: 'hqp-status-text', role: 'status' }, 'Loading project…'),
      h('div', { className: 'hqp-skeleton-grid', 'aria-hidden': true },
        Array.from({ length: 3 }, (_, index) => h('div', { key: index, className: 'hqp-version hqp-tile-skeleton' },
          h('span', { className: 'hqp-frame hqp-frame-sample' }, h(ui.Skeleton, { shape: 'block', className: 'hqp-skeleton' })),
          h(ui.Skeleton, { shape: 'text', width: '58%' }), h(ui.Skeleton, { shape: 'text', width: '36%' })))));
  }
  if (!content) {
    return h('section', { ref: root, className: 'hqp-project', 'data-project': active.projectId }, header,
      h(ui.InlineNotice, { tone: active.status === 'error' ? 'danger' : 'info', title: active.status === 'error' ? "Couldn't open this project" : 'Opened read-only', live: 'polite' }, 'reason' in active ? active.reason : undefined));
  }

  const controls = detailFilterControls(content, memory.filters);
  const views = visibleViews(content, memory.filters);
  const selectedId = memory.selection.versionId;
  const selectionExists = content.versions.some((version) => version.id === selectedId);
  const noVersionTarget = content.views.length === 0 ? 'Add a view first.' : undefined;
  const closePanel = () => setPanel(null);
  const toggleView = () => setPanel((current) => (current?.kind === 'view' ? null : { kind: 'view' }));
  const toggleVersion = () => setPanel((current) => (current?.kind === 'version' ? null : { kind: 'version', viewId: memory.selection.viewId }));
  const reveal = (attribute: 'data-view' | 'data-version', id: string) => {
    // After the new card is on screen, bring it into view without a jump.
    requestAnimationFrame(() => {
      const node = [...(root.current?.querySelectorAll<HTMLElement>(`[${attribute}]`) ?? [])].find((candidate) => candidate.getAttribute(attribute) === id);
      if (node && typeof node.scrollIntoView === 'function') node.scrollIntoView({ block: 'nearest', behavior: reduced ? 'auto' : 'smooth' });
    });
  };

  return h('section', { ref: root, className: 'hqp-project', 'data-project': content.projectId }, header,
    h('div', { className: 'hqp-toolbar-row' },
      controls.tabs ? h(KindTabs, { controller, content, selected: activeKind(memory.filters) }) : null,
      controls.search ? h('label', { className: 'hqp-search' },
        h('input', { type: 'search', 'aria-label': 'Filter views', placeholder: 'Filter views', value: memory.filters.query, autoComplete: 'off',
          onChange: (event: { target: { value: string } }) => controller.setDetailFilters({ query: event.target.value }) })) : null,
      h('div', { className: 'hqp-head-actions hqp-add-actions' },
        h(ActionButton, { label: 'Add view', variant: 'secondary', expanded: panel?.kind === 'view', onClick: toggleView }),
        h(ActionButton, { label: 'Add version', variant: 'secondary', expanded: panel?.kind === 'version', reason: noVersionTarget, onClick: toggleVersion }))),
    h(ui.Presence, { show: panel?.kind === 'view', motion: 'collapse', initial: false, className: 'hqp-slot' },
      h('div', { className: 'hqp-slot-body' }, h(AddViewForm, {
        controller, onClose: closePanel,
        onAdded: (view) => { flash.flash(view.id); reveal('data-view', view.id); },
      }))),
    h(ui.Presence, { show: panel?.kind === 'version' && content.views.length > 0, motion: 'collapse', initial: false, className: 'hqp-slot' },
      h('div', { className: 'hqp-slot-body' }, h(AddVersionForm, {
        key: panel?.kind === 'version' ? panel.viewId ?? 'none' : 'idle', controller, content, defaultView: panel?.kind === 'version' ? panel.viewId : memory.selection.viewId, onClose: closePanel,
        onAdded: (version) => { flash.flash(version.id); reveal('data-version', version.id); },
      }))),
    h('div', { ref: body, className: 'hqp-detail-body', 'data-saving': saving },
      h('div', { className: 'hqp-captures', id: 'hqp-captures', role: controls.tabs ? 'tabpanel' : undefined, 'aria-label': 'Captures' },
        content.views.length === 0
          ? h('div', { className: 'hqp-state hqp-state-inline' }, h('h2', null, 'No views yet'),
            h('p', null, 'A view is a page or screen you collect versions of. Add one to start.'),
            h('div', { className: 'hqp-form-actions' }, h('button', { type: 'button', className: 'hq-btn hq-btn--secondary', 'aria-expanded': panel?.kind === 'view', onClick: toggleView }, 'Add view')))
          : views.length === 0
            ? h('div', { className: 'hqp-state hqp-state-inline', role: 'status' }, h('h2', null, 'No views match'),
              h('p', null, 'No views match these filters.'),
              h('div', { className: 'hqp-form-actions' }, h('button', { type: 'button', className: 'hq-btn hq-btn--secondary', onClick: () => controller.setDetailFilters({ query: '', kinds: [] }) }, 'Clear filters')))
            : views.map((view) => h(ViewGroup, {
              key: view.id, controller, content, view, collapsed: memory.collapsedViews.includes(view.id), selectedVersion: selectedId, flashId: flash.id,
              onAddVersion: (target) => setPanel({ kind: 'version', viewId: target.id }),
              onSelect: (target, version) => controller.select(target.id, version.id),
            }))),
      h(InformationPanel, { empty: !selectionExists }, h('div', { className: 'hqp-side' },
        h(Selection, { content, versionId: selectedId }),
        h(Links, { controller, snapshot, content, disabled: saving })))));
}
