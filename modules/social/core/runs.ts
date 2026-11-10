import { ACTIVE_RUN_STATUSES, portErrorOf, type PortError, type RunRecord, type SocialWorkspacePort, type ToolId } from './port';

export type SubmitOutcome =
  | { readonly kind: 'accepted'; readonly run: RunRecord }
  /** The service may or may not have created a run. Reconcile; never resubmit automatically. */
  | { readonly kind: 'unknown'; readonly attemptedAt: string }
  | { readonly kind: 'rejected'; readonly error: Exclude<PortError, { kind: 'unknown' }> };

/**
 * Submits exactly once, from an explicit Run action only. Any rejection that is not a
 * definite service answer is reported as unknown, never as failure or success.
 */
export async function submitRunOnce(
  port: SocialWorkspacePort, tool: ToolId, input: Record<string, unknown>, isExample: boolean,
  now: () => string = () => new Date().toISOString(),
): Promise<SubmitOutcome> {
  const attemptedAt = now();
  try {
    return { kind: 'accepted', run: await port.submitRun(tool, input, isExample) };
  } catch (reason) {
    const error = portErrorOf(reason);
    if (!error) return { kind: 'unknown', attemptedAt };
    if (error.kind === 'unknown') return { kind: 'unknown', attemptedAt: error.attemptedAt };
    return { kind: 'rejected', error };
  }
}

/**
 * Runs that may be the outcome of an unknown submission: same tool and example flag, and
 * new since the attempt. Prefer `knownRunIds` (the run IDs seen before submitting), which
 * avoids comparing the client clock with the service clock; otherwise compare `created_at`.
 * The service has no request identity, so a match is never proved; show these as possible only.
 */
export function possibleRunMatches(
  runs: readonly RunRecord[],
  attempt: { readonly tool: ToolId; readonly isExample: boolean; readonly attemptedAt: string; readonly knownRunIds?: Iterable<string> },
): RunRecord[] {
  const known = attempt.knownRunIds ? new Set(attempt.knownRunIds) : null;
  const since = Date.parse(attempt.attemptedAt);
  return runs.filter((run) => run.tool === attempt.tool && run.is_example === (attempt.isExample ? 1 : 0)
    && (known ? !known.has(run.id) : Number.isFinite(since) && Date.parse(run.created_at) >= since));
}

export function isActiveRun(run: Pick<RunRecord, 'status'>): boolean {
  return ACTIVE_RUN_STATUSES.includes(run.status);
}
