import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { useToast } from './ToastViewport';

export type AsyncStatus = 'idle' | 'pending' | 'success' | 'error';

export interface AsyncActionOptions<R> {
  /** Success toast. Omit when the changed UI already confirms the result (the usual case). */
  readonly success?: string | ((result: R) => string);
  /**
   * Failure toast title. Default "Something went wrong", with the error message as its description. `false` skips
   * the toast when the screen shows the failure inline instead.
   */
  readonly error?: false | string | ((error: unknown) => string);
  /** Offer Retry on the failure toast. Only when running the action again is safe; otherwise leave it off. */
  readonly retry?: boolean;
}

export interface AsyncAction<A extends unknown[], R> {
  /** Runs the action unless it is already pending. Resolves to the result, or undefined after a failure. */
  readonly run: (...args: A) => Promise<R | undefined>;
  readonly status: AsyncStatus;
  readonly pending: boolean;
  readonly error: unknown;
  readonly reset: () => void;
}

/**
 * Wraps an async user action with immediate feedback: `pending` for a busy button, a failure toast (optionally with
 * Retry), and an optional success toast. Repeated activation while pending is ignored, so a double click cannot
 * run it twice.
 *
 *   const save = useAsyncAction(saveCard, { error: "Couldn't save the card" });
 *   <Button busy={save.pending} busyLabel="Saving" onClick={() => void save.run(draft)}>Save</Button>
 */
export function useAsyncAction<A extends unknown[], R>(action: (...args: A) => Promise<R>, options: AsyncActionOptions<R> = {}): AsyncAction<A, R> {
  const toast = useToast();
  const toastId = `hq-async-${useId()}`;
  const [status, setStatus] = useState<AsyncStatus>('idle');
  const [error, setError] = useState<unknown>(null);
  const running = useRef(false);
  const mounted = useRef(true);
  const latest = useRef({ action, options });
  latest.current = { action, options };
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  const run = useCallback(async (...args: A): Promise<R | undefined> => {
    if (running.current) return undefined;
    running.current = true;
    setStatus('pending');
    setError(null);
    try {
      const result = await latest.current.action(...args);
      const { success } = latest.current.options;
      if (mounted.current) setStatus('success');
      toast.dismiss(toastId);
      if (success) toast.success(typeof success === 'function' ? success(result) : success);
      return result;
    } catch (caught) {
      const { error: message, retry } = latest.current.options;
      if (mounted.current) { setStatus('error'); setError(caught); }
      if (message !== false) {
        toast.error(typeof message === 'function' ? message(caught) : message ?? 'Something went wrong', {
          id: toastId,
          ...(caught instanceof Error && caught.message ? { description: caught.message } : {}),
          ...(retry ? { action: { label: 'Retry', onAction: () => { void run(...args); } } } : {}),
        });
      }
      return undefined;
    } finally {
      running.current = false;
    }
  }, [toast, toastId]);

  const reset = useCallback(() => { setStatus('idle'); setError(null); }, []);
  return { run, status, pending: status === 'pending', error, reset };
}
