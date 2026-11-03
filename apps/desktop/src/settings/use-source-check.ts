import { useCallback, useEffect, useRef, useState } from 'react';
import type { DataSource, SourceStatus } from '../services/data-source-status';
import { useDataSources } from './DataSources';

/**
 * Runs a source check through the shell's data-source store and resolves with the status that check produced.
 * The store reports through state, so this waits for the commit that carries the result instead of reading a
 * stale closure.
 */
export function useSourceCheck(): (source: DataSource) => Promise<SourceStatus> {
  const { statuses, check } = useDataSources();
  const latest = useRef(statuses);
  latest.current = statuses;
  const [tick, setTick] = useState(0);
  const waiters = useRef<(() => void)[]>([]);
  useEffect(() => { for (const wake of waiters.current.splice(0)) wake(); }, [statuses, tick]);
  return useCallback(async (source: DataSource) => {
    await check(source);
    await new Promise<void>(resolve => { waiters.current.push(resolve); setTick(value => value + 1); });
    return latest.current[source];
  }, [check]);
}
