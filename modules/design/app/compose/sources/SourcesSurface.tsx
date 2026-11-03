import { useEffect, useState, useSyncExternalStore, type CSSProperties, type ReactNode } from 'react';
import { Toast, ToastRegion } from '@hq/ui';
import type { DesignLocation } from '../../../ui/contract.ts';
import { designModule as tasteModule } from '../../../taste/design-module.ts';
import { sourcesFeedback, type FeedbackInput, type FeedbackStore } from './feedback-store.ts';
import { tasteQueue, type HandoffQueue, type HandoffSubject } from './handoff.ts';
import './sources.css';

/** Where Taste is mounted; follows its descriptor so a placement change needs no edit here. */
export const TASTE_LOCATION: DesignLocation = { nav: tasteModule.nav, section: tasteModule.id };

/**
 * Wraps one Sources view: a motion scope plus the toast host. Only one Design section is mounted at a
 * time, so there is exactly one host; the store outlives it, so a toast survives a section switch.
 */
export function SourcesSurface({ children, store = sourcesFeedback }: { readonly children: ReactNode; readonly store?: FeedbackStore }) {
  return <div className="hqs-surface">
    {children}
    <SourcesToasts store={store} />
  </div>;
}

export function SourcesToasts({ store = sourcesFeedback }: { readonly store?: FeedbackStore }) {
  const toasts = useSyncExternalStore(store.subscribe, store.snapshot, store.snapshot);
  return <ToastRegion label="Design notifications" className="hqs-toasts">
    {toasts.map((toast) => {
      const dismiss = () => store.dismiss(toast.id);
      const action = toast.action === undefined ? undefined
        : { label: toast.action.label, onAction: () => { dismiss(); toast.action?.run(); } };
      const shared = { message: toast.message, className: `hqs-toast hqs-toast--${toast.tone}`,
        ...(toast.meta === undefined ? {} : { meta: toast.meta }), ...(action === undefined ? {} : { action }) };
      return toast.autoDismissMs === undefined
        ? <Toast key={toast.id} {...shared} onDismiss={dismiss} />
        : <Toast key={toast.id} {...shared} onDismiss={dismiss} autoDismissMs={toast.autoDismissMs} />;
    })}
  </ToastRegion>;
}

export function useSourcesFeedback(store: FeedbackStore = sourcesFeedback): (input: FeedbackInput) => string {
  return store.push;
}

export function useHandoffQueue(queue: HandoffQueue = tasteQueue): readonly HandoffSubject[] {
  return useSyncExternalStore(queue.subscribe, queue.snapshot, queue.snapshot);
}

/** Queues an item for Taste and confirms with a toast that can open Taste. Nothing is rated or saved yet. */
export function sendToTaste(subject: HandoffSubject, navigate: (location: DesignLocation) => void,
  queue: HandoffQueue = tasteQueue, store: FeedbackStore = sourcesFeedback): void {
  const result = queue.add(subject);
  const waiting = queue.snapshot().length;
  store.push({
    id: 'sources-taste-queue',
    tone: result === 'full' ? 'warning' : 'success',
    message: result === 'added' ? `“${subject.label}” is ready to rate`
      : result === 'already-queued' ? `“${subject.label}” is already waiting in Taste` : 'Taste queue is full',
    meta: result === 'full' ? 'Rate or skip some items first' : `${waiting} waiting in Taste`,
    action: { label: 'Open Taste', run: () => navigate(TASTE_LOCATION) },
  });
}

export type InlineState = 'idle' | 'pending' | 'saved' | 'failed' | 'unknown';

/** A dot plus a word next to the control it describes; colour is never the only signal. */
export function InlineStatus({ state, label, className }: { readonly state: InlineState; readonly label: string; readonly className?: string }) {
  if (state === 'idle') return null;
  return <span className={className === undefined ? 'hqs-inline' : `hqs-inline ${className}`} data-state={state} role="status">
    <span className="hqs-inline-dot" aria-hidden="true" />{label}
  </span>;
}

/** Live `prefers-reduced-motion`, for motion driven from script (swipes, step transitions). */
export function usePrefersReducedMotion(): boolean {
  const query = typeof window === 'undefined' || typeof window.matchMedia !== 'function' ? null : window.matchMedia('(prefers-reduced-motion: reduce)');
  const [reduced, setReduced] = useState(query?.matches ?? false);
  useEffect(() => {
    if (query === null) return undefined;
    const update = () => setReduced(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, [query?.media]);
  return reduced;
}

/** Stagger index for `.hqs-stagger` children, applied through CSSOM (the shell CSP blocks style attributes). */
export function staggerStyle(index: number): CSSProperties {
  return { '--hqs-i': Math.min(index, 12) } as CSSProperties;
}
