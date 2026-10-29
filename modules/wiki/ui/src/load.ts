// Request lifecycle with a sequence guard: only the latest request for a hook instance may publish.

import { useEffect, useRef, useState } from 'react';
import type { WikiError, WikiResult } from '../../contract/src/index.ts';
import { invalidResponse } from './format.ts';

export type Loaded<T> =
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly value: T }
  | { readonly status: 'error'; readonly error: WikiError };

const LOADING: Loaded<never> = { status: 'loading' };

function isResult(value: unknown): value is WikiResult<unknown> {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return record['ok'] === true ? 'value' in record : record['ok'] === false && typeof record['error'] === 'object' && record['error'] !== null;
}

function settle<T>(raw: unknown, check: (value: T) => WikiError | null): Loaded<T> {
  if (!isResult(raw)) return { status: 'error', error: invalidResponse('The Wiki returned a malformed response.') };
  if (!raw.ok) return { status: 'error', error: raw.error };
  const problem = check(raw.value as T);
  return problem === null ? { status: 'ready', value: raw.value as T } : { status: 'error', error: problem };
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
