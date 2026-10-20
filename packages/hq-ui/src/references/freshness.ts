import { useEffect, useState } from 'react';
import type { ReferenceEntry, ReferenceStatus } from './types';

export const REFERENCE_MAX_AGE_MS = 5 * 60 * 1000;

export function useReferenceClock(now?: number): number {
  const [clock, setClock] = useState(Date.now);
  useEffect(() => {
    if (now !== undefined) return;
    const timer = setInterval(() => setClock(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [now]);
  return now ?? clock;
}

export function referenceObservation(entry: ReferenceEntry, now: number, maxAgeMs: number) {
  const observed = Date.parse(entry.resolution?.observedAt ?? '');
  const valid = Number.isFinite(observed) && Number.isFinite(now) && observed <= now
    && Number.isFinite(maxAgeMs) && maxAgeMs >= 0;
  const fresh = valid && !entry.stale && now - observed <= maxAgeMs;
  const freshness = !valid ? 'Unknown freshness' : fresh ? 'Fresh' : 'Stale';
  const status: ReferenceStatus = entry.resolution?.status === 'available' && !fresh
    ? 'unknown' : entry.resolution?.status ?? 'unknown';
  return { fresh, freshness, status, observedAt: valid ? entry.resolution?.observedAt : undefined };
}

export function formatReferenceTime(value: string): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', dateStyle: 'medium', timeStyle: 'long',
  }).format(new Date(value));
}
