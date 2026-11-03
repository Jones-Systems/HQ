import { Button, StateView, StatusChip } from '@hq/ui';
import { possibleRunMatches, workspaceSnapshot, type ToolId } from '../core';
import { useWorkbench } from './env';
import { RUN_STATUS_VIEW, formatTime, shortId } from './format';
import type { Attempt } from './state';

/**
 * RR-5: a lost Run response. The outcome stays unknown; runs created since the attempt are listed as
 * possible matches only, because the service has no request identity. Nothing is resubmitted.
 */
export function UnknownOutcome({ tool, toolName, attempt }: { readonly tool: ToolId; readonly toolName: string; readonly attempt: Extract<Attempt, { status: 'unknown' }> }) {
  const { port, session, state, navigate } = useWorkbench();
  const snapshot = workspaceSnapshot(state.workspace);
  const matches = snapshot ? possibleRunMatches(snapshot.runs, { tool, isExample: attempt.isExample, attemptedAt: attempt.attemptedAt, ...(attempt.knownRunIds ? { knownRunIds: attempt.knownRunIds } : {}) }) : [];
  const checking = state.workspace.status === 'loading';
  return (
    <div className="sw-unknown-outcome">
      <StateView
        state="unknown" title="Outcome unknown"
        description={`HQ sent this ${toolName} run at ${formatTime(attempt.attemptedAt)}, but the response was lost. The Social service may or may not have created it. HQ will not send it again.`}
      />
      <section aria-labelledby="sw-matches-title" className="sw-matches">
        <h3 id="sw-matches-title">Possible matches</h3>
        <p className="sw-hint">
          {toolName} runs{attempt.isExample ? ' labeled example' : ''} that appeared since the attempt. The service has no request ID, so none of them is proved to be yours.
          {snapshot ? ` Run list observed ${formatTime(snapshot.observedAt)}.` : ''}
        </p>
        {!snapshot ? <p className="sw-note">Run history isn't available yet.</p>
          : matches.length === 0 ? <p className="sw-note">No new {toolName} runs found yet.</p>
            : (
              <ul className="sw-match-list">
                {matches.map((run) => (
                  <li key={run.id} className="sw-match">
                    <span className="sw-mono">{shortId(run.id)}</span>
                    <span>{formatTime(run.created_at)}</span>
                    <StatusChip tone={RUN_STATUS_VIEW[run.status].tone} label={RUN_STATUS_VIEW[run.status].label} />
                    <Button size="sm" variant="ghost" onClick={() => navigate(`runs/${run.id}`)} aria-label={`Open receipt ${shortId(run.id)}`}>Open receipt</Button>
                  </li>
                ))}
              </ul>
            )}
        <Button size="sm" busy={checking} busyLabel="Checking" onClick={() => void session.load(port)}>Check run history again</Button>
      </section>
    </div>
  );
}
