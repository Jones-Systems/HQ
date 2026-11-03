// Recovery actions for a failed read, from `errorRecovery`: Retry, Wiki settings (only when the host injected a
// route), a search for the name of a missing page, and Back (only when there is somewhere to go back to).

import type { WikiError } from '../../contract/src/index.ts';
import type { ViewCtx } from './context.ts';
import { errorRecovery } from './format.ts';
import type { NoticeAction } from './feedback.ts';

/**
 * Back for a view that has no history handle of its own. A context that offers `back` uses it; otherwise this presses
 * the chrome's own Back button (the view's contract names it "Back"). Null when there is no earlier entry.
 */
export function backOf(ctx: ViewCtx): (() => void) | null {
  const native = (ctx as { readonly back?: unknown }).back;
  if (typeof native === 'function') return native as () => void;
  if ((ctx.session.nav?.index ?? 0) <= 0) return null;
  return () => {
    document.querySelector<HTMLButtonElement>('.wiki-view button[aria-label="Back"]')?.click();
  };
}

export function recoveryActions(
  ctx: ViewCtx,
  error: WikiError,
  options: { readonly retry: () => void; /** The name to search for when a page is missing. */ readonly searchFor?: string },
): readonly NoticeAction[] {
  const actions: NoticeAction[] = [];
  for (const step of errorRecovery(error)) {
    if (step === 'retry') {
      actions.push({ label: 'Retry', icon: 'refresh', onAction: options.retry });
    } else if (step === 'settings') {
      if (ctx.openSettings !== null) actions.push({ label: 'Wiki settings', icon: 'settings', onAction: ctx.openSettings });
    } else if (step === 'search') {
      const term = options.searchFor;
      if (term !== undefined) actions.push({ label: `Search for “${term}”`, icon: 'search', onAction: () => ctx.openSearch(term) });
    } else {
      const back = backOf(ctx);
      if (back !== null) actions.push({ label: 'Back', icon: 'back', onAction: back });
    }
  }
  return actions;
}
