import { createElement, useCallback, useEffect, useRef, useState, type HTMLAttributes, type ReactNode, type RefCallback } from 'react';
import { MOTION_DURATIONS, prefersReducedMotion } from './motion';

/** Enter/exit choreographies defined in `motion.css`. Exit always runs faster than enter. */
export const PRESENCE_MOTIONS = ['fade', 'rise', 'drop', 'scale', 'slide-end', 'slide-start', 'collapse', 'toast'] as const;
export type PresenceMotion = (typeof PRESENCE_MOTIONS)[number];
export type PresencePhase = 'enter' | 'exit';

export interface PresenceOptions {
  readonly motion?: PresenceMotion;
  /** Animate content that is already shown on first render. Default true; set false for restored views. */
  readonly initial?: boolean;
  /** Called once the element has finished exiting and is about to unmount. */
  readonly onExited?: () => void;
}

export interface PresenceState<T extends HTMLElement> {
  /** Render the element while this is true; it stays true until the exit animation ends. */
  readonly mounted: boolean;
  readonly phase: PresencePhase;
  readonly ref: RefCallback<T>;
  /** Spread onto the animated element: `data-hq-presence` and `data-hq-motion`. */
  readonly props: { readonly 'data-hq-presence': PresencePhase | 'idle'; readonly 'data-hq-motion': PresenceMotion };
}

/** Exit fallback in case `animationend` never fires (element hidden, animation removed). */
const EXIT_FALLBACK_MS = MOTION_DURATIONS.slow + 80;

/**
 * Keeps an element mounted while it animates out. `show` drives the phase; the element unmounts after its exit
 * animation, immediately under reduced motion. Works with any element that spreads `props` and takes `ref`.
 */
export function usePresence<T extends HTMLElement = HTMLElement>(show: boolean, options: PresenceOptions = {}): PresenceState<T> {
  const { motion = 'fade', initial = true, onExited } = options;
  const [mounted, setMounted] = useState(show);
  const [phase, setPhase] = useState<PresencePhase>('enter');
  const [animateEnter, setAnimateEnter] = useState(show ? initial : true);
  const element = useRef<T | null>(null);
  const exited = useRef(onExited);
  exited.current = onExited;

  useEffect(() => {
    if (show) {
      setMounted(true);
      setPhase('enter');
      return;
    }
    if (!mounted) return;
    if (prefersReducedMotion() || !element.current) {
      setMounted(false);
      setAnimateEnter(true);
      exited.current?.();
      return;
    }
    setPhase('exit');
    const node = element.current;
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      setMounted(false);
      setAnimateEnter(true);
      exited.current?.();
    };
    const onEnd = (event: AnimationEvent) => { if (event.target === node) finish(); };
    node.addEventListener('animationend', onEnd);
    node.addEventListener('animationcancel', onEnd);
    const timer = setTimeout(finish, EXIT_FALLBACK_MS);
    return () => {
      node.removeEventListener('animationend', onEnd);
      node.removeEventListener('animationcancel', onEnd);
      clearTimeout(timer);
    };
  }, [show, mounted]);

  const ref = useCallback<RefCallback<T>>((node) => { element.current = node; }, []);
  const current: PresencePhase | 'idle' = phase === 'exit' ? 'exit' : animateEnter ? 'enter' : 'idle';
  return { mounted: mounted || show, phase, ref, props: { 'data-hq-presence': current, 'data-hq-motion': motion } };
}

export interface PresenceProps extends Omit<HTMLAttributes<HTMLElement>, 'children' | 'style'> {
  readonly show: boolean;
  readonly motion?: PresenceMotion;
  readonly initial?: boolean;
  readonly onExited?: () => void;
  /** Wrapper element. Default `div`. */
  readonly as?: 'div' | 'section' | 'li' | 'span' | 'aside';
  readonly children?: ReactNode;
}

/** Mounts children with an enter animation and keeps them until their exit animation ends. */
export function Presence({ show, motion, initial, onExited, as = 'div', children, ...rest }: PresenceProps) {
  const presence = usePresence<HTMLElement>(show, { motion, initial, onExited });
  if (!presence.mounted) return null;
  return createElement(as, { ...rest, ...presence.props, ref: presence.ref }, children);
}
