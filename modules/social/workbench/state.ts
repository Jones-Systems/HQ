import {
  submitRunOnce, workspaceSnapshot,
  type PortError, type RunRecord, type SocialSession, type SocialSessionState, type SocialWorkspacePort, type ToolId,
} from '../core';
import { emptyForm, type ToolForm } from './inputs';

/**
 * Workbench UI state. It lives in the Social session's page view state, so form input, imports and the
 * last attempt survive the shell remounting the module on a domain switch.
 */

export interface ToolDraft {
  readonly mode: 'form' | 'json';
  readonly form: ToolForm;
  /** Advanced JSON text. It is the submitted input while `mode` is `json`. */
  readonly json: string;
  /** Why the JSON could not be shown as a form, if it could not. */
  readonly jsonNote?: string;
  /** `loaded`: an unedited service example, submitted with the example flag. Any edit makes it `edited`. */
  readonly example: 'none' | 'loaded' | 'edited';
  /** The exact example object, submitted unchanged while `example` is `loaded`. */
  readonly exampleInput?: Record<string, unknown>;
  /** Show form problems; set by a Run attempt that was blocked. */
  readonly showProblems: boolean;
}

export type Attempt =
  | { readonly status: 'submitting'; readonly isExample: boolean }
  | { readonly status: 'accepted'; readonly run: RunRecord }
  /** The response was lost. The service may or may not have created a run; nothing resubmits it. */
  | { readonly status: 'unknown'; readonly isExample: boolean; readonly attemptedAt: string; readonly knownRunIds?: readonly string[] }
  | { readonly status: 'rejected'; readonly error: Exclude<PortError, { kind: 'unknown' }> };

export interface WorkbenchView {
  readonly drafts: { readonly [T in ToolId]?: ToolDraft };
  readonly attempts: { readonly [T in ToolId]?: Attempt };
  readonly historyTool: ToolId | 'all';
}

const VIEW_KEY = 'workbench';
const EMPTY_VIEW: WorkbenchView = { drafts: {}, attempts: {}, historyTool: 'all' };

export function workbenchView(state: SocialSessionState): WorkbenchView {
  return (state.view[VIEW_KEY] as WorkbenchView | undefined) ?? EMPTY_VIEW;
}

export function updateWorkbench(session: SocialSession, update: (view: WorkbenchView) => WorkbenchView): void {
  session.setView(VIEW_KEY, update(workbenchView(session.getState())));
}

export function newDraft(tool: ToolId, now: Date): ToolDraft {
  return { mode: 'form', form: emptyForm(tool, now), json: '{}', example: 'none', showProblems: false };
}

export function toolDraft(view: WorkbenchView, tool: ToolId, now: Date): ToolDraft {
  return view.drafts[tool] ?? newDraft(tool, now);
}

export function setDraft(session: SocialSession, tool: ToolId, draft: ToolDraft): void {
  updateWorkbench(session, (view) => ({ ...view, drafts: { ...view.drafts, [tool]: draft } }));
}

export function setAttempt(session: SocialSession, tool: ToolId, attempt: Attempt | undefined): void {
  updateWorkbench(session, (view) => {
    const { [tool]: _previous, ...rest } = view.attempts;
    return { ...view, attempts: attempt ? { ...rest, [tool]: attempt } : rest };
  });
}

/**
 * The explicit Run action, and the only caller of `submitRun` in the workbench. It submits exactly once:
 * an unknown outcome is recorded and reconciled by reading run history, never by sending again.
 */
export async function runTool(
  port: SocialWorkspacePort, session: SocialSession, tool: ToolId, input: Record<string, unknown>, isExample: boolean,
  now: () => string = () => new Date().toISOString(),
): Promise<Attempt | null> {
  const view = workbenchView(session.getState());
  if (view.attempts[tool]?.status === 'submitting') return null;
  const snapshot = workspaceSnapshot(session.getState().workspace);
  // Runs known before this attempt: the last run list plus runs accepted since it was read.
  const knownRunIds = snapshot ? [
    ...snapshot.runs.map((run) => run.id),
    ...Object.values(view.attempts).flatMap((attempt) => (attempt?.status === 'accepted' ? [attempt.run.id] : [])),
  ] : undefined;
  setAttempt(session, tool, { status: 'submitting', isExample });
  const outcome = await submitRunOnce(port, tool, input, isExample, now);
  const attempt: Attempt = outcome.kind === 'accepted' ? { status: 'accepted', run: outcome.run }
    : outcome.kind === 'rejected' ? { status: 'rejected', error: outcome.error }
      : { status: 'unknown', isExample, attemptedAt: outcome.attemptedAt, ...(knownRunIds ? { knownRunIds } : {}) };
  setAttempt(session, tool, attempt);
  // RR-5: refresh run history (a content read) so runs created since the attempt can be listed.
  if (attempt.status === 'unknown') await session.load(port);
  return attempt;
}
