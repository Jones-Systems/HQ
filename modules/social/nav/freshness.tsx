import { StatusChip } from '@hq/ui';
import type { WorkspaceLoad, WorkspaceSnapshot } from '../core';

export function clockTime(iso: string): string {
  const time = new Date(iso);
  return Number.isNaN(time.getTime()) ? iso : time.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
}

/** True when the shown snapshot is not the service's current answer (RX-5). */
export function isStale(load: WorkspaceLoad): boolean {
  return load.status === 'error';
}

export function isOffline(load: WorkspaceLoad): boolean {
  return load.status === 'error' && load.error.kind === 'unavailable';
}

/**
 * How current one part of a page is. A stale or unreachable workspace never reads as current:
 * it says offline or stale with the time the data was last synced.
 */
export function Freshness({ load, snapshot }: { readonly load: WorkspaceLoad; readonly snapshot: WorkspaceSnapshot }) {
  if (isStale(load)) {
    return <StatusChip tone={isOffline(load) ? 'unavailable' : 'warning'} label={isOffline(load) ? 'Offline' : 'Stale'} detail={`as of ${clockTime(snapshot.observedAt)}`} />;
  }
  if (load.status === 'loading') return <StatusChip tone="info" label="Refreshing" detail={`showing ${clockTime(snapshot.observedAt)}`} />;
  return <span className="hq-meta">As of {clockTime(snapshot.observedAt)}</span>;
}
