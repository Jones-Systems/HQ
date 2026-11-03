import { flushSync } from 'react-dom';
import { prefersReducedMotion } from '@hq/ui';
import type { Appearance } from '@hq/contracts';

/** Marks the document while a theme crossfade runs so the crossfade rules apply to this transition only. */
export const THEME_TRANSITION_ATTRIBUTE = 'data-hq-theme-transition';

type ViewTransitionDocument = Document & { startViewTransition?: (update: () => void) => { finished: Promise<unknown> } };

/**
 * Runs a theme change inside `document.startViewTransition` (a crossfade of the whole window) when the browser has
 * it and motion is allowed; otherwise the change is instant. React must commit inside the callback, so the update is
 * flushed synchronously there.
 */
export function switchAppearance(change: () => void): void {
  const doc = document as ViewTransitionDocument;
  if (typeof doc.startViewTransition !== 'function' || prefersReducedMotion()) { change(); return; }
  const root = document.documentElement;
  root.setAttribute(THEME_TRANSITION_ATTRIBUTE, '');
  const done = () => root.removeAttribute(THEME_TRANSITION_ATTRIBUTE);
  try {
    const transition = doc.startViewTransition(() => { flushSync(change); });
    void transition.finished.then(done, done);
  } catch { done(); change(); }
}

export const APPEARANCES: readonly Appearance[] = ['light', 'dark', 'system'];
