// Outage feedback for views that keep showing what they loaded. The inline notice is the view's own; this adds the one
// toast per outage episode (docs: design-20261103.md, Feedback rules) on the shared id, so every view that raises it
// updates the same toast. `session.outage` marks the episode.

import { useCallback, useEffect, useRef } from 'react';
import type { ViewCtx } from './context.ts';
import { isOutage } from './format.ts';
import type { Resource } from './load.ts';

export const OUTAGE_TOAST_ID = 'wiki-outage';

/**
 * Raises, for a resource that has a value on screen:
 * - a warning toast on the first outage ("The Wiki isn't answering", with Wiki settings when the host injected it);
 * - an error toast on the same id when a Retry fails again;
 * - a success toast on the same id when a request succeeds again.
 * Nothing is toasted while nothing is shown (the view's inline notice speaks) or for a failure that is not an outage.
 * Returns a `retry` to wire to the view's Retry action: it records that the user asked.
 */
export function useOutageToasts(ctx: ViewCtx, resource: Resource<unknown>): () => void {
  const retried = useRef(false);
  const requested = useRef(false);
  const { error, refreshing, status, value, retry } = resource;
  useEffect(() => {
    if (refreshing || status === 'loading') {
      requested.current = true;
      return;
    }
    if (value === undefined) return;
    const { toast, session, openSettings } = ctx;
    const action = openSettings === null ? undefined : { label: 'Wiki settings', onAction: openSettings };
    if (error !== null && isOutage(error)) {
      if (!session.outage) {
        session.outage = true;
        toast?.warning('The Wiki isn’t answering', { id: OUTAGE_TOAST_ID, description: 'Showing pages you already opened.', action });
      } else if (retried.current) {
        toast?.error('The Wiki still isn’t answering', { id: OUTAGE_TOAST_ID, description: 'Showing pages you already opened.', action });
      }
      retried.current = false;
      requested.current = false;
    } else if (error === null && requested.current) {
      requested.current = false;
      retried.current = false;
      if (session.outage) {
        session.outage = false;
        toast?.success('The Wiki is back', { id: OUTAGE_TOAST_ID });
      }
    }
  }, [ctx, error, refreshing, status, value]);
  return useCallback(() => {
    retried.current = true;
    retry();
  }, [retry]);
}
