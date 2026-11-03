import { useCallback, useEffect, useRef, useState } from 'react';
import { useAsyncAction, useToast } from '@hq/ui';

export const BUSY_REASON = 'Another action is in progress.';

export interface ActionToast { readonly title: string; readonly description?: string; readonly meta?: string }

/** What an action reports back. Nothing is thrown: a rejected or lost request is an outcome too. */
export type Outcome =
  | { readonly ok: true; readonly toast?: ActionToast }
  | {
    readonly ok: false;
    readonly title: string;
    /** What happened and what was kept, in plain words. */
    readonly detail: string;
    /** The request may or may not have taken effect; offer Check, never a blind retry. */
    readonly unknown?: boolean;
    /** Repeating this exact action is safe. */
    readonly retry?: boolean;
    readonly check?: () => void;
  };

export interface Job {
  /** Which button is busy. */
  readonly id: string;
  /** Which row shows the result inline and plays the flash. */
  readonly row: string;
  /** Failure title when the call itself throws (the result is then not confirmed). */
  readonly lost: string;
  readonly check?: () => void;
  readonly work: () => Promise<Outcome>;
}

export interface Failure {
  readonly title: string;
  readonly detail: string;
  readonly tone: 'danger' | 'unknown';
  readonly retry?: () => void;
  readonly check?: () => void;
}

/**
 * Every Settings mutation runs through this. `useAsyncAction` supplies the double-activation guard and `pending`;
 * the outcome becomes a toast (the confirmation for people who looked away) and, for a failure, an inline notice on
 * the row that stays after the toast is gone. Success flashes the row once.
 */
export function useSettingsActions() {
  const toast = useToast();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [failures, setFailures] = useState<Readonly<Record<string, Failure>>>({});
  const [flashes, setFlashes] = useState<Readonly<Record<string, number>>>({});
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  const action = useAsyncAction(async (job: Job): Promise<Outcome> => {
    if (alive.current) setPendingId(job.id);
    try { return await job.work(); }
    catch {
      return { ok: false, title: job.lost, detail: 'HQ did not get an answer, so the result is not confirmed.', unknown: true, ...(job.check ? { check: job.check } : {}) };
    } finally { if (alive.current) setPendingId(null); }
  }, { error: false });

  const run = useCallback(async (job: Job): Promise<boolean> => {
    if (alive.current) setFailures(({ [job.row]: _cleared, ...rest }) => rest);
    const outcome = await action.run(job);
    if (!outcome) return false;
    if (outcome.ok) {
      if (alive.current) setFlashes(previous => ({ ...previous, [job.row]: (previous[job.row] ?? 0) + 1 }));
      if (outcome.toast) toast.success(outcome.toast.title, { ...(outcome.toast.description ? { description: outcome.toast.description } : {}), ...(outcome.toast.meta ? { meta: outcome.toast.meta } : {}) });
      return true;
    }
    const retry = outcome.retry ? () => { void run(job); } : undefined;
    const check = outcome.check ?? (outcome.unknown ? job.check : undefined);
    const tone = outcome.unknown ? 'unknown' : 'danger';
    if (alive.current) setFailures(previous => ({ ...previous, [job.row]: { title: outcome.title, detail: outcome.detail, tone, ...(retry ? { retry } : {}), ...(check ? { check } : {}) } }));
    if (outcome.unknown) toast.unknown(outcome.title, { description: outcome.detail, ...(check ? { action: { label: 'Check', onAction: check } } : {}) });
    else toast.error(outcome.title, { description: outcome.detail, ...(retry ? { action: { label: 'Retry', onAction: retry } } : check ? { action: { label: 'Check', onAction: check } } : {}) });
    return false;
  }, [action, toast]);

  const dismiss = useCallback((row: string) => setFailures(({ [row]: _removed, ...rest }) => rest), []);
  /** For results that arrive outside an action (an index finishing): flash the row, or show its failure inline. */
  const flash = useCallback((row: string) => setFlashes(previous => ({ ...previous, [row]: (previous[row] ?? 0) + 1 })), []);
  const fail = useCallback((row: string, failure: Failure) => setFailures(previous => ({ ...previous, [row]: failure })), []);
  /** The reason a control cannot start right now, or null. The running action's own button shows busy instead. */
  const blocked = (id?: string) => action.pending && pendingId !== id ? BUSY_REASON : null;
  return { run, pendingId, pending: action.pending, failures, flashes, dismiss, flash, fail, blocked };
}
export type SettingsActions = ReturnType<typeof useSettingsActions>;
