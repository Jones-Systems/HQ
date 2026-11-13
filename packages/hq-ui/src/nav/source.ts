import { useEffect, useState } from 'react';
import { buildNavModel } from './state';
import type { DomainNavSource, NavModel } from './types';

const EMPTY_MODEL = buildNavModel([]);
export interface DomainNavSnapshot {
  readonly model: NavModel;
  readonly status: 'idle' | 'loading' | 'ready' | 'error';
}
interface BoundSnapshot extends DomainNavSnapshot {
  readonly source: DomainNavSource | null;
  readonly projectId: string;
}

/** No source is selected implicitly. Late notifications from an old project/source are ignored. */
export function useDomainNavSource(source: DomainNavSource | null, projectId: string): DomainNavSnapshot {
  const [snapshot, setSnapshot] = useState<BoundSnapshot>({ source: null, projectId: '', model: EMPTY_MODEL, status: 'idle' });
  useEffect(() => {
    if (projectId.length > 128) { setSnapshot({ source, projectId: '', model: EMPTY_MODEL, status: 'error' }); return; }
    if (!source) { setSnapshot({ source, projectId, model: EMPTY_MODEL, status: 'idle' }); return; }
    let active = true;
    const read = () => {
      if (!active) return;
      try { setSnapshot({ source, projectId, model: buildNavModel(source.getSnapshot(projectId)), status: 'ready' }); }
      catch { setSnapshot({ source, projectId, model: EMPTY_MODEL, status: 'error' }); }
    };
    let unsubscribe: (() => void) | undefined;
    try {
      unsubscribe = source.subscribe(projectId, read);
      read();
    } catch { setSnapshot({ source, projectId, model: EMPTY_MODEL, status: 'error' }); }
    return () => { active = false; unsubscribe?.(); };
  }, [source, projectId]);
  if (projectId.length > 128) return { model: EMPTY_MODEL, status: 'error' };
  if (snapshot.source !== source || snapshot.projectId !== projectId) {
    return { model: EMPTY_MODEL, status: source ? 'loading' : 'idle' };
  }
  return snapshot;
}
