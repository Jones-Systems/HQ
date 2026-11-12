import { useSyncExternalStore } from 'react';
import { toast as appToast, type StatusTone, type ToastApi } from '@hq/ui';
import type { ServiceDomain, SocialServiceTransport, WorkServiceTransport } from '@hq/contracts/services';
import { isServiceResponse } from '../../../../modules/work/live';
import { NOT_CHECKED, wikiStatus, type DataSource, type SourceStatus } from './data-source-status';

/**
 * What real traffic last showed, per data source. Configuration alone ("Set up · not checked") says nothing about
 * whether a service answers; this records what actually happened: answers to live calls, explicit checks, and the
 * Wiki index states the native host reported. Nothing here sends a request or polls.
 */
export type Reachability = 'reachable' | 'unreachable';
export interface Observation {
  readonly state: Reachability;
  readonly status?: SourceStatus;
  /** Epoch ms of the latest call that reported this state (refreshed at most once a minute). */
  readonly at: number;
}
export interface WikiObservation {
  /** Per-namespace index states from the native host; `undefined` when the status call failed. */
  readonly states: readonly string[] | undefined;
  readonly at: number;
}
export type ObservedSnapshot = Readonly<Record<ServiceDomain, Observation | null> & { wiki: WikiObservation | null }>;
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
/** The wording for one service observation. `describe` is what surfaces read; this is its observed half. */
export function describeObservation(observation: Observation): ObservedWording {
  const time = formatClock(observation.at);
  return observation.state === 'reachable'
    ? { tone: 'success', label: 'Reachable', detail: `observed ${time}` }
    : { tone: 'danger', label: 'Unreachable', detail: `last tried ${time}` };
}

/** One data source's status as every surface shows it: `text` is `label` and `detail` joined by " · ". */
export interface SourceWording extends SourceStatus { readonly indicator: StatusTone; readonly label: string; readonly detail: string }
export interface DescribeInput {
  /** What configuration says (or a check in progress), from `serviceStatus`, `CHECKING` or the Wiki placeholder. */
  readonly config: SourceStatus;
  /** What the observed-status store holds for this source. */
  readonly observed: Observation | WikiObservation | null;
}
const isWikiObservation = (value: Observation | WikiObservation): value is WikiObservation => 'states' in value;
function wording(status: SourceStatus, indicator: StatusTone, label?: string, detail?: string): SourceWording {
  const [first = status.text, ...rest] = status.text.split(' · ');
  return { ...status, indicator, label: label ?? first, detail: detail ?? rest.join(' · ') };
}
/**
 * The one status description for a data source. The domain strip, the top-bar Sources summary and popover, and
 * Settings all read it, so they never disagree. A service's observation counts only while its configuration is a
 * valid saved address (`NOT_CHECKED`); sample data, a rejected or unavailable address, and a check in progress say
 * only what configuration says. The Wiki's observation is its index state.
 */
export function describe(source: DataSource, { config, observed }: DescribeInput): SourceWording {
  if (source === 'wiki') {
    if (observed && isWikiObservation(observed)) {
      const status = wikiStatus(observed.states);
      return wording(status, status.indicator ?? 'neutral');
    }
    return wording(config, config.indicator ?? 'neutral');
  }
  if (config.text === NOT_CHECKED.text && observed && !isWikiObservation(observed)) {
    const seen = describeObservation(observed);
    if (observed.status) {
      const status = observed.status;
      const [label = status.text, ...details] = status.text.split(' · ');
      const detail = [...details, seen.detail].join(' · ');
      return { ...status, text: `${label} · ${detail}`, indicator: status.indicator ?? seen.tone, label, detail };
    }
    return { text: `${seen.label} · ${seen.detail}`, tone: observed.state === 'reachable' ? 'good' : 'bad', indicator: seen.tone, label: seen.label, detail: seen.detail };
  }
  return wording(config, config.indicator ?? 'neutral');
}

const DOMAIN_NAMES: Record<ServiceDomain, string> = { social: 'Social', work: 'Work' };
const toastId = (domain: ServiceDomain) => `hq-service-${domain}`;
const minute = (at: number) => Math.floor(at / 60_000);
const EMPTY: ObservedSnapshot = { social: null, work: null, wiki: null };

export interface ObservedStatusStore {
  subscribe(listener: () => void): () => void;
  getSnapshot(): ObservedSnapshot;
  /** Record the answer to one real call. Never throws: observing must not change a call. */
  recordResponse(domain: ServiceDomain, answer: unknown): void;
  record(domain: ServiceDomain, outcome: Outcome, status?: SourceStatus): void;
  /** Record the Wiki index states the native host reported (`undefined` when its status call failed). No toasts. */
  recordWiki(states: readonly string[] | undefined): void;
  /** Forget every observation without toasts (tests and a fresh renderer). */
  reset(): void;
}
export interface ObservedStatusOptions { readonly now?: () => number; readonly toast?: Pick<ToastApi, 'warning' | 'success'> }

export function createObservedStatusStore({ now = Date.now, toast = appToast }: ObservedStatusOptions = {}): ObservedStatusStore {
  let snapshot: ObservedSnapshot = EMPTY;
  const listeners = new Set<() => void>();
  const emit = () => { for (const listener of [...listeners]) listener(); };

  function record(domain: ServiceDomain, outcome: Outcome, status?: SourceStatus) {
    if (outcome === 'unknown') return;
    const previous = snapshot[domain];
    const at = now();
    const flipped = previous !== null && previous.state !== outcome;
    // Same state and wording within the displayed minute need no new rendering.
    if (previous && !flipped && minute(previous.at) === minute(at) && JSON.stringify(previous.status) === JSON.stringify(status)) return;
    snapshot = { ...snapshot, [domain]: { state: outcome, at, ...(status ? { status } : {}) } };
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
    recordWiki(states) {
      const previous = snapshot.wiki;
      const copy = states ? [...states] : undefined;
      if (previous && JSON.stringify(previous.states) === JSON.stringify(copy)) return;
      snapshot = { ...snapshot, wiki: { states: copy, at: now() } };
      emit();
    },
    reset() { snapshot = EMPTY; emit(); },
  };
}

/** The renderer's store. Live transports, explicit checks and Wiki status reads write to it; surfaces read `describe`. */
export const observedStatus = createObservedStatusStore();

export function useObservedStatus(domain: ServiceDomain, store: ObservedStatusStore = observedStatus): Observation | null {
  return useSyncExternalStore(store.subscribe, () => store.getSnapshot()[domain], () => null);
}
export function useObservedSnapshot(store: ObservedStatusStore = observedStatus): ObservedSnapshot {
  return useSyncExternalStore(store.subscribe, store.getSnapshot, () => EMPTY);
}

/** Same calls, same answers, same errors: the answer is only read on its way past. */
export function observeWork(transport: WorkServiceTransport, store: ObservedStatusStore = observedStatus): WorkServiceTransport {
  return { async call(route, params) { const answer = await transport.call(route, params); store.recordResponse('work', answer); return answer; } };
}
export function observeSocial(transport: SocialServiceTransport, store: ObservedStatusStore = observedStatus): SocialServiceTransport {
  return { async call(route, params) { const answer = await transport.call(route, params); store.recordResponse('social', answer); return answer; } };
}
