import { addTransitionType, startTransition, ViewTransition, type ReactNode } from 'react';
import { prefersReducedMotion } from './motion';

/** `view-transition-class` names styled in `motion.css`. */
export const PAGE_TRANSITION_CLASSES = { enter: 'hq-page-enter', exit: 'hq-page-exit' } as const;

/** Transition types added by `navigateWithTransition`, for direction-aware CSS (`:active-view-transition-type()`). */
export type NavigationDirection = 'forward' | 'back' | 'lateral';

export interface PageTransitionProps {
  /** Identity of the page. A new id plays the exit/enter transition; the same id never animates. */
  readonly id: string;
  readonly children: ReactNode;
}

/**
 * Page-level transition through React's `<ViewTransition>` and the browser View Transitions API: the old page fades
 * out quickly and the new one rises in. It only animates updates started with `navigateWithTransition` (or any
 * `startTransition`); urgent updates, unsupported engines and reduced motion swap instantly.
 */
export function PageTransition({ id, children }: PageTransitionProps) {
  return (
    <ViewTransition key={id} enter={PAGE_TRANSITION_CLASSES.enter} exit={PAGE_TRANSITION_CLASSES.exit} update="none" share="none" default="none">
      {children}
    </ViewTransition>
  );
}

/**
 * Applies a navigation state update as a transition so `<PageTransition>` boundaries animate. Under reduced motion
 * the update runs immediately and nothing animates.
 */
export function navigateWithTransition(update: () => void, direction: NavigationDirection = 'lateral'): void {
  if (prefersReducedMotion()) { update(); return; }
  startTransition(() => {
    addTransitionType(`hq-nav-${direction}`);
    update();
  });
}
