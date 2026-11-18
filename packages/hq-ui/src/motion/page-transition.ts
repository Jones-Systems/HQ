import { flushSync } from 'react-dom';
import { prefersReducedMotion } from './motion';

/**
 * Put this class on the one rendered element that holds the current page or view. `motion.css` gives it the
 * `hq-page` view-transition name: the old page fades out in 90 ms while the new one rises in over 240 ms, and the
 * rest of the window cross-fades. Two rendered elements with the class would cancel the animation (never the update).
 */
export const PAGE_TRANSITION_CLASS = 'hq-page';

/** Added as a view-transition type, for direction-aware CSS (`:active-view-transition-type(hq-nav-back)`). */
export type NavigationDirection = 'forward' | 'back' | 'lateral';

/**
 * Applies a navigation state update with a page transition. The browser snapshots the window, then the update
 * renders synchronously, so it stays urgent: nothing waits for data, and Suspense fallbacks show at once, exactly as
 * without the transition. Layout is final while the snapshots animate, so measuring code (such as a native preview
 * placement) reads true positions. Reduced motion and engines without the View Transitions API apply the update
 * directly.
 */
export function navigateWithTransition(update: () => void, direction: NavigationDirection = 'lateral'): void {
  if (typeof document === 'undefined' || typeof document.startViewTransition !== 'function' || prefersReducedMotion()) { update(); return; }
  const run = () => { flushSync(update); };
  try {
    document.startViewTransition({ update: run, types: [`hq-nav-${direction}`] });
  } catch {
    // Engines that take only the callback form.
    document.startViewTransition(run);
  }
}
