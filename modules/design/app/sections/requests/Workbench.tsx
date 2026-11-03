import { Button, InlineNotice, Presence, Skeleton, StatusChip, Tabs, useToast } from '@hq/ui';
import { useId, useMemo, useState, type ComponentType, type ReactNode } from 'react';
import type { CompareSlotProps } from '../../../requests/src/contract.ts';
import type { RequestSession } from '../../../requests/src/session.ts';
import { ValidationError } from '../../../requests/src/validate.ts';
import { RequestList } from '../../../requests/ui/RequestList.tsx';
import { useLoadable, useSessionStates } from '../../../requests/ui/hooks.ts';
import { requestAge, requestTitle } from '../../../requests/ui/model.ts';
import type { SourceVersionChoice } from '../../../requests/ui/SourceVersionPicker.tsx';
import { SIMULATION_LABEL } from '../runs/pipeline.ts';
import { NewRequest } from './NewRequest.tsx';
import { ReturnedTab } from './ReturnedTab.tsx';
import './request-page.css';

/** What the workbench needs from its host. Every method is local reading or an explicit create; none sends. */
export interface WorkbenchPorts {
  /** Opens every request of the active project. */
  loadRequests(): Promise<readonly RequestSession[]>;
  /** The project's saved versions, read fresh. */
  loadVersions(): Promise<readonly SourceVersionChoice[]>;
  /** Writes a new private draft from one saved version. This is the only write the workbench makes. */
  createRequest(versionId: string): Promise<RequestSession>;
  readSelected(): string | null;
  writeSelected(requestId: string): void;
  openProjects(): void;
  openRequests(): void;
  openRuns(): void;
}

/** What the selected request's body gets from the workbench. */
export interface RequestContext {
  readonly focusTitle: boolean;
  readonly sourceLabel: (versionId: string) => string | null;
  readonly openReturned: () => void;
}

export interface RequestsWorkbenchProps {
  readonly mode: 'requests' | 'runs';
  readonly ports: WorkbenchPorts;
  readonly compareSlot: ComponentType<CompareSlotProps>;
  readonly children: (session: RequestSession, context: RequestContext) => ReactNode;
}

type TabId = 'requests' | 'returned';
const NO_SESSIONS: readonly RequestSession[] = [];

/**
 * The Requests and Runs page: the project's requests as a list with status chips, the selected request beside it,
 * and, in Requests, a Returned tab for work that came back across all of them.
 */
