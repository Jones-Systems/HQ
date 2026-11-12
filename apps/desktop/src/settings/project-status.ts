import { useCallback, useEffect, useRef, useState } from 'react';
import type { SourceStatus } from '@hq/contracts/catalog';
import type { JonesStatus } from '@hq/contracts/jones-code';

export interface ProjectStatus {
  /** Enrolled project sources; undefined when the native bridge is missing or its status could not be read. */
  readonly sources: readonly SourceStatus[] | undefined;
  readonly jones: JonesStatus | undefined;
  /** True until the first read finishes. */
  readonly loading: boolean;
  readonly refresh: () => Promise<void>;
}

/**
 * Read-only status of project sources and the Jones connection for the Overview. It never runs a project or sends
 * a request: it reads the same two status routes the Projects & Jones panel reads, and re-reads when that panel
 * reports a change (`hq-sources-changed`).
 */
export function useProjectStatus(): ProjectStatus {
  const [sources, setSources] = useState<readonly SourceStatus[]>();
  const [jones, setJones] = useState<JonesStatus>();
  const [loading, setLoading] = useState(true);
  const alive = useRef(true);
  const generation = useRef(0);
  const refresh = useCallback(async () => {
    const current = ++generation.current;
    const bridge = window.hqServices;
    const [sourceResult, jonesResult] = await Promise.all([
      Promise.resolve(bridge?.sources?.call('status', {})).catch(() => undefined),
      Promise.resolve(bridge?.jonesCode?.call('jonesCode.status', {})).catch(() => undefined),
    ]);
    if (!alive.current || current !== generation.current) return;
    setSources(sourceResult?.ok ? sourceResult.value : undefined);
    setJones(jonesResult?.ok ? jonesResult.value : undefined);
    setLoading(false);
  }, []);
  useEffect(() => {
    alive.current = true;
    const onChange = () => { void refresh(); };
    onChange();
    window.addEventListener('hq-sources-changed', onChange);
    return () => { alive.current = false; ++generation.current; window.removeEventListener('hq-sources-changed', onChange); };
  }, [refresh]);
  return { sources, jones, loading, refresh };
}
