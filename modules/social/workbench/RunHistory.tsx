import { Button, StateView, StatusChip } from '@hq/ui';
import { TOOL_IDS, isActiveRun, isToolId, workspaceSnapshot, type ObservedRunStatus, type ToolId } from '../core';
import { useWorkbench } from './env';
import { RUN_STATUS_VIEW, formatTime, shortId } from './format';
import { RunReceipt } from './RunReceipt';
import { updateWorkbench, workbenchView } from './state';

/**
 * RR-4: the latest 200 runs, newest first, with times, errors and example labels. Opening a receipt is
 * navigation only. When the service is unreachable, runs last seen active show Unknown.
 */
export function RunHistory({ selectedRunId }: { readonly selectedRunId: string | null }) {
  const { port, session, state, navigate } = useWorkbench();
  const load = state.workspace;
  const snapshot = workspaceSnapshot(load);
  const filter = workbenchView(state).historyTool;
  const stale = load.status === 'error';
  const toolName = (id: ToolId) => snapshot?.tools.find((tool) => tool.id === id)?.name ?? id;
  const runs = snapshot ? snapshot.runs.filter((run) => filter === 'all' || run.tool === filter) : [];

  return (
    <section className="sw-page" aria-labelledby="sw-runs-title">
      <header className="sw-page-head">
        <p className="sw-eyebrow">Social · Run history</p>
        <h1 id="sw-runs-title">Run history</h1>
        <p>Receipts for the latest 200 runs, newest first. Failed and interrupted runs stay visible; nothing is retried automatically.</p>
      </header>
      <div className="sw-toolbar">
        <label className="sw-label" htmlFor="sw-history-tool">Tool</label>
        <select
          id="sw-history-tool" className="sw-input sw-input--inline" value={filter}
          onChange={(event) => updateWorkbench(session, (view) => ({ ...view, historyTool: isToolId(event.target.value) ? event.target.value : 'all' }))}
        >
          <option value="all">All tools</option>
          {TOOL_IDS.map((id) => <option key={id} value={id}>{toolName(id)}</option>)}
        </select>
        <Button size="sm" busy={load.status === 'loading'} busyLabel="Refreshing" onClick={() => void session.load(port)}>Refresh</Button>
        {snapshot && <span className="sw-hint">{stale ? 'Last list observed' : 'Observed'} {formatTime(snapshot.observedAt)}</span>}
      </div>
      {!snapshot ? (
        load.status === 'error'
          ? <StateView state="unavailable" title="Run history isn't available" description="The Social service didn't answer. Nothing was resent." action={{ label: 'Try again', onAction: () => void session.load(port) }} />
          : <StateView state="loading" title="Loading run history" />
      ) : runs.length === 0 ? (
        <StateView
          state="empty" title={filter === 'all' ? 'No runs yet' : `No ${toolName(filter)} runs`}
          description="Open a workbench and run your own input or a labeled example."
          action={{ label: 'Open workbenches', onAction: () => navigate('workbenches') }}
        />
      ) : (
        <table className="sw-table">
          <caption className="hq-sr-only">Runs, newest first</caption>
          <thead>
            <tr><th scope="col">Tool</th><th scope="col">Status</th><th scope="col">Created</th><th scope="col">Finished</th><th scope="col">Notes</th><th scope="col"><span className="hq-sr-only">Receipt</span></th></tr>
          </thead>
          <tbody>
            {runs.map((run) => {
              const status: ObservedRunStatus = stale && isActiveRun(run) ? 'unknown' : run.status;
              const view = RUN_STATUS_VIEW[status];
              const selected = run.id === selectedRunId;
              return (
                <tr key={run.id} aria-current={selected ? 'true' : undefined} className={selected ? 'sw-row-selected' : undefined}>
                  <th scope="row">{toolName(run.tool)} <span className="sw-mono sw-hint">{shortId(run.id)}</span></th>
                  <td><StatusChip tone={view.tone} label={view.label} {...(status === 'unknown' ? { detail: `last seen ${run.status}` } : {})} /></td>
                  <td>{formatTime(run.created_at)}</td>
                  <td>{formatTime(run.finished_at)}</td>
                  <td>
                    {run.is_example === 1 && <StatusChip tone="neutral" label="Example data" />}
                    {status === 'unknown' && <span className="sw-hint"> Don't start it again until the status is known.</span>}
                    {run.error && <span className="sw-row-error">{run.error}</span>}
                  </td>
                  <td><Button size="sm" variant="ghost" onClick={() => navigate(`runs/${run.id}`)} aria-label={`Open receipt ${shortId(run.id)}`}>Open</Button></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {selectedRunId && (
        <section className="sw-panel" aria-label="Selected receipt">
          <RunReceipt key={selectedRunId} runId={selectedRunId} readNow initial={snapshot?.runs.find((run) => run.id === selectedRunId) ?? null} />
        </section>
      )}
    </section>
  );
}
