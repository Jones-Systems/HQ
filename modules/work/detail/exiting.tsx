import { createElement, useEffect, useReducer, useRef, type HTMLAttributes, type ReactNode } from 'react';
import { usePresence, prefersReducedMotion, type PresenceMotion } from '@hq/ui';

// Rows that leave (a checklist step removed, a List row filtered out) stay mounted until their exit animation ends,
// so they fade out instead of vanishing. A leaving row is inert and hidden from assistive technology, and nothing in
// it can be activated; under reduced motion it never lingers.

export interface Exiting<T> {
  readonly item: T;
  /** True while the item has left the data and is playing its exit. */
  readonly leaving: boolean;
  /** Call once the exit animation has finished, to drop the row. */
  readonly onExited: () => void;
}

/**
 * The current items in order, plus any item that just left, kept at the place it occupied until `onExited`.
 * An item that comes back before its exit ends cancels the exit. `clearWhenEmpty` drops all leaving items when the
 * list is empty, for lists that swap to an empty state.
 */
export function useExiting<T>(items: readonly T[], idOf: (item: T) => string, options: { readonly clearWhenEmpty?: boolean } = {}): Exiting<T>[] {
  const ghosts = useRef(new Map<string, { item: T; index: number }>());
  const shown = useRef<T[]>([]);
  const [, refresh] = useReducer((n: number) => n + 1, 0);

  const present = new Set(items.map(idOf));
  // A list that has been replaced by an empty state has no rows to play an exit, so it keeps no leaving rows either.
  if (prefersReducedMotion() || (options.clearWhenEmpty && items.length === 0)) ghosts.current.clear();
  else {
    shown.current.forEach((old, index) => {
      const id = idOf(old);
      if (!present.has(id) && !ghosts.current.has(id)) ghosts.current.set(id, { item: old, index });
    });
  }
  for (const id of present) ghosts.current.delete(id);

  const rows: { item: T; leaving: boolean; id: string }[] = items.map((item) => ({ item, leaving: false, id: idOf(item) }));
  for (const ghost of [...ghosts.current.values()].sort((a, b) => a.index - b.index)) {
    rows.splice(Math.min(ghost.index, rows.length), 0, { item: ghost.item, leaving: true, id: idOf(ghost.item) });
  }
  shown.current = rows.map((row) => row.item);

  return rows.map((row) => ({
    item: row.item,
    leaving: row.leaving,
    onExited: () => {
      if (ghosts.current.delete(row.id)) refresh();
    },
  }));
}

/** Attributes for a leaving element: not focusable, not announced, not clickable. */
export function leavingProps(leaving: boolean): { 'aria-hidden'?: true; inert?: true } {
  return leaving ? { 'aria-hidden': true, inert: true } : {};
}

/** False while a component is rendering for the first time; true on every later render. */
export function useMounted(): { readonly current: boolean } {
  const mounted = useRef(false);
  useEffect(() => { mounted.current = true; }, []);
  return mounted;
}

export interface PresentProps extends Omit<HTMLAttributes<HTMLElement>, 'children' | 'style'> {
  /** False starts the exit; the element unmounts when it ends. */
  readonly show: boolean;
  readonly motion?: PresenceMotion;
  /** Animate on the first render too. Default false: what is already there when the panel opens does not move. */
  readonly initial?: boolean;
  readonly as?: 'div' | 'section' | 'li' | 'span' | 'aside';
  /** Called once the element has finished exiting and is about to unmount. */
  readonly onExited?: () => void;
  readonly children?: ReactNode;
}

/**
 * `Presence` that also takes the leaving element out of the accessibility tree and the tab order while it exits, so a
 * dismissed alert or a removed row is gone for assistive technology the moment it is dismissed.
 */
export function Present({ show, motion = 'fade', initial = false, as = 'div', onExited, children, ...rest }: PresentProps) {
  const presence = usePresence<HTMLElement>(show, { motion, initial, onExited });
  if (!presence.mounted) return null;
  return createElement(as, { ...rest, ...presence.props, ...leavingProps(!show), ref: presence.ref }, children);
}
