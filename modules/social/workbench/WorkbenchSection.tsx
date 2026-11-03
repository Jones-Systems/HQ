import { useEffect, useMemo } from 'react';
import type { ProjectContext } from '@hq/contracts';
import { Button, StateView, StatusChip } from '@hq/ui';
import { isRunId, isToolId, workspaceSnapshot, type SocialWorkspacePort, type ToolId } from '../core';
import { useSocialFrame } from '../ui';
import { DELIVERED_LIMITS } from './catalog';
import { Catalog } from './WorkbenchCatalog';
import { WorkbenchEnvironmentProvider, useWorkbench } from './env';
import { formatTime } from './format';
import type { Visibility } from './polling';
import { RunHistory } from './RunHistory';
import { ToolWorkbench } from './ToolWorkbench';
import './workbench.css';

export type WorkbenchPage =
  | { readonly page: 'catalog' }
  | { readonly page: 'tool'; readonly tool: ToolId }
  | { readonly page: 'runs' }
  | { readonly page: 'run'; readonly runId: string };

/** The Social destinations this section renders: `workbenches[/<toolId>]` and `runs[/<runId>]`. */
export function parseWorkbenchDestination(destination: string): WorkbenchPage | null {
  const [head, id, ...rest] = destination.split('/');
  if (rest.length > 0) return null;
  if (head === 'workbenches') {
    if (id === undefined) return { page: 'catalog' };
    return isToolId(id) ? { page: 'tool', tool: id } : null;
  }
  if (head === 'runs') {
    if (id === undefined) return { page: 'runs' };
    return isRunId(id) ? { page: 'run', runId: id } : null;
  }
  return null;
}

export function isWorkbenchDestination(destination: string): boolean {
  return parseWorkbenchDestination(destination) !== null;
}

/**
 * How often the example workspace's runs are read while active. Its simulated worker steps about once a second, so
 * the default two-second read would skip a step. A live service is read at the normal cadence.
 */
export const EXAMPLE_POLL_INTERVAL_MS = 500;

export interface WorkbenchSectionProps {
  readonly port: SocialWorkspacePort;
  readonly context: ProjectContext;
  /** A Social destination for which `isWorkbenchDestination` holds. */
  readonly destination: string;
  readonly navigate: (destination: string) => void;
  readonly clock?: () => Date;
  readonly visibility?: Visibility;
  readonly pollIntervalMs?: number;
  /** The fictional example workspace. Defaults to what the Social frame says, and to false outside it. */
  readonly example?: boolean;
}

/**
 * The eight tool workbenches, run history and receipts (task.social-workbench.001). Rendering, navigating,
 * loading examples, editing and importing make zero execution calls; only the explicit Run action submits.
 */
export function WorkbenchSection({ port, context, destination, navigate, clock, visibility, pollIntervalMs, example }: WorkbenchSectionProps) {
  const frame = useSocialFrame();
  const isExample = example ?? frame?.example ?? false;
  const interval = pollIntervalMs ?? (isExample ? EXAMPLE_POLL_INTERVAL_MS : undefined);
  const environment = useMemo(() => ({
    port, context, navigate, clock: clock ?? (() => new Date()), example: isExample,
    ...(visibility ? { visibility } : {}), ...(interval ? { pollIntervalMs: interval } : {}),
  }), [port, context, navigate, clock, visibility, interval, isExample]);
  return (
    <WorkbenchEnvironmentProvider value={environment}>
      <SectionBody destination={destination} />
    </WorkbenchEnvironmentProvider>
  );
}

function SectionBody({ destination }: { readonly destination: string }) {
  const { port, session, navigate } = useWorkbench();
  const page = parseWorkbenchDestination(destination);

  useEffect(() => {
    // A content-class read of the workspace; never an execution call.
    if (session.getState().workspace.status === 'idle') void session.load(port);
  }, [port, session]);

  // Inside the Social domain the page header's sync pill carries freshness and the limits; mounted on its own, the
  // section shows them itself.
  const framed = useSocialFrame() !== null;
  return (
    <div className="sw-section">
      {!framed && <p className="sw-limits" role="note"><b>Delivered limits</b> {DELIVERED_LIMITS}</p>}
      {!framed && <ServiceStatus />}
      {page === null ? (
        <StateView
          state="unavailable" title="This Social page doesn't exist"
          description={`"${destination}" is not a workbench or run destination.`}
          action={{ label: 'Open workbenches', onAction: () => navigate('workbenches') }}
        />
      ) : page.page === 'catalog' ? <Catalog />
        : page.page === 'tool' ? <ToolWorkbench key={page.tool} tool={page.tool} />
          : <RunHistory selectedRunId={page.page === 'run' ? page.runId : null} />}
    </div>
  );
}

/** Freshness of the workspace read (RX-5). An unreachable service never renders as current. */
function ServiceStatus() {
  const { port, session, state } = useWorkbench();
  const load = state.workspace;
  const last = workspaceSnapshot(load);
  if (load.status === 'error') {
    return (
      <div className="sw-service sw-service--down" role="status">
        <StatusChip tone="unavailable" label="Social service unreachable" detail={last ? `last synced ${formatTime(last.observedAt)}` : 'never synced'} />
        <span>Runs pause until it answers. Checking again never resends a run.</span>
        <Button size="sm" onClick={() => void session.load(port)}>Check again</Button>
      </div>
    );
  }
  if (!last) return null;
  return (
    <div className="sw-service" role="status">
      <StatusChip tone={load.status === 'loading' ? 'info' : 'success'} label={load.status === 'loading' ? 'Refreshing' : 'Synced'} detail={`observed ${formatTime(last.observedAt)}`} />
    </div>
  );
}
