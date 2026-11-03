import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Button, StateView, StatusIndicator, useListMotion, usePresence } from '@hq/ui';
import { TOOL_IDS, isActiveRun, isToolId, workspaceSnapshot, type ObservedRunStatus, type RunRecord, type ToolId } from '../core';
import { EmptyState, PageHeader, SocialIcon, useSocialFrame, type SocialIconName } from '../ui';
import { useWorkbench } from './env';
import { RUN_STATUS_VIEW, formatTime, shortId } from './format';
import { RunReceipt } from './RunReceipt';
import { groupRunsByDay, runDuration, timeOfDay } from './run-history';
import { updateWorkbench, workbenchView } from './state';
import './run-history.css';

const GLYPHS: { readonly [S in ObservedRunStatus]: SocialIconName } = {
  queued: 'clock', running: 'play', succeeded: 'check', failed: 'close', interrupted: 'alert', unknown: 'info',
};
/** How long a run that arrived since the page was read keeps its colour wash. */
const FRESH_MS = 2400;

/**
 * RR-4: the latest 200 runs as a timeline grouped by day, newest first, with a receipt that opens beside the list
 * (over it at narrow widths). Opening a receipt is navigation only. When the service is unreachable, runs last seen
 * active show Unknown and never offer a second run. A run is only ever created by an explicit Run in a workbench.
 */
