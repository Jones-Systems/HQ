import { withSectionErrorBoundary } from './SectionErrorBoundary.tsx';
import { use, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { ProjectContext } from '@hq/contracts';
import { InlineNotice, Presence, StateView } from '@hq/ui';
import type { DesignSectionProps, JsonValue } from '../../../ui/contract.ts';
import { CanvasWorkspace } from '../../../canvas/src/view/index.ts';
import type { CanvasItemProvider, ProjectId as CanvasProjectId } from '../../../canvas/src/contract.ts';
import '../../../canvas/src/view/canvas.css';
import type { FlowId } from '../../../flows/src/contract.ts';
import { FAKE_TAG, SYNTHETIC_TAG } from '../labels.ts';
import { canvasSessionToJson, parseCanvasSession } from '../session.ts';
import { createCaptureCache, createFlowCache, summarizeFlow } from '../canvas-load-cache.ts';
import { createCanvasRenderers } from '../canvas-renderers.tsx';

import type { DesignWorkspace } from '../workspace.ts';
import { useDesignProject, useDesignWorkspace } from '../workspace-context.tsx';
import { ProjectScope } from './ProjectScope.tsx';
import { SectionFrame } from './SectionFrame.tsx';

type Refreshable = CanvasItemProvider & { readonly refresh: (project: CanvasProjectId) => Promise<unknown> };
const isRefreshable = (provider: CanvasItemProvider): provider is Refreshable => typeof (provider as Partial<Refreshable>).refresh === 'function';

/** What a provider's refresh report says went wrong, in plain words, or `null` when it went fine. */
function problemWith(label: string, report: unknown): string | null {
  if (typeof report !== 'object' || report === null) return null;
  const { status, errors } = report as { status?: unknown; errors?: unknown };
  if (typeof status === 'string' && status !== 'ok') return `${label} is stored in a format this version can't read`;
  if (Array.isArray(errors) && errors.length > 0) return `${label} didn't refresh`;
  return null;
}

/**
 * Asks every provider that can refresh to read its source again, so versions added in Projects since the canvas
 * last opened can be placed without a reload. Problems stay on screen as a notice; nothing already loaded is hidden.
 */
function useFreshSources(providers: readonly CanvasItemProvider[], project: CanvasProjectId, known: readonly string[]) {
  const [problems, setProblems] = useState<readonly string[]>(known);
  const [refreshing, setRefreshing] = useState(true);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let current = true;
    setRefreshing(true);
    Promise.all(providers.filter(isRefreshable).map(async (provider) => {
      try { return problemWith(provider.label, await provider.refresh(project)); } catch { return `${provider.label} didn't refresh`; }
    })).then((results) => {
      if (!current) return;
      setProblems(results.filter((result): result is string => result !== null));
      setRefreshing(false);
    });
    return () => { current = false; };
  }, [providers, project, attempt]);
  const retry = useCallback(() => setAttempt((count) => count + 1), []);
  return { problems, refreshing, retry, retried: attempt > 0 };
}

function SourceNotice({ problems, refreshing, retry, retried }: { problems: readonly string[]; refreshing: boolean; retry: () => void; retried: boolean }) {
  // Keep the last wording while the notice slides closed, so it does not blank out as it leaves.
  const [shown, setShown] = useState(problems);
  useEffect(() => { if (problems.length > 0) setShown(problems); }, [problems]);
  return <Presence show={problems.length > 0} motion="collapse" initial={false}>
    <div className="hq-canvas-notice">
      <InlineNotice tone="warning" variant="bar" title="Some sources didn't load" live={retried ? undefined : 'off'}
        actions={[{ label: 'Try again', onAction: retry, busy: refreshing, busyLabel: 'Refreshing' }]}>
        {shown.join('. ')}. Showing what loaded earlier; nothing was changed.
      </InlineNotice>
    </div>
  </Presence>;
}

/**
 * Canvas over three providers behind composition adapters: project views (T2), flows (T11), components (T10).
 * Camera, selection and focus live in T14's session under this section id, so a domain switch restores them.
 */
function CanvasViewContent({ context, state, navigate, surface }: DesignSectionProps) {
  const workspace = useDesignWorkspace();
  const project = useDesignProject(context);
  const { canvasFor } = workspace;
  const env = use<Awaited<ReturnType<typeof canvasFor>>>(canvasFor(project));
  const scope = <ProjectScope project={project} navigate={navigate} />;
  if (env === null) {
    return <SectionFrame lane="T3 canvas" entry="canvas/src/view › CanvasWorkspace" tags={[workspace.storageTag]} scope={scope}>
      <StateView state="unavailable" title="This project can't be opened on the canvas"
        description="Its identifier can't be used for a canvas. Nothing was changed." />
    </SectionFrame>;
  }
  return <LoadedCanvas env={env} project={project} own={project.id === context.id} state={state} surface={surface} scope={scope} />;
}

function LoadedCanvas({ env, project, own, state, surface, scope }: {
  env: NonNullable<Awaited<ReturnType<DesignWorkspace['canvasFor']>>>;
  project: ProjectContext;
  /** The stored camera belongs to the shell project's canvas; another project's canvas opens at its default view. */
  own: boolean;
  state: DesignSectionProps['state'];
  surface: DesignSectionProps['surface'];
  scope: ReactNode;
}) {
  const workspace = useDesignWorkspace();
  const { contentFor, flowsFor, readContent } = workspace;
  const content = use<Awaited<ReturnType<typeof contentFor>>>(contentFor(project));
  const session = own ? parseCanvasSession(state.read()) : undefined;

  // One cache per project and store; each is thrown away with the view.
  const captures = useMemo(() => createCaptureCache({ readContent: () => readContent(project), thumbnails: content.thumbnails }), [workspace, project.id, content.thumbnails]);
  const flows = useMemo(() => createFlowCache(async (flowId) => {
    const loaded = await (await flowsFor(project)).repository.load(flowId as FlowId);
    if (loaded.status !== 'ok') throw new Error('Flow not available');
    return summarizeFlow(loaded.flow);
  }), [workspace, project.id]);
  useEffect(() => () => { captures.dispose(); }, [captures]);
  useEffect(() => () => { flows.dispose(); }, [flows]);
  const renderers = useMemo(() => createCanvasRenderers({ captures, flows, surface }), [captures, flows, surface]);

  const providers = useMemo(() => env.registry.providers(), [env]);
  const sources = useFreshSources(providers, env.projectId, 'sourceErrors' in env ? env.sourceErrors : []);
  const retrySources = useCallback(() => { captures.retryFailed(); sources.retry(); }, [captures, sources.retry]);

  return <SectionFrame lane="T3 canvas" entry="canvas/src/view › CanvasWorkspace" fill scope={scope} tags={workspace.bridged ? [workspace.storageTag] : [FAKE_TAG, SYNTHETIC_TAG]}
    notes={[`providers: project views, ${env.adapters.map((adapter) => adapter.label).join(', ')}`, 'camera/selection kept in Design session state']}>
    <CanvasWorkspace key={env.canvasId} projectId={env.projectId} canvasId={env.canvasId} storage={env.storage} registry={env.registry} ids={env.ids}
      renderers={renderers} banner={<SourceNotice problems={sources.problems} refreshing={sources.refreshing} retry={retrySources} retried={sources.retried} />}
      {...(session ? { session } : {})}
      onSessionChange={(next) => { if (own) state.write(canvasSessionToJson(next) as JsonValue); }} />
  </SectionFrame>;
}

export const CanvasView = withSectionErrorBoundary(CanvasViewContent);
