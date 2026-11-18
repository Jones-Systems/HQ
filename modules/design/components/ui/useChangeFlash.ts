import { useState } from 'react';
import type { PropValues } from '../src/contract.ts';
import { changedProps } from '../src/model/variant-diff.ts';

interface FlashState {
  readonly scope: string;
  readonly props: PropValues;
  readonly counters: Readonly<Record<string, number>>;
}

/**
 * Counts, per prop name, how many times its resolved value changed while `scope` stayed the same. Use the count in
 * an element `key` together with `hq-flash` so a changed value replays the flash. A new scope (another component)
 * restarts from zero, because the whole stage is replaced rather than edited.
 */
export function useChangeFlash(scope: string, props: PropValues): Readonly<Record<string, number>> {
  const [state, setState] = useState<FlashState>({ scope, props, counters: {} });
  if (state.scope !== scope) {
    setState({ scope, props, counters: {} });
    return {};
  }
  if (state.props !== props) {
    const changed = changedProps(state.props, props);
    const counters = changed.length === 0 ? state.counters
      : { ...state.counters, ...Object.fromEntries(changed.map((name) => [name, (state.counters[name] ?? 0) + 1])) };
    setState({ scope, props, counters });
    return counters;
  }
  return state.counters;
}
