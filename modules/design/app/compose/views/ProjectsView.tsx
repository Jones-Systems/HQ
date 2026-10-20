import { withSectionErrorBoundary } from './SectionErrorBoundary.tsx';
import { use, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Button } from '@hq/ui';
import type { DesignSectionProps } from '../../../ui/contract.ts';
import { ProjectsSection } from '../../../projects/src/index.ts';
import '../../../projects/src/projects.css';
import { useDesignWorkspace } from '../workspace-context.tsx';
import { SectionFrame } from './SectionFrame.tsx';

function ProjectsViewContent({ context }: DesignSectionProps) {
  const workspace = useDesignWorkspace();
  const controller = use(workspace.projectsFor(context));
  const environment = use<Awaited<ReturnType<typeof workspace.discoveryEnv>>>(workspace.discoveryEnv());
  const { readPort } = environment;
  const native = 'chooseRoot' in environment ? environment : null;
  const status = useSyncExternalStore(readPort.subscribe, readPort.status, readPort.status);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const close = useRef<HTMLButtonElement | null>(null);
  const entry = readPort.current().find((item) => item.sourceProjectId === selected);
  useEffect(() => { if (entry) close.current?.focus(); }, [selected]);
  async function run(action: () => Promise<void>) {
    setBusy(true); setError(null); setSelected(null);
    try { await action(); } catch (failure) { setError(failure instanceof Error ? failure.message : 'Project folders are unavailable.'); }
    finally { setBusy(false); }
  }
  return <SectionFrame lane="T2 projects" entry="projects/src › ProjectsSection" tags={[workspace.storageTag, status.tag]}>
    {native && <section aria-label="Project folders">
      <div className="hqp-toolbar">
        <Button disabled={busy} onClick={() => void run(native.chooseRoot)}>Choose projects folder</Button>
        <Button variant="secondary" disabled={busy || native.roots().length === 0} onClick={() => void run(native.refresh)}>Refresh</Button>
        <Button variant="ghost" disabled={busy || native.roots().length === 0} onClick={() => void run(native.forget)}>Forget folder</Button>
      </div>
      {native.roots().length === 0
        ? <p>Choose a projects folder to see repositories on this device. Your saved workspace projects appear below.</p>
        : <p>{native.roots().map((root) => root.label).join(', ')} · Read-only source catalog. Forgetting removes access from HQ; your source files stay in place.</p>}
      {busy && <p role="status">Updating project folders…</p>}
      {error && <p role="alert">{error}</p>}
    </section>}
    {entry && <section aria-label={`${entry.displayName} source details`} className="hqp-detail">
      <Button ref={close} variant="secondary" onClick={() => { setSelected(null); trigger.current?.focus(); }}>Close source details</Button>
      <h2>{entry.displayName}</h2>
      <p>Read-only source project · {entry.hostLabel}</p>
      <dl>
        <dt>Folder</dt><dd>{entry.relativePath}</dd>
        <dt>Revision</dt><dd>{entry.revision ?? 'Not reported'}</dd>
        <dt>Repository</dt><dd>{entry.repoIdentity.normalizedRemote ?? 'Local repository'}</dd>
        <dt>Catalog status</dt><dd>{entry.freshness.status}</dd>
      </dl>
      <p>Source discovery provides repository details. Create a workspace project below to organize design views and versions.</p>
    </section>}
    <ProjectsSection controller={controller} gallery={{ onOpenSource: (item, button) => { trigger.current = button; setSelected(item.sourceProjectId); } }} />
  </SectionFrame>;
}

export const ProjectsView = withSectionErrorBoundary(ProjectsViewContent);