export function RequestsWorkbench({ mode, ports, compareSlot, children }: RequestsWorkbenchProps) {
  const toast = useToast();
  const panelId = useId();
  const requests = useLoadable(ports.loadRequests, 'requests');
  const versions = useLoadable(ports.loadVersions, 'versions');
  const [created, setCreated] = useState<readonly RequestSession[]>([]);
  const [chosenId, setChosenId] = useState<string | null>(() => ports.readSelected());
  const [tab, setTab] = useState<TabId>('requests');
  const [creating, setCreating] = useState<boolean | null>(null);
  const [createBusy, setCreateBusy] = useState(false);
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const [focusTitleId, setFocusTitleId] = useState<string | null>(null);
  const [returnedFor, setReturnedFor] = useState<string | null>(null);

  const loaded = requests.state.status === 'ready' ? requests.state.value : null;
  const all = useMemo(() => {
    if (loaded === null) return null;
    const ids = new Set(created.map((session) => session.state.requestId as string));
    const rest = loaded.filter((session) => !ids.has(session.state.requestId as string))
      .sort((a, b) => requestAge(b.state) - requestAge(a.state));
    return [...created, ...rest];
  }, [loaded, created]);
  const states = useSessionStates(all ?? NO_SESSIONS);
  const visible = all === null ? null : mode === 'runs' ? all.filter((_, index) => (states[index]?.packets.length ?? 0) > 0) : all;
  const selected = visible?.find((session) => session.state.requestId === chosenId) ?? visible?.[0] ?? null;
  const returnedCount = states.reduce((total, state) => total + state.candidates.length, 0);

  const labels = useMemo(() => {
    const map = new Map<string, string>();
    if (versions.state.status === 'ready') for (const version of versions.state.value) map.set(version.id, `${version.viewTitle} · ${version.label}`);
    return map;
  }, [versions.state]);

  const choose = (session: RequestSession) => {
    const id = session.state.requestId as string;
    setChosenId(id);
    setFocusTitleId(null);
    ports.writeSelected(id);
  };
  const open = creating ?? (visible !== null && visible.length === 0 && mode === 'requests');
  const toggleCreate = () => {
    if (!open) versions.reload();
    setCreating(!open);
  };

  const create = async (versionId: string) => {
    if (createBusy) return;
    setCreateBusy(true);
    try {
      const session = await ports.createRequest(versionId);
      const id = session.state.requestId as string;
      setCreated((previous) => [session, ...previous]);
      setChosenId(id); setHighlightId(id); setFocusTitleId(id);
      setTab('requests'); setCreating(false);
      ports.writeSelected(id);
      toast.success('Request created', { description: `“${requestTitle(session.state)}” is a private draft on this device. Nothing was sent.` });
    } catch (error) {
      if (error instanceof ValidationError) {
        toast.error("Couldn't create the request", { description: `${error.message} Nothing was created, and your chosen version is still selected.` });
      } else {
        toast.unknown('Request creation result unknown', {
          description: 'Request creation failed or its outcome is unknown. Reopen to reconcile before trying again. Your chosen version is still selected.',
          action: { label: 'Check', onAction: requests.reload },
        });
      }
    } finally {
      setCreateBusy(false);
    }
  };

  const context = (session: RequestSession): RequestContext => ({
    focusTitle: focusTitleId === session.state.requestId,
    sourceLabel: (versionId) => labels.get(versionId) ?? null,
    openReturned: () => { setReturnedFor(session.state.requestId as string); setTab('returned'); },
  });

  const rail = <section className="hqd-request-rail" aria-labelledby={`${panelId}-rail`}>
    <div className="hqd-rail-head">
      <h2 id={`${panelId}-rail`}>{mode === 'runs' ? 'Frozen requests in this project' : 'Requests in this project'}</h2>
      {mode === 'requests' && <Button variant="primary" size="sm" aria-expanded={open} aria-controls={`${panelId}-new`} onClick={toggleCreate}>New request</Button>}
    </div>
    {mode === 'requests' && <Presence show={open} motion="collapse" id={`${panelId}-new`}>
      <NewRequest versions={versions.state} onRetryVersions={versions.reload} onCreate={(id) => { void create(id); }}
        onCancel={() => setCreating(false)} onOpenProjects={ports.openProjects} busy={createBusy} />
    </Presence>}
    {requests.state.status === 'loading' && <div aria-busy="true" className="hqd-rail-loading">
      <span role="status" className="hq-sr-only">Loading requests…</span>
      <Skeleton shape="block" height="52px" /><Skeleton shape="block" height="52px" />
    </div>}
    {requests.state.status === 'error' && <InlineNotice tone="danger" title="Requests unavailable"
      actions={[{ label: 'Try again', onAction: requests.reload }]}>Stored data was not replaced.</InlineNotice>}
    {visible !== null && visible.length > 0 && <RequestList sessions={visible} selectedId={selected?.state.requestId ?? null} onSelect={choose}
      label={mode === 'runs' ? 'Frozen requests' : 'Requests'} highlightId={highlightId} />}
    {visible !== null && visible.length === 0 && <p className="hqd-rail-empty">{mode === 'runs'
      ? 'No request has been frozen in this project.' : 'No requests in this project yet.'}</p>}
  </section>;

  const detail = <div className="hqd-request-detail">
    {selected
      ? <div key={selected.state.requestId as string} className="hq-enter-fade">{children(selected, context(selected))}</div>
      : visible === null
        ? <div aria-busy="true"><Skeleton shape="block" height="160px" /></div>
        : mode === 'runs'
          ? <div className="hqd-empty-state">
            <h2>No frozen requests yet</h2>
            <p>Freeze a request in Requests to review its packet here. Opening a packet sends nothing.</p>
            <Button variant="primary" onClick={ports.openRequests}>Open Requests</Button>
            <p className="hqd-safety-note">Navigation sends nothing.</p>
          </div>
          : <div className="hqd-empty-state">
            <h2>No requests yet</h2>
            <p>Start with a saved version of this project. Creating a request saves a private draft on this device.</p>
            <Button variant="primary" onClick={() => { if (!open) toggleCreate(); }}>New request</Button>
            <p className="hqd-safety-note">Navigation sends nothing.</p>
          </div>}
  </div>;

  return <div className="hqd-request-page">
    <header className="hqd-page-heading">
      <div><h1>{mode === 'requests' ? 'Requests' : 'Runs'}</h1>
        <p>{mode === 'requests' ? 'Shape a request from a saved project version, freeze it, and review what comes back.' : 'Review frozen requests and their returned work.'}</p></div>
      <StatusChip tone="neutral" label="On this device" />
    </header>
    {mode === 'requests'
      ? <Tabs label="Requests and returned work" selectedId={tab} className="hqd-request-tabs"
        onSelectedChange={(id) => { setTab(id as TabId); if (id !== 'returned') setReturnedFor(null); }}
        tabs={[
          { id: 'requests', label: 'Requests', panel: <div className="hqd-request-layout">{rail}{detail}</div> },
          { id: 'returned', label: `Returned (${returnedCount})`, panel: tab === 'returned' && all !== null
            ? <ReturnedTab sessions={all} compareSlot={compareSlot} simulationLabel={SIMULATION_LABEL} preferRequestId={returnedFor}
              onOpenDraft={(session) => { choose(session); setReturnedFor(null); setTab('requests'); }} onOpenRuns={ports.openRuns}
              onBack={() => { setReturnedFor(null); setTab('requests'); }} />
            : null },
        ]} />
      : <div className="hqd-request-layout">{rail}{detail}</div>}
  </div>;
}
