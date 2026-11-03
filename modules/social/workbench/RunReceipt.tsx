import { useEffect, useRef, useState } from 'react';
import { Button, StateView, StatusChip } from '@hq/ui';
import { isActiveRun, portErrorOf, workspaceSnapshot, type ObservedRunStatus, type PortError, type RunRecord } from '../core';
import { useWorkbench } from './env';
import { RUN_STATUS_VIEW, formatTime, shortId } from './format';
import { watchRun } from './polling';
import { summarizeRun, type ResultSummary } from './results';
import { StartDraft } from './StartDraft';

interface Observation {
  readonly run: RunRecord | null;
  /** The last read failed; an active run's status is then unknown. */
  readonly readError: PortError | null;
}

function downloadReceipt(run: RunRecord): void {
  if (typeof URL.createObjectURL !== 'function') return;
  const url = URL.createObjectURL(new Blob([JSON.stringify(run, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `social-run-${run.id}.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * One run's receipt (RR-4). Its status is read with `run(id)` while the run is active and the page is
 * visible; reads stop when the run finishes, the page hides or the receipt closes.
 */
export function RunReceipt({ runId, initial, readNow = false }: {
  readonly runId: string;
  readonly initial?: RunRecord | null;
  /** Read the run at once instead of after one interval, for a record taken from an older list. */
  readonly readNow?: boolean;
}) {
  const { port, session, state, visibility, pollIntervalMs } = useWorkbench();
  const [observation, setObservation] = useState<Observation>({ run: initial ?? null, readError: null });
  const [watchKey, setWatchKey] = useState(0);
  const refreshed = useRef(false);

  useEffect(() => {
    const start = !readNow && observation.run && isActiveRun(observation.run) ? observation.run : null;
    // Terminal runs from a list carry no output; one read fetches it.
    if (observation.run && !isActiveRun(observation.run) && observation.run.output !== undefined) return undefined;
    return watchRun(runId, start, {
      load: (id) => port.run(id),
      onRecord: (run) => {
        setObservation({ run, readError: null });
        if (!isActiveRun(run) && !refreshed.current) {
          refreshed.current = true;
          // The run list changed; refresh it with a content read.
          void session.load(port);
        }
      },
      onError: (reason) => setObservation((current) => ({ ...current, readError: portErrorOf(reason) ?? { kind: 'unavailable' } })),
      ...(visibility ? { visibility } : {}),
      ...(pollIntervalMs ? { intervalMs: pollIntervalMs } : {}),
    });
    // The watch restarts only for another run or an explicit Check again.
  }, [runId, port, watchKey]);

  const run = observation.run;
  const toolName = (id: string) => workspaceSnapshot(state.workspace)?.tools.find((tool) => tool.id === id)?.name ?? id;

  if (!run) {
    if (observation.readError) {
      const missing = observation.readError.kind === 'not_found';
      return (
        <StateView
          state={missing ? 'unavailable' : 'unknown'} title={missing ? 'Run not found' : 'Receipt unavailable'}
          description={missing ? `The Social service has no run ${shortId(runId)}.` : 'The Social service did not answer. Nothing was resent.'}
          {...(missing ? {} : { action: { label: 'Check again', onAction: () => { setObservation({ run: null, readError: null }); setWatchKey((key) => key + 1); } } })}
        />
      );
    }
    return <StateView state="loading" title="Loading the receipt" />;
  }

  const unknown = observation.readError !== null && isActiveRun(run);
  const status: ObservedRunStatus = unknown ? 'unknown' : run.status;
  const view = RUN_STATUS_VIEW[status];
  const summary = summarizeRun(run);
  return (
    <article className="sw-receipt" aria-labelledby={`sw-receipt-${run.id}`}>
      <header className="sw-receipt-head">
        <p className="sw-eyebrow">Run receipt · {shortId(run.id)}</p>
        <h3 id={`sw-receipt-${run.id}`}>{toolName(run.tool)}</h3>
        <div className="sw-chips-row">
          <StatusChip tone={view.tone} label={view.label} />
          {run.is_example === 1 && <StatusChip tone="neutral" label="Example data" detail="synthetic" />}
        </div>
      </header>
      <dl className="sw-facts">
        <div><dt>Run ID</dt><dd className="sw-mono">{run.id}</dd></div>
        <div><dt>Created</dt><dd>{formatTime(run.created_at)}</dd></div>
        <div><dt>Finished</dt><dd>{formatTime(run.finished_at)}</dd></div>
        <div><dt>Basis</dt><dd>{run.is_example ? 'Example input · synthetic, not evidence' : 'Material you supplied'} · local Social service, network off</dd></div>
      </dl>
      {unknown && (
        <div className="sw-unknown" role="status">
          <p><b>Status unknown.</b> The Social service didn't answer. It was last seen {RUN_STATUS_VIEW[run.status].label.toLowerCase()}. Don't start it again until the status is known.</p>
          <Button size="sm" onClick={() => { setObservation((current) => ({ ...current, readError: null })); setWatchKey((key) => key + 1); }}>Check again</Button>
        </div>
      )}
      {!unknown && isActiveRun(run) && <p className="sw-note" role="status">Working through the local queue. The status is checked every few seconds while this page is visible.</p>}
      {run.error && <p className="sw-error" role="alert">{run.error}</p>}
      {summary && <ResultView summary={summary} />}
      {(run.output !== undefined || !isActiveRun(run)) && (
        <div className="sw-actions">
          <Button size="sm" onClick={() => downloadReceipt(run)}>Download receipt</Button>
        </div>
      )}
      {run.output !== undefined && (
        <details className="sw-raw">
          <summary>Raw result JSON</summary>
          <pre className="sw-mono">{JSON.stringify(run.output, null, 2)}</pre>
        </details>
      )}
      {run.status === 'succeeded' && summary?.kind === 'result' && <StartDraft run={run} toolName={toolName(run.tool)} summary={summary} />}
    </article>
  );
}

export function ResultView({ summary }: { readonly summary: ResultSummary }) {
  return (
    <section className={`sw-result sw-result--${summary.kind}`} aria-label="Result summary">
      <h4>{summary.heading}</h4>
      {summary.error && <p className="sw-error">{summary.error}</p>}
      {summary.notices.map((notice) => <p key={notice} className="sw-note">{notice}</p>)}
      {summary.facts.length > 0 && (
        <dl className="sw-facts">
          {summary.facts.map((fact) => <div key={fact.label}><dt>{fact.label}</dt><dd>{fact.value}</dd></div>)}
        </dl>
      )}
      {summary.draftText && summary.entries.length === 0 && <pre className="sw-draft-text">{summary.draftText}</pre>}
      {summary.entries.length > 0 && (
        <ul className="sw-entries">
          {summary.entries.map((entry, index) => (
            <li key={index} className="sw-entry">
              <div className="sw-entry-head">
                <b>{entry.title}</b>
                {entry.status && <StatusChip tone={entry.status.tone} label={entry.status.label} />}
              </div>
              {entry.detail && <p>{entry.detail}</p>}
              {entry.meta && <p className="sw-hint">{entry.meta}</p>}
            </li>
          ))}
        </ul>
      )}
      {summary.more > 0 && <p className="sw-hint">{summary.more} more in the raw result and the receipt download.</p>}
    </section>
  );
}
