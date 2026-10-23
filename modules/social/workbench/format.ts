import type { StatusTone } from '@hq/ui';
import type { ObservedRunStatus } from '../core';

/** Service timestamps shown as `YYYY-MM-DD HH:MM UTC`; an unparseable value is shown as recorded. */
export function formatTime(value: string | null | undefined): string {
  if (!value) return '—';
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return value;
  const iso = new Date(time).toISOString();
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;
}

export const RUN_STATUS_VIEW: { readonly [S in ObservedRunStatus]: { readonly label: string; readonly tone: StatusTone } } = {
  queued: { label: 'Queued', tone: 'info' },
  running: { label: 'Running', tone: 'info' },
  succeeded: { label: 'Succeeded', tone: 'success' },
  failed: { label: 'Failed', tone: 'danger' },
  interrupted: { label: 'Interrupted', tone: 'warning' },
  unknown: { label: 'Unknown', tone: 'unknown' },
};

/** The trailing eight characters: distinct for random IDs and for sequential ones that share a prefix. */
export function shortId(id: string): string {
  return id.slice(-8);
}
