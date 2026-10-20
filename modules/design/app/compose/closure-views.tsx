import { Button, StatusChip } from '@hq/ui';
import { use, useEffect, useState, type ComponentType, type ReactNode } from 'react';
import type { DesignSectionProps } from '../../ui/contract.ts';
import type { RequestsSectionProps } from '../sections/requests/View.tsx';
import type { RunsSectionProps } from '../sections/runs/View.tsx';
import type { ReferencesSection } from '../sections/references/View.tsx';
import type { RequestSession } from '../../requests/src/session.ts';
import type { ProjectContent } from '../../projects/src/content.ts';
import type { RequestsEnvironment } from '../sections/requests/env.ts';
import { brandId } from '../../requests/src/validate.ts';
import { useDesignWorkspace } from './workspace-context.tsx';
import { SectionFrame } from './views/SectionFrame.tsx';
import { withSectionErrorBoundary } from './views/SectionErrorBoundary.tsx';

function RequestPicker({ props, create, children }: {
  readonly props: DesignSectionProps;
  readonly create: boolean;
  readonly children: (session: RequestSession) => ReactNode;
}) {
  const workspace = useDesignWorkspace();
  const env = workspace.closure.requests;
  const { content } = use<{ readonly content: ProjectContent }>(workspace.contentFor(props.context));
  const [sessions, setSessions] = useState<readonly RequestSession[]>([]);
  const [selected, setSelected] = useState<RequestSession | null>(null);
  const [versionId, setVersionId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    void projectRequests(env, props.context.id).then((found) => {
      if (active) { setSessions(found); setSelected(found.find((session) => session.state.requestId === props.state.read()) ?? null); }
    }).catch(() => { if (active) setError('Requests unavailable. Stored data was not replaced.'); });
    return () => { active = false; };
  }, [env, props.context.id, props.state]);
  const choose = (session: RequestSession | null) => {
    setSelected(session);
    if (session) props.state.write(session.state.requestId);
  };
  const add = async () => {
    const version = content.versions.find((item) => item.id === versionId);
    if (!version?.capture.sourceRevision) return;
    setBusy(true); setError(null);
    try {
      const session = await env.create({ title: 'New request', sources: [{ projectId: brandId(props.context.id),
        viewId: brandId(version.viewId), versionId: brandId(version.id), sourceRevision: version.capture.sourceRevision }] });
      setSessions((current) => [...current, session]); choose(session);
    } catch { setError('Request creation failed or its outcome is unknown. Reopen to reconcile before trying again.'); }
    finally { setBusy(false); }
  };
  return <div className="hqd-request-page">
    <header className="hqd-page-heading">
      <div><h1>{create ? 'Requests' : 'Runs'}</h1>
        <p>{create ? 'Shape a request from a saved project version.' : 'Review frozen requests and their returned work.'}</p></div>
      <StatusChip tone="neutral" label="On this device" />
    </header>
    <div className="hqd-request-picker">
    {error && <p role="alert">{error}</p>}
    <label className="hqd-field">Request <select value={selected?.state.requestId ?? ''} disabled={busy} onChange={(event) => choose(sessions.find((session) => session.state.requestId === event.target.value) ?? null)}>
      <option value="">Choose a request</option>
      {sessions.map((session) => <option key={session.state.requestId} value={session.state.requestId}>{session.state.draft?.title || session.state.requestId}</option>)}
    </select></label>
    {create && <div className="hqd-request-create">
      <label className="hqd-field">Source version <select value={versionId} onChange={(event) => setVersionId(event.target.value)}>
        <option value="">Choose a saved source version</option>
        {content.versions.filter((version) => version.capture.sourceRevision).map((version) => <option key={version.id} value={version.id}>{version.label}</option>)}
      </select></label>
      <Button variant="primary" busy={busy} busyLabel="Creating request" disabled={busy || error !== null || !versionId} onClick={() => { void add(); }}>Create request</Button>
      {content.versions.every((version) => !version.capture.sourceRevision) && <p>Save a project version with a source revision before creating a request.</p>}
    </div>}
    </div>
    {selected ? children(selected) : <div className="hqd-empty-state">
      <h2>{sessions.length === 0 ? 'No requests yet' : 'Choose a request'}</h2>
      <p>{sessions.length === 0 ? (create ? 'Choose a source version above to start your first request.' : 'Create and freeze a request in Requests to see it here.') : 'Choose a request to continue.'}</p>
      <p className="hqd-safety-note">Navigation sends nothing.</p>
    </div>}
  </div>;
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
    return <SectionFrame lane="Requests" entry="app/sections/requests/View.tsx" tags={[workspace.storageTag]}>
      <RequestPicker key={props.context.id} props={props} create>{(session) => <Section env={workspace.closure.requests} session={session}
        navigation={{ navigate: (intent) => { if (intent.type === 'open-runs') props.navigate({ nav: 'runs', section: 'connector' }); } }} />}</RequestPicker>
    </SectionFrame>;
  });
}

export function mountRuns(Section: ComponentType<RunsSectionProps>): ComponentType<DesignSectionProps> {
  return withSectionErrorBoundary(function RunsMount(props) {
    const workspace = useDesignWorkspace();
    const env = use(workspace.closure.runs());
    return <SectionFrame lane="Runs" entry="app/sections/runs/View.tsx" tags={[workspace.storageTag]}>
      <RequestPicker key={props.context.id} props={props} create={false}>{(session) => <Section env={env} session={session} now={workspace.closure.requests.clock.now()} />}</RequestPicker>
    </SectionFrame>;
  });
}

export function mountReferences(Section: typeof ReferencesSection): ComponentType<DesignSectionProps> {
  return withSectionErrorBoundary(function ReferencesMount({ context }) {
    const workspace = useDesignWorkspace();
    const env = use(workspace.closure.references());
    return <SectionFrame lane="References" entry="app/sections/references/View.tsx" tags={[workspace.storageTag]}>
      <Section env={env} currentProject={context} />
    </SectionFrame>;
  });
}
