/**
 * LABELLED FAKE HQ shell around the real Design domain descriptor. It mirrors
 * the foundation App's behaviour that matters here: one domain mounted at a
 * time (Design unmounts on switch), per-domain destinations, Light/Dark.
 * Test hooks are exposed on window.__hqdHarness for runtime evidence only.
 */
import { StrictMode, useState, useSyncExternalStore } from 'react';
import { createRoot } from 'react-dom/client';
import type { DomainId, ModulePort } from '@hq/contracts';
import type { UiStatePort } from '../contract.ts';
import { createDesignDomain } from '../src/domain.tsx';
import { createFakeShell } from '../src/fakes.ts';
import { buildRegistry } from '../src/registry.ts';
import type { SectionView } from '../src/view/SectionOutlet.tsx';
import './harness.css';

const PROJECTS = [{ id: 'alpha', name: 'Alpha site' }, { id: 'beta', name: 'Beta site' }] as const;
const registry = buildRegistry<SectionView>(import.meta.glob('./sections/*/design-module.ts', { eager: true }));

const writes: string[] = [];
const storage: UiStatePort = {
  getItem: (key) => window.localStorage.getItem(key),
  setItem: (key, value) => { writes.push(key); window.localStorage.setItem(key, value); },
};

const shell = createFakeShell(PROJECTS[0], window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
const requests: string[] = [];
const domain = createDesignDomain({
  registry, storage, projects: PROJECTS,
  shell: {
    ...shell,
    // The fake shell applies a confirmed request, as a real shell would.
    requestProjectContext: (projectId) => {
      requests.push(projectId);
      const project = PROJECTS.find((item) => item.id === projectId);
      if (project) shell.setContext(project);
    },
  },
});

let tick = 0;
const listeners = new Set<() => void>();
const rerender = () => { tick += 1; for (const listener of [...listeners]) listener(); };
shell.subscribe(rerender);
shell.onDomainChange((from) => { if (from === 'design') domain.deactivate(); });

Object.assign(window, { __hqdHarness: { fake: true, shell, domain, writes, requests, registry } });

const LABELS: Record<DomainId, string> = { design: 'Design', social: 'Social', work: 'Work', wiki: 'Wiki' };

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
      <strong>HQ <small>fake shell</small></strong>
      <nav aria-label="Domains">{(['design', 'social', 'work'] as const).map((id) => <button key={id} type="button"
        data-testid={`domain-${id}`} aria-current={shell.domain === id ? 'page' : undefined}
        onClick={() => { shell.switchDomain(id); rerender(); }}>{LABELS[id]}</button>)}</nav>
      <button type="button" data-testid="toggle-appearance"
        onClick={() => shell.setAppearance(snapshot.appearance === 'dark' ? 'light' : 'dark')}>
        {snapshot.appearance === 'dark' ? 'Light' : 'Dark'} appearance
      </button>
      <p data-testid="shell-project">Project: {snapshot.context.name}</p>
    </aside>
    <div className="fake-module" key={`${snapshot.context.id}:${shell.domain}`}>
      {shell.domain === 'design' ? <Design {...port} />
        : <p className="fake-placeholder" data-testid="other-domain">{LABELS[shell.domain]} (fake placeholder)</p>}
    </div>
  </div>;
}

createRoot(document.getElementById('root')!).render(<StrictMode><FakeShellApp /></StrictMode>);