export function RunHistory({ selectedRunId }: { readonly selectedRunId: string | null }) {
  const { port, session, state, navigate, clock } = useWorkbench();
  const framed = useSocialFrame() !== null;
  const load = state.workspace;
  const snapshot = workspaceSnapshot(load);
  const filter = workbenchView(state).historyTool;
  const stale = load.status === 'error';
  const toolName = (id: ToolId) => snapshot?.tools.find((tool) => tool.id === id)?.name ?? id;
  const runs = snapshot ? snapshot.runs.filter((run) => filter === 'all' || run.tool === filter) : [];
  const observed = (run: RunRecord): ObservedRunStatus => (stale && isActiveRun(run) ? 'unknown' : run.status);
  const groups = groupRunsByDay(runs, clock());
  const timeline = useListMotion<HTMLDivElement>(runs.map((run) => run.id));

  // The panel keeps the last receipt while it slides out.
  const shown = useRef(selectedRunId);
  if (selectedRunId) shown.current = selectedRunId;
  const panel = usePresence<HTMLElement>(selectedRunId !== null, { motion: 'slide-end' });
  const panelRun = snapshot?.runs.find((run) => run.id === shown.current) ?? null;

  const rowFor = (id: string) => [...(timeline.current?.querySelectorAll<HTMLElement>('[data-run-row]') ?? [])].find((row) => row.dataset.runRow === id);
  const [roving, setRoving] = useState<string | null>(null);
  const tabbable = runs.some((run) => run.id === roving) ? roving : runs.some((run) => run.id === selectedRunId) ? selectedRunId : runs[0]?.id ?? null;

  // Close, or Escape, returns to the list and puts focus back on the row that was open. Navigating elsewhere does not steal focus.
  const closing = useRef(false);
  const close = () => { closing.current = true; navigate('runs'); };
  useEffect(() => {
    if (selectedRunId !== null || !closing.current) return;
    closing.current = false;
    if (shown.current) rowFor(shown.current)?.focus();
  }, [selectedRunId]);
  // Escape closes the receipt from anywhere on the page, including after a click on its text left nothing focused.
  useEffect(() => {
    if (selectedRunId === null) return undefined;
    const onEscape = (event: globalThis.KeyboardEvent) => { if (event.key === 'Escape' && !event.defaultPrevented) { event.preventDefault(); close(); } };
    document.addEventListener('keydown', onEscape);
    return () => document.removeEventListener('keydown', onEscape);
  }, [selectedRunId]);

  // Runs that arrive after the first read slide in at the top and wash with colour; the first read is not news.
  const seen = useRef<Set<string> | null>(null);
  const [fresh, setFresh] = useState<ReadonlySet<string>>(() => new Set());
  const freshTimer = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (!snapshot) return;
    const ids = snapshot.runs.map((run) => run.id);
    if (seen.current === null) { seen.current = new Set(ids); return; }
    const added = ids.filter((id) => !seen.current!.has(id));
    for (const id of added) seen.current.add(id);
    if (added.length === 0) return;
    setFresh(new Set(added));
    window.clearTimeout(freshTimer.current);
    freshTimer.current = window.setTimeout(() => setFresh(new Set()), FRESH_MS);
  }, [snapshot]);
  useEffect(() => () => window.clearTimeout(freshTimer.current), []);

  const onListKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const rows = [...event.currentTarget.querySelectorAll<HTMLElement>('[data-run-row]')];
    const index = rows.indexOf(document.activeElement as HTMLElement);
    if (index < 0) return;
    const next = event.key === 'ArrowDown' ? index + 1 : event.key === 'ArrowUp' ? index - 1 : event.key === 'Home' ? 0 : event.key === 'End' ? rows.length - 1 : null;
    if (next === null) return;
    event.preventDefault();
    rows[Math.max(0, Math.min(rows.length - 1, next))]?.focus();
  };

  return (
    <section className="rh" aria-labelledby="sw-runs-title">
      <PageHeader
        headingId="sw-runs-title" title="Run history"
        description="Receipts for the latest 200 runs, newest first. Failed and interrupted runs stay visible; nothing is retried automatically."
      >
        <div className="rh-toolbar">
          <label className="rh-filter">
            <span>Tool</span>
            <select id="sw-history-tool" value={filter}
              onChange={(event) => updateWorkbench(session, (view) => ({ ...view, historyTool: isToolId(event.target.value) ? event.target.value : 'all' }))}>
              <option value="all">All tools</option>
              {TOOL_IDS.map((id) => <option key={id} value={id}>{toolName(id)}</option>)}
            </select>
          </label>
          <Button size="sm" busy={load.status === 'loading'} busyLabel="Refreshing" onClick={() => void session.load(port)}>Refresh</Button>
          {!framed && snapshot && <span className="rh-hint">{stale ? 'Last list observed' : 'Observed'} {formatTime(snapshot.observedAt)}</span>}
        </div>
      </PageHeader>
      {!snapshot ? (
        load.status === 'error'
          ? <StateView state="unavailable" title="Run history isn't available" description="The Social service didn't answer. Nothing was resent." action={{ label: 'Try again', onAction: () => void session.load(port) }} />
          : <StateView state="loading" title="Loading run history" />
      ) : (
        <div className="rh-layout" data-panel={selectedRunId ? 'open' : undefined}>
          <div className="rh-list" onKeyDown={onListKey}>
            {runs.length === 0 ? (
              <div className="sx-panel">
                <EmptyState
                  icon="runs" title={filter === 'all' ? 'No runs yet' : `No ${toolName(filter)} runs`}
                  action={<Button variant="secondary" onClick={() => navigate('workbenches')}>Open workbenches</Button>}
                >
                  Open a workbench and run your own input or a labeled example.
                </EmptyState>
              </div>
            ) : (
              <div className="rh-timeline" ref={timeline}>
                {groups.map((group) => (
                  <section key={group.key} className="rh-day" aria-labelledby={`rh-day-${group.key}`}>
                    <h2 id={`rh-day-${group.key}`} className="rh-day-title">{group.label}<span className="rh-count">{group.runs.length}</span></h2>
                    <ol className="rh-runs">
                      {group.runs.map((run) => {
                        const status = observed(run);
                        const view = RUN_STATUS_VIEW[status];
                        const duration = runDuration(run);
                        const detail = status === 'unknown' ? `last seen ${run.status}` : run.error ?? (status === 'succeeded' ? duration ?? undefined : undefined);
                        return (
                          <li key={run.id} className="rh-item" data-hq-motion-key={run.id}>
                            <button
                              type="button" className={fresh.has(run.id) ? 'rh-row hq-flash' : 'rh-row'} data-run-row={run.id} data-status={status}
                              aria-current={run.id === selectedRunId ? 'true' : undefined} tabIndex={run.id === tabbable ? 0 : -1}
                              aria-label={`Open receipt ${shortId(run.id)}: ${toolName(run.tool)}, ${view.label}, ${timeOfDay(run.created_at)}${run.error ? `. ${run.error}` : ''}`}
                              title={run.error ?? undefined} onFocus={() => setRoving(run.id)} onClick={() => navigate(`runs/${run.id}`)}
                            >
                              <span className="rh-glyph" data-state={status} aria-hidden="true"><SocialIcon name={GLYPHS[status]} /></span>
                              <span className="rh-main">
                                <span className="rh-title">
                                  <b>{toolName(run.tool)}</b>
                                  <span className="rh-id">{shortId(run.id)}</span>
                                  {run.is_example === 1 && <span className="sx-tag sx-tag--example">Example data</span>}
                                </span>
                                <span className="rh-sub">
                                  <StatusIndicator className="rh-status" tone={view.tone} label={view.label} detail={detail} live={false} />
                                  {status === 'unknown' && <span className="rh-hint">Don't start it again until the status is known.</span>}
                                </span>
                              </span>
                              <time className="rh-time" dateTime={run.created_at} title={formatTime(run.created_at)}>{timeOfDay(run.created_at)}</time>
                            </button>
                          </li>
                        );
                      })}
                    </ol>
                  </section>
                ))}
              </div>
            )}
          </div>
          {panel.mounted && (
            <>
              {selectedRunId && <button type="button" className="rh-scrim" tabIndex={-1} aria-hidden="true" onClick={close} />}
              <aside ref={panel.ref} {...panel.props} className="rh-peek" aria-label="Selected receipt" inert={selectedRunId ? undefined : true}>
                {shown.current && (
                  <RunReceipt
                    key={shown.current} runId={shown.current} readNow initial={panelRun}
                    headerEnd={<Button size="sm" variant="ghost" className="rh-close" onClick={close} aria-label="Close receipt" title="Close receipt (Esc)"><SocialIcon name="close" /></Button>}
                  />
                )}
                {panelRun && (
                  <ReceiptAction
                    run={panelRun} status={observed(panelRun)} toolName={toolName(panelRun.tool)}
                    onOpenTool={() => navigate(`workbenches/${panelRun.tool}`)}
                  />
                )}
              </aside>
            </>
          )}
        </div>
      )}
    </section>
  );
}

/**
 * What can follow a receipt: the workbench it came from. HQ never sends a run on its own and the service does not
 * return what a run was given, so running it again is a choice made in the workbench, with the input checked there.
 * A run whose status is unknown, or that is still active, never points at a second run.
 */
function ReceiptAction({ run, status, toolName, onOpenTool }: {
  readonly run: RunRecord; readonly status: ObservedRunStatus; readonly toolName: string; readonly onOpenTool: () => void;
}) {
  if (status === 'unknown') {
    return <p className="rh-again-note">Don't start it again until the status is known. Use Check again on the receipt, or Refresh the list.</p>;
  }
  if (isActiveRun(run)) return null;
  return (
    <section className="rh-again" aria-label="Open the workbench">
      <Button size="sm" variant="secondary" onClick={onOpenTool}>Open {/workbench$/iu.test(toolName) ? toolName : `${toolName} workbench`}<SocialIcon name="arrow-right" /></Button>
      <p className="rh-again-note">To run it again, open the workbench, check the input and choose Run. HQ never resends a run on its own.</p>
    </section>
  );
}
