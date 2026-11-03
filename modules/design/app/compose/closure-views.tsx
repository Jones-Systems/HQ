import { use, useMemo, type ComponentType, type ReactNode } from 'react';
import type { DesignSectionProps } from '../../ui/contract.ts';
import type { RequestsSectionProps } from '../sections/requests/View.tsx';
import type { RunsSectionProps } from '../sections/runs/View.tsx';
import type { ReferencesSection } from '../sections/references/View.tsx';
import type { RequestSession } from '../../requests/src/session.ts';
import type { RequestsEnvironment } from '../sections/requests/env.ts';
import { ValidationError, brandId } from '../../requests/src/validate.ts';
import { NO_SOURCE_REVISION_REASON } from '../../requests/ui/model.ts';
import type { SourceVersionChoice } from '../../requests/ui/SourceVersionPicker.tsx';
import { RequestsWorkbench, type RequestContext, type WorkbenchPorts } from '../sections/requests/Workbench.tsx';
import { useDesignProject, useDesignWorkspace } from './workspace-context.tsx';
import { ProjectScope } from './views/ProjectScope.tsx';
import { SectionFrame } from './views/SectionFrame.tsx';
import { withSectionErrorBoundary } from './views/SectionErrorBoundary.tsx';

/** The project's requests and versions, wired to the Requests and Runs page. Reading is local; only Create writes. */
function RequestPicker({ props, mode, children }: {
  readonly props: DesignSectionProps;
  readonly mode: 'requests' | 'runs';
  readonly children: (session: RequestSession, context: RequestContext) => ReactNode;
}) {
  const workspace = useDesignWorkspace();
  const project = useDesignProject(props.context);
  const env = workspace.closure.requests;
  const { state, navigate } = props;
  const ports = useMemo<WorkbenchPorts>(() => ({
    loadRequests: () => projectRequests(env, project.id),
    // Versions are read again each time, so one added in Projects appears without a reload.
    async loadVersions() {
      const content = await workspace.readContent(project);
      const titles = new Map<string, string>(content.views.map((view) => [view.id, view.title]));
      return content.versions.map((version): SourceVersionChoice => ({
        id: version.id, viewId: version.viewId, viewTitle: titles.get(version.viewId) ?? 'Untitled view', label: version.label,
        ordinal: version.ordinal, detail: `${version.capture.route} · ${version.capture.viewport.w}×${version.capture.viewport.h}`,
        unavailableReason: version.capture.sourceRevision ? null : NO_SOURCE_REVISION_REASON,
      }));
    },
    async createRequest(versionId) {
      const content = await workspace.readContent(project);
      const version = content.versions.find((item) => item.id === versionId);
      if (!version?.capture.sourceRevision) throw new ValidationError('source', 'This version has no source revision.');
      return env.create({ title: 'New request', sources: [{ projectId: brandId(project.id),
        viewId: brandId(version.viewId), versionId: brandId(version.id), sourceRevision: version.capture.sourceRevision }] });
    },
    readSelected: () => state.read(),
    writeSelected: (requestId) => state.write(requestId),
    openProjects: () => navigate({ nav: 'projects', section: 'projects' }),
    openRequests: () => navigate({ nav: 'requests', section: 'requests' }),
    openRuns: () => navigate({ nav: 'runs', section: 'connector' }),
  }), [env, project, workspace, state, navigate]);
  return <RequestsWorkbench mode={mode} ports={ports} compareSlot={env.compareSlot}>{children}</RequestsWorkbench>;
}

async function projectRequests(env: RequestsEnvironment, projectId: string) {
  const sessions: RequestSession[] = [];
  for (const id of await env.store.listRequests()) {
    const session = await env.open(id);
    const sources = session.state.draft?.sources ?? session.state.packets.at(-1)?.sources ?? [];
    if (sources.length > 0 && sources.every((source) => source.projectId === projectId)) sessions.push(session);
  }
  return sessions;
}

export function mountRequests(Section: ComponentType<RequestsSectionProps>): ComponentType<DesignSectionProps> {
  return withSectionErrorBoundary(function RequestsMount(props) {
    const workspace = useDesignWorkspace();
    const project = useDesignProject(props.context);
    return <SectionFrame lane="Requests" entry="app/sections/requests/View.tsx" tags={[workspace.storageTag]} scope={<ProjectScope project={project} navigate={props.navigate} />}>
      <RequestPicker key={project.id} props={props} mode="requests">{(session, context) => <Section env={workspace.closure.requests} session={session}
        example={!workspace.bridged} focusTitle={context.focusTitle} sourceLabel={context.sourceLabel} onOpenReturned={context.openReturned}
        navigation={{ navigate: (intent) => { if (intent.type === 'open-runs') props.navigate({ nav: 'runs', section: 'connector' }); } }} />}</RequestPicker>
    </SectionFrame>;
  });
}

export function mountRuns(Section: ComponentType<RunsSectionProps>): ComponentType<DesignSectionProps> {
  return withSectionErrorBoundary(function RunsMount(props) {
    const workspace = useDesignWorkspace();
    const env = use(workspace.closure.runs());
    const project = useDesignProject(props.context);
    return <SectionFrame lane="Runs" entry="app/sections/runs/View.tsx" tags={[workspace.storageTag]} scope={<ProjectScope project={project} navigate={props.navigate} />}>
      <RequestPicker key={project.id} props={props} mode="runs">{(session) => <Section env={env} session={session} now={workspace.closure.requests.clock.now()}
        onOpenRequests={() => props.navigate({ nav: 'requests', section: 'requests' })} />}</RequestPicker>
    </SectionFrame>;
  });
}

export function mountReferences(Section: typeof ReferencesSection): ComponentType<DesignSectionProps> {
  return withSectionErrorBoundary(function ReferencesMount({ context, navigate }) {
    const workspace = useDesignWorkspace();
    const env = use(workspace.closure.references());
    return <SectionFrame lane="References" entry="app/sections/references/View.tsx" tags={[workspace.storageTag]}>
      <Section env={env} currentProject={context} onShowProjects={() => navigate({ nav: 'projects', section: 'projects' })} />
    </SectionFrame>;
  });
}
