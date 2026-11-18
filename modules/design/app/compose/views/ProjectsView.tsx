import { withSectionErrorBoundary } from './SectionErrorBoundary.tsx';
import { use, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Button, Presence, Skeleton, FieldError, fieldErrorProps, InlineNotice, useToast, useReducedMotion } from '@hq/ui';
import { ActionButton } from '../../../projects/src/views/controls.ts';
import type { ProjectsUi } from '../../../projects/src/views/ui.ts';
import type { DesignSectionProps } from '../../../ui/contract.ts';
import { ProjectsSection } from '../../../projects/src/index.ts';
import '../../../projects/src/projects.css';
import { useDesignWorkspace } from '../workspace-context.tsx';
import { findPreview, openPreviewSource, previewKind, previewUnavailableReason, type PreviewIdentity } from '../preview-navigation.ts';
import { interactiveTarget } from '../runtime-ports.ts';
import { InteractivePanel } from './InteractivePanel.tsx';
import { SectionFrame } from './SectionFrame.tsx';

const projectsUi: ProjectsUi = { Presence, Skeleton, FieldError, fieldErrorProps, InlineNotice, useToast, useReducedMotion };

function ProjectsViewContent({ context, navigate }: DesignSectionProps) {
  const workspace = useDesignWorkspace();
  const controller = use(workspace.projectsFor(context));
  const environment = use<Awaited<ReturnType<typeof workspace.discoveryEnv>>>(workspace.discoveryEnv());
  const { readPort } = environment;
  const native = 'chooseRoot' in environment ? environment : null;
  const status = useSyncExternalStore(readPort.subscribe, readPort.status, readPort.status);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<PreviewIdentity | null>(null);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const close = useRef<HTMLButtonElement | null>(null);
  const entry = readPort.current().find((item) => item.sourceProjectId === selected?.sourceProjectId && item.hostId === selected.hostId);
  const preview = useSyncExternalStore(workspace.interactive.subscribe, workspace.interactive.snapshot, workspace.interactive.snapshot);
  const previewItem = selected ? findPreview(preview.items, selected) : null;
  useEffect(() => { if (entry) close.current?.focus(); }, [selected]);
  // The project opened here scopes Review and Requests; returning to the gallery keeps the last one open.
  // A controller without a store (a rendering double) leaves the scope unchanged.
  useEffect(() => {
    const sync = () => {
      const snapshot = controller.getSnapshot?.();
      const active = snapshot?.active;
      if (!active) return;
      const name = active.record?.name ?? snapshot.registry.projects.find((project) => project.id === active.projectId)?.name ?? active.projectId;
      workspace.activeProject.set({ id: active.projectId, name });
    };
    sync();
    return controller.subscribe?.(sync);
  }, [controller, workspace.activeProject]);
  async function run(action: () => Promise<void>) {
    setBusy(true); setError(null); setSelected(null);
    try { await action(); } catch (failure) { setError(failure instanceof Error ? failure.message : 'Project folders are unavailable.'); }
    finally { setBusy(false); }
  }
  const folders = native && <section aria-label="Project folders">
      <div className="hqp-toolbar">
        <ActionButton label="Choose projects folder" reason={busy ? 'Wait for the folder update to finish.' : undefined} onClick={() => void run(native.chooseRoot)} />
        <ActionButton label="Refresh" reason={busy ? 'Wait for the folder update to finish.' : native.roots().length === 0 ? 'Choose a projects folder first.' : undefined} onClick={() => void run(native.refresh)} />
        <ActionButton label="Forget folder" variant="ghost" reason={busy ? 'Wait for the folder update to finish.' : native.roots().length === 0 ? 'Choose a projects folder first.' : undefined} onClick={() => void run(native.forget)} />
      </div>
      {native.roots().length === 0
        ? <p>Choose a projects folder to see repositories on this device. Your saved workspace projects appear below.</p>
        : <p>{native.roots().map((root) => root.label).join(', ')} · Read-only source catalog. Forgetting removes access from HQ; your source files stay in place.</p>}
      {busy && <p role="status">Updating project folders…</p>}
      {error && <p role="alert">{error}</p>}
    </section>;
  return <SectionFrame lane="T2 projects" entry="projects/src › ProjectsSection" tags={[workspace.storageTag, status.tag]}>

    {entry && <section aria-label={`${entry.displayName} source details`} className="hqp-source-details">
      <Button ref={close} variant="secondary" onClick={() => { setSelected(null); trigger.current?.focus(); }}>Close source details</Button>
      <h2>{entry.displayName}</h2>
      <p>Read-only source project · {entry.hostLabel}</p>
      <dl>
        <dt>Folder</dt><dd>{entry.relativePath}</dd>
        <dt>Revision</dt><dd>{entry.revision ?? 'Not reported'}</dd>
        <dt>Repository</dt><dd>{entry.repoIdentity.normalizedRemote ?? 'Local repository'}</dd>
        <dt>Catalog status</dt><dd>{entry.freshness.status}</dd>
      </dl>
      {previewItem && interactiveTarget(previewItem)
        ? <ActionButton label={`Open ${previewKind(previewItem).toLowerCase()}`} reason={preview.busy ? 'Wait for the preview operation to finish.' : preview.held ? 'The preview is held. Resolve its current notice before opening another source.' : !workspace.interactive.available || !workspace.interactive.selectProjectAvailable ? 'Source selection is unavailable in this workspace.' : undefined} onClick={() => void openPreviewSource(workspace.interactive, selected!)} />
        : <p role="status">{previewUnavailableReason(previewItem)}</p>}
      <p>Source discovery provides repository details. Create a workspace project below to organize design views and versions.</p>
    </section>}
    <ProjectsSection controller={controller} ui={projectsUi} actions={{ openCanvas: () => navigate({ nav: 'review', section: 'canvas' }), compare: () => navigate({ nav: 'review', section: 'compare' }) }} gallery={{ folders, onOpenSource: (item, button) => { trigger.current = button; setSelected({ hostId: item.hostId, sourceProjectId: item.sourceProjectId }); } }} />
    <InteractivePanel context={context} navigate={navigate} />
  </SectionFrame>;
}

export const ProjectsView = withSectionErrorBoundary(ProjectsViewContent, true);
