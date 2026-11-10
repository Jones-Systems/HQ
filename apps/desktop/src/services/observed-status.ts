import { useSyncExternalStore } from 'react';
import { toast as appToast, type StatusTone, type ToastApi } from '@hq/ui';
import type { ServiceDomain, SocialServiceTransport, WorkServiceTransport } from '@hq/contracts/services';
import { isServiceResponse } from '../../../../modules/work/live';

/**
 * What real traffic last showed, per live domain. Configuration alone ("Set up · not checked") says nothing about
 * whether the service answers; this records what actually happened. Nothing here sends a request or polls.
 */
export type Reachability = 'reachable' | 'unreachable';
export interface Observation {
  readonly state: Reachability;
  /** Epoch ms of the latest call that reported this state (refreshed at most once a minute). */
  readonly at: number;
}
export type ObservedSnapshot = Readonly<Record<ServiceDomain, Observation | null>>;
export type Outcome = Reachability | 'unknown';

/**
 * `ok: true` means only that an HTTP response arrived (any status), so the service answered. `unavailable` means no
 * request was sent or no connection was made. `unknown` (a request may have been delivered) and any malformed answer
 * prove nothing either way and change nothing.
 */
export function outcomeOf(answer: unknown): Outcome {
  if (!isServiceResponse(answer)) return 'unknown';
  if (answer.ok) return 'reachable';
  return answer.kind === 'unavailable' ? 'unreachable' : 'unknown';
}

const pad = (value: number) => String(value).padStart(2, '0');
/** Local 24-hour `HH:MM`. */
export function formatClock(at: number): string {
  const date = new Date(at);
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
export interface ObservedWording { readonly tone: StatusTone; readonly label: string; readonly detail: string }
/** The one wording for an observation, shared by the domain strip and the rail. */
export function describeObservation(observation: Observation): ObservedWording {
  const time = formatClock(observation.at);
  return observation.state === 'reachable'
    ? { tone: 'success', label: 'Connected', detail: `observed ${time}` }
    : { tone: 'danger', label: 'Unreachable', detail: `last tried ${time}` };
}

const DOMAIN_NAMES: Record<ServiceDomain, string> = { social: 'Social', work: 'Work' };
const toastId = (domain: ServiceDomain) => `hq-service-${domain}`;
const minute = (at: number) => Math.floor(at / 60_000);

export interface ObservedStatusStore {
  subscribe(listener: () => void): () => void;
  getSnapshot(): ObservedSnapshot;
  /** Record the answer to one real call. Never throws: observing must not change a call. */
  recordResponse(domain: ServiceDomain, answer: unknown): void;
  record(domain: ServiceDomain, outcome: Outcome): void;
  /** Forget every observation without toasts (tests and a fresh renderer). */
  reset(): void;
}
export interface ObservedStatusOptions { readonly now?: () => number; readonly toast?: Pick<ToastApi, 'warning' | 'success'> }

export function createObservedStatusStore({ now = Date.now, toast = appToast }: ObservedStatusOptions = {}): ObservedStatusStore {
  let snapshot: ObservedSnapshot = { social: null, work: null };
  const listeners = new Set<() => void>();
  const emit = () => { for (const listener of [...listeners]) listener(); };

  function record(domain: ServiceDomain, outcome: Outcome) {
    if (outcome === 'unknown') return;
    const previous = snapshot[domain];
    const at = now();
    const flipped = previous !== null && previous.state !== outcome;
    // Same state within the same displayed minute changes nothing a reader could see, so do not re-render.
    if (previous && !flipped && minute(previous.at) === minute(at)) return;
    snapshot = { ...snapshot, [domain]: { state: outcome, at } };
    emit();
    // First observation after load is silent; only a real change between reachable and unreachable is news.
    if (!flipped) return;
    const name = DOMAIN_NAMES[domain];
    if (outcome === 'unreachable') toast.warning(`${name} service unreachable`, { id: toastId(domain), description: 'The last request could not reach it. What is on screen is kept.' });
    else toast.success(`${name} service reconnected`, { id: toastId(domain) });
  }

  return {
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    getSnapshot: () => snapshot,
    record,
    recordResponse(domain, answer) { try { record(domain, outcomeOf(answer)); } catch { /* observation is best effort */ } },
    reset() { snapshot = { social: null, work: null }; emit(); },
  };
}

/** The renderer's store. The shell reads it with `useObservedStatus`; only wrapped live transports write to it. */
export const observedStatus = createObservedStatusStore();

export function useObservedStatus(domain: ServiceDomain, store: ObservedStatusStore = observedStatus): Observation | null {
  return useSyncExternalStore(store.subscribe, () => store.getSnapshot()[domain], () => null);
}

/** Same calls, same answers, same errors: the answer is only read on its way past. */
export function observeWork(transport: WorkServiceTransport, store: ObservedStatusStore = observedStatus): WorkServiceTransport {
  return { async call(route, params) { const answer = await transport.call(route, params); store.recordResponse('work', answer); return answer; } };
}
export function observeSocial(transport: SocialServiceTransport, store: ObservedStatusStore = observedStatus): SocialServiceTransport {
  return { async call(route, params) { const answer = await transport.call(route, params); store.recordResponse('social', answer); return answer; } };
}
