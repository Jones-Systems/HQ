import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Button, InlineNotice, StateView, prefersReducedMotion, useToast } from '@hq/ui';
import { isActiveRun, portErrorOf, workspaceSnapshot, type ObservedRunStatus, type PortError, type RunRecord } from '../core';
import { SocialIcon } from '../ui';
import { useWorkbench } from './env';
import { formatTime, shortId } from './format';
import { watchRun } from './polling';
import { ReceiptId, SUCCESS_TOAST_MS } from './ReceiptId';
import { ResultView } from './ResultView';
import { summarizeRun } from './results';
import { RunIdFact } from './RunId';
import { RunStepper } from './RunStepper';
import { WAITS_HERE, WAITS_HERE_DETAIL, openSocialSetup } from './setup';
import { StartDraft } from './StartDraft';

export { ResultView } from './ResultView';

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

const ACTIVE_NOTE = { queued: 'Queued: waiting its turn in the local queue.', running: 'Running: working through the local queue.' } as const;

/**
 * One run's receipt (RR-4). Its status is read with `run(id)` while the run is active and the page is
 * visible; reads stop when the run finishes, the page hides or the receipt closes. A run that finishes while
 * the receipt is open raises one toast, with a way to jump to its results; a receipt opened on a finished run raises none.
 */
export function RunReceipt({ runId, initial, readNow = false, headerEnd }: {
  readonly runId: string;
  readonly initial?: RunRecord | null;
  /** Read the run at once instead of after one interval, for a record taken from an older list. */
  readonly readNow?: boolean;
  /** A control for the header's far end, for example Close in a side panel. */
  readonly headerEnd?: ReactNode;
}) {
  const { port, session, state, visibility, pollIntervalMs, example } = useWorkbench();
  const toast = useToast();
  const [observation, setObservation] = useState<Observation>({ run: initial ?? null, readError: null });
  const [watchKey, setWatchKey] = useState(0);
  const refreshed = useRef(false);
  /** The last status read was active, so a terminal read is a finish this receipt watched. */
  const wasActive = useRef(initial ? isActiveRun(initial) : false);
  const article = useRef<HTMLElement>(null);
  const toolName = (id: string) => workspaceSnapshot(state.workspace)?.tools.find((tool) => tool.id === id)?.name ?? id;
  const names = useRef(toolName);
  names.current = toolName;

  useEffect(() => {
    const start = !readNow && observation.run && isActiveRun(observation.run) ? observation.run : null;
    // Terminal runs from a list carry no output; one read fetches it.
    if (observation.run && !isActiveRun(observation.run) && observation.run.output !== undefined) return undefined;
    return watchRun(runId, start, {
      load: (id) => port.run(id),
      onRecord: (run) => {
        setObservation({ run, readError: null });
        if (!isActiveRun(run) && wasActive.current) announceFinish(run);
        wasActive.current = isActiveRun(run);
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

  const showResults = () => {
    const target = article.current;
    target?.scrollIntoView?.({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'start' });
    target?.querySelector<HTMLElement>('.sw-result h4')?.focus();
  };

  function announceFinish(run: RunRecord) {
    const name = names.current(run.tool);
    const id = `run-finished:${run.id}`;
    if (run.status === 'succeeded') {
      toast.success(`${name} finished`, {
        id, description: run.is_example ? 'Example data: fictional results.' : 'Results are ready.', meta: `receipt ${shortId(run.id)}`,
        action: { label: 'View results', onAction: showResults }, duration: SUCCESS_TOAST_MS,
      });
    } else if (run.status === 'failed') {
      toast.error(`${name} run failed`, { id, description: run.error ?? 'No error was recorded.', meta: `receipt ${shortId(run.id)} · not retried` });
    } else {
      toast.warning(`${name} run was interrupted`, { id, description: 'Run it again when you are ready. Nothing was retried.', meta: `receipt ${shortId(run.id)}` });
    }
  }

  const run = observation.run;
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

  const active = isActiveRun(run);
  const unknown = observation.readError !== null && active;
  const status: ObservedRunStatus = unknown ? 'unknown' : run.status;
  const summary = summarizeRun(run);
  const waitsHere = example && !run.is_example && run.status === 'queued' && !unknown;
  const name = toolName(run.tool);
  return (
    <article className="sw-receipt" aria-labelledby={`sw-receipt-${run.id}`} ref={article}>
      <header className="sw-receipt-head">
        <div className="sw-receipt-title">
          <p className="sw-eyebrow">Run receipt</p>
          <h3 id={`sw-receipt-${run.id}`}>{name}</h3>
        </div>
        <div className="sw-receipt-tags">
          {run.is_example === 1 && <span className="sx-tag sx-tag--example" title="Fictional sample input, not evidence about your brand">Example data</span>}
          <ReceiptId id={run.id} />
        </div>
        {headerEnd && <div className="sw-receipt-head-end">{headerEnd}</div>}
      </header>
      <RunStepper status={status} lastSeen={run.status} />
      {unknown && (
        <div className="sw-unknown" role="status">
          <p><b>Status unknown.</b> The Social service didn't answer. It was last seen {run.status}. Don't start it again until the status is known.</p>
          <Button size="sm" onClick={() => { setObservation((current) => ({ ...current, readError: null })); setWatchKey((key) => key + 1); }}>Check again</Button>
        </div>
      )}
      {waitsHere ? (
        <InlineNotice tone="info" title={WAITS_HERE} live="off" actions={[{ label: 'Set up Social service', onAction: openSocialSetup }]}>
          {WAITS_HERE_DETAIL}
        </InlineNotice>
      ) : !unknown && active && (
        <p className="sw-note" role="status">
          {ACTIVE_NOTE[run.status === 'running' ? 'running' : 'queued']} The status is checked every few seconds while this page is visible.
        </p>
      )}
      {run.error && run.error !== summary?.error && <p className="sw-error">{run.error}</p>}
      <dl className="sw-facts">
        <RunIdFact id={run.id} />
        <div><dt>Created</dt><dd>{formatTime(run.created_at)}</dd></div>
        <div><dt>Finished</dt><dd>{formatTime(run.finished_at)}</dd></div>
        <div><dt>Basis</dt><dd>{run.is_example ? 'Example input · synthetic, not evidence' : 'Material you supplied'} · local Social service, network off</dd></div>
      </dl>
      {summary && <ResultView summary={summary} />}
      {(run.status === 'succeeded' && summary?.kind === 'result') || run.output !== undefined || !active ? (
        <div className="sw-actions sw-receipt-actions">
          {run.status === 'succeeded' && summary?.kind === 'result' && <StartDraft run={run} toolName={name} summary={summary} />}
          {(run.output !== undefined || !active) && (
            <Button size="sm" onClick={() => downloadReceipt(run)}><SocialIcon name="file" />Download receipt</Button>
          )}
        </div>
      ) : null}
      {run.output !== undefined && (
        <details className="sw-raw">
          <summary>Raw result JSON</summary>
          <pre className="sw-mono">{JSON.stringify(run.output, null, 2)}</pre>
        </details>
      )}
    </article>
  );
}
