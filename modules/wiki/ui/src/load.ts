// Request lifecycle with a sequence guard: only the latest request for a hook instance may publish.

import { useCallback, useEffect, useRef, useState } from 'react';
import type { WikiError, WikiResult } from '../../contract/src/index.ts';
import { settleResponse, type WikiCache } from './cache.ts';
import { invalidResponse } from './format.ts';
import type { ResourceSpec } from './resources.ts';

export type Loaded<T> =
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly value: T }
  | { readonly status: 'error'; readonly error: WikiError };

const LOADING: Loaded<never> = { status: 'loading' };

function settle<T>(raw: unknown, check: (value: T) => WikiError | null): Loaded<T> {
  const settled = settleResponse(raw, check);
  return settled.ok ? { status: 'ready', value: settled.value } : { status: 'error', error: settled.error };
}

/**
 * Runs `load` whenever `key` changes (null = idle). A response is published only if no newer request
 * has started and the component is still mounted, so a slow earlier response can never replace a later one.
 * `key` must name every input of `load`.
 */
export function useLoaded<T>(
  key: string | null,
  load: () => Promise<WikiResult<T>>,
  check: (value: T) => WikiError | null,
): Loaded<T> | null {
  const [state, setState] = useState<{ readonly key: string; readonly result: Loaded<T> } | null>(null);
  const sequence = useRef(0);

  useEffect(() => {
    if (key === null) return undefined;
    const mine = ++sequence.current;
    let pending: Promise<unknown>;
    try {
      pending = load();
    } catch (cause) {
      pending = Promise.reject(cause);
    }
    pending.then(
      (raw) => raw,
      () => ({ ok: false, error: invalidResponse('The Wiki request failed unexpectedly.') }),
    ).then((raw) => {
      if (sequence.current !== mine) return;
      setState({ key, result: settle(raw, check) });
    });
    return () => {
      sequence.current++;
    };
    // `load` and `check` are closures over exactly the inputs named by `key`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  if (key === null) return null;
  return state !== null && state.key === key ? state.result : LOADING;
}

/** Builds a response check from a contract validator, with an optional extra consistency rule. */
export function contract<T>(
  validate: (value: unknown) => WikiResult<T>,
  extra?: (value: T) => string | null,
): (value: T) => WikiError | null {
  return (value) => {
    const result = validate(value);
    if (!result.ok) {
      return invalidResponse(`The response did not match the Wiki contract (${result.error.reason} at ${result.error.path ?? '$'}).`);
    }
    const message = extra === undefined ? null : extra(value);
    return message === null ? null : invalidResponse(message);
  };
}

export interface Resource<T> {
  /**
   * `loading`: nothing is known for this key yet. `ready`: `value` is shown (it may be an older value while
   * `refreshing`, or kept after a failed refresh, in which case `error` is set). `error`: nothing to show.
   */
  readonly status: 'idle' | 'loading' | 'ready' | 'error';
  readonly value: T | undefined;
  /** The latest failure for this key, kept next to an older value when there is one. */
  readonly error: WikiError | null;
  /** A request is in flight while a value is already shown. */
  readonly refreshing: boolean;
  /** Requests the key again, whatever the cache holds. Safe: every Wiki read is side-effect free. */
  readonly retry: () => void;
}

const NOOP = (): void => undefined;
const IDLE: Resource<never> = { status: 'idle', value: undefined, error: null, refreshing: false, retry: NOOP };

/** How long a cached value is shown without asking again. Older values show at once and refresh behind. */
export const RESOURCE_MAX_AGE_MS = 60_000;

/**
 * Cached read for one resource (null = idle). A value already in the session cache shows immediately; a value older
 * than `maxAge` refreshes in the background; a failure keeps the last good value and reports the error beside it.
 * Like `useLoaded`, only the latest request of this hook instance may publish.
 */
export function useResource<T>(spec: ResourceSpec<T> | null, cache: WikiCache, options: { readonly maxAge?: number } = {}): Resource<T> {
  const maxAge = options.maxAge ?? RESOURCE_MAX_AGE_MS;
  const key = spec === null ? null : spec.key;
  const [attempt, setAttempt] = useState<{ readonly key: string | null; readonly n: number }>({ key: null, n: 0 });
  const n = attempt.key === key ? attempt.n : 0;
  const [state, setState] = useState<{ readonly key: string; readonly n: number; readonly inFlight: boolean; readonly error: WikiError | null } | null>(null);
  const sequence = useRef(0);
  const latest = useRef(spec);
  latest.current = spec;

  useEffect(() => {
    const current = latest.current;
    if (key === null || current === null) return undefined;
    const mine = ++sequence.current;
    if (n === 0 && cache.age(key) < maxAge) {
      setState({ key, n, inFlight: false, error: null });
      return () => {
        sequence.current++;
      };
    }
    setState({ key, n, inFlight: true, error: null });
    void cache.request(key, current.load, current.check).then((settled) => {
      if (sequence.current !== mine) return;
      setState({ key, n, inFlight: false, error: settled.ok ? null : settled.error });
    });
    return () => {
      sequence.current++;
    };
  }, [key, n, cache, maxAge]);

  const retry = useCallback(() => {
    if (key !== null) setAttempt((previous) => ({ key, n: (previous.key === key ? previous.n : 0) + 1 }));
  }, [key]);

  if (key === null) return IDLE;
  const entry = cache.peek<T>(key);
  const mine = state !== null && state.key === key && state.n === n ? state : null;
  // Before this key's effect has run, assume a request is starting unless a fresh value is cached.
  const inFlight = mine === null ? !(n === 0 && entry !== undefined && cache.age(key) < maxAge) : mine.inFlight;
  const error = mine === null ? null : mine.error;
  if (entry !== undefined) return { status: 'ready', value: entry.value, error, refreshing: inFlight, retry };
  if (inFlight) return { status: 'loading', value: undefined, error: null, refreshing: false, retry };
  return error === null ? { status: 'loading', value: undefined, error: null, refreshing: false, retry } : { status: 'error', value: undefined, error, refreshing: false, retry };
}
