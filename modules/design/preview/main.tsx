/**
 * HQ Design integration preview. A LABELLED FAKE HQ shell hosts T14's real
 * Design chrome (createDesignDomain) with preview-local descriptors that mount
 * each section's real UI entry point over its own labelled fakes and synthetic
 * seeds. No transport, preload bridge, credential, host-refresh adapter or
 * durable store is registered. Hooks on window.__hqdPreview exist for runtime
 * evidence only.
 */
import { StrictMode, useState, useSyncExternalStore } from 'react';
import { createRoot } from 'react-dom/client';
import type { DomainId, ModulePort } from '@hq/contracts';
import type { UiStatePort } from '../ui/contract.ts';
import { createDesignDomain } from '../ui/src/domain.tsx';
import { createFakeShell } from '../ui/src/fakes.ts';
import { buildRegistry } from '../ui/src/registry.ts';
import type { SectionView } from '../ui/src/view/SectionOutlet.tsx';
import { observeEgress, type EgressClass } from './egress.ts';
import { PREVIEW_PROJECTS } from './seeds.ts';
import './shell.css';

declare const __HQD_CANDIDATE__: string;

const egress = observeEgress(window);
const registry = buildRegistry<SectionView>(import.meta.glob('./sections/*/design-module.ts', { eager: true }));

const writes: string[] = [];
const storage: UiStatePort = {
  getItem: (key) => window.localStorage.getItem(key),
  setItem: (key, value) => { writes.push(key); window.localStorage.setItem(key, value); },
};

const initialAppearance = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
const shell = createFakeShell(PREVIEW_PROJECTS[0]!, initialAppearance);
const projectRequests: string[] = [];
const domain = createDesignDomain({
  registry, storage, projects: PREVIEW_PROJECTS,
  shell: {
    ...shell,
    // Design asks only after its own confirmation prompt; this fake shell then applies it.
    requestProjectContext: (projectId) => {
      projectRequests.push(projectId);
      const project = PREVIEW_PROJECTS.find((item) => item.id === projectId);
      if (project) shell.setContext(project);
    },
  },
});

let tick = 0;
const listeners = new Set<() => void>();
const rerender = () => {
  tick += 1;
  document.documentElement.dataset.theme = shell.getSnapshot().appearance;
  for (const listener of [...listeners]) listener();
};
shell.subscribe(rerender);
egress.subscribe(rerender);
shell.onDomainChange((from) => { if (from === 'design') domain.deactivate(); });
document.documentElement.dataset.theme = initialAppearance;

/** The fourteen assembled cones and how this preview uses each. */
const CONES: readonly (readonly [string, string, string])[] = [
  ['T14', 'modules/design/ui', 'chrome: real createDesignDomain'],
  ['T2', 'modules/design/projects', 'section'], ['T15', 'modules/design/discovery', 'section'],
  ['T8', 'modules/design/references', 'section'], ['T10', 'modules/design/components', 'section (scripts held)'],
  ['T11', 'modules/design/flows', 'section'], ['T3', 'modules/design/canvas', 'section'],
  ['T4', 'modules/design/compare', 'section'], ['T5', 'modules/design/annotations', 'section'],
  ['T7', 'modules/design/taste', 'section'], ['T6', 'modules/design/requests', 'section'],
  ['T13', 'modules/design/imports', 'section'], ['T12', 'modules/design/connector', 'section (no transport)'],
  ['T9', 'packages/design-store', 'headless: assembled and checked, not mounted (Node store)'],
];

Object.assign(window, {
  __hqdPreview: { fake: true, candidate: __HQD_CANDIDATE__, shell, domain, registry, writes, projectRequests, egress, cones: CONES },
});

const LABELS: Record<DomainId, string> = { design: 'Design', social: 'Social', work: 'Work', wiki: 'Wiki' };
const CLASSES: readonly EgressClass[] = ['same-origin', 'loopback', 'inline', 'unexpected'];

function EgressSummary() {
  const entries = egress.entries();
  const unexpected = egress.unexpected();
  return <details className="preview-panel" data-testid="egress" data-unexpected={unexpected.length}>
    <summary>Requests {unexpected.length > 0 ? <strong className="preview-alarm">{unexpected.length} UNEXPECTED</strong> : <span>loopback only</span>}</summary>
    <ul>{CLASSES.map((kind) => <li key={kind}>{kind}: {entries.filter((entry) => entry.classification === kind).length}</li>)}</ul>
    {unexpected.length > 0 && <ol className="preview-alarm">{unexpected.map((entry, index) => <li key={index}><code>{entry.url}</code> ({entry.kind})</li>)}</ol>}
    <p>Observed in this document only (Resource Timing and CSP reports). Not a network-isolation proof.</p>
  </details>;
}

function FakeShellApp() {
  useSyncExternalStore((listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; }, () => tick);
  const snapshot = shell.getSnapshot();
  const [, force] = useState(0);
  const port: ModulePort = {
    context: snapshot.context, destination: shell.destinations.design, appearance: snapshot.appearance, desktop: snapshot.desktop,
    navigate: (destination) => { shell.destinations.design = destination; force((n) => n + 1); },
  };
  const Design = domain.Component;
  return <div className="fake-shell" data-theme={snapshot.appearance}>
    <aside className="fake-rail" aria-label="Fake HQ shell">
      <p className="fake-banner" role="note"><strong>LABELLED FAKE HQ shell</strong> Design integration preview. Synthetic data, labelled fakes. Not the HQ app, Electron or real adapters.</p>
      <nav aria-label="Domains">{(['design', 'social', 'work'] as const).map((id) => <button key={id} type="button"
        data-testid={`domain-${id}`} aria-current={shell.domain === id ? 'page' : undefined}
        onClick={() => { shell.switchDomain(id); rerender(); }}>{LABELS[id]}</button>)}</nav>
      <button type="button" data-testid="toggle-appearance"
        onClick={() => shell.setAppearance(snapshot.appearance === 'dark' ? 'light' : 'dark')}>
        {snapshot.appearance === 'dark' ? 'Light' : 'Dark'} appearance
      </button>
      <label className="fake-project">Shell project
        <select data-testid="shell-project" value={snapshot.context.id}
          onChange={(event) => { const next = PREVIEW_PROJECTS.find((item) => item.id === event.target.value); if (next) shell.setContext(next); }}>
          {PREVIEW_PROJECTS.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
        </select>
      </label>
      <EgressSummary />
      <details className="preview-panel" data-testid="assembly">
        <summary>Assembly · 14 cones</summary>
        <p>Candidate <code>{__HQD_CANDIDATE__}</code></p>
        <ul>{CONES.map(([lane, cone, use]) => <li key={cone}><strong>{lane}</strong> <code>{cone}</code> {use}</li>)}</ul>
        {registry.rejected.length > 0 && <p className="preview-alarm">Rejected descriptors: {registry.rejected.map((item) => item.path).join(', ')}</p>}
      </details>
    </aside>
    <div className="fake-module" key={`${snapshot.context.id}:${shell.domain}`}>
      {shell.domain === 'design' ? <Design {...port} />
        : <p className="fake-placeholder" data-testid="other-domain">{LABELS[shell.domain]} (fake placeholder, not the real module)</p>}
    </div>
  </div>;
}

createRoot(document.getElementById('root')!).render(<StrictMode><FakeShellApp /></StrictMode>);
