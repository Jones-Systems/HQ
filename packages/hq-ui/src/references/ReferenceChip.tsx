import { Button } from '../components/Button';
import { StatusChip, type StatusTone } from '../components/StatusChip';
import { formatReferenceTime, referenceObservation, REFERENCE_MAX_AGE_MS, useReferenceClock } from './freshness';
import type { ReferenceEntry, ReferenceStatus } from './types';

const tones: Record<ReferenceStatus, StatusTone> = {
  available: 'success', changed: 'warning', archived: 'neutral', missing: 'danger',
  moved: 'info', forbidden: 'danger', unavailable: 'unavailable', unknown: 'unknown',
};
export interface ReferenceChipProps extends ReferenceEntry {
  readonly projectId: string;
  readonly onOpen?: () => void;
  readonly now?: number;
  readonly maxAgeMs?: number;
}
export function ReferenceChip({ envelope, resolution, stale, projectId, onOpen, now, maxAgeMs = REFERENCE_MAX_AGE_MS }: ReferenceChipProps) {
  const clock = useReferenceClock(now);
  const observation = referenceObservation({ envelope, resolution, stale }, clock, maxAgeMs);
  const mismatch = envelope.projectId !== projectId
    || (resolution?.targetProjectId !== undefined && resolution.targetProjectId !== projectId);
  const openable = observation.fresh && !mismatch && ['available', 'changed', 'archived'].includes(observation.status);
  return <div className="hq-reference" data-reference-status={observation.status}>
    <div className="hq-reference-heading">
      <span className="hq-reference-title">{envelope.title}</span>
      <StatusChip tone={tones[observation.status]} label={observation.status[0]!.toUpperCase() + observation.status.slice(1)} />
    </div>
    <p className="hq-reference-provenance">
      {envelope.domain} · {envelope.kind} · {envelope.entityId} · Project {envelope.projectId}
      {envelope.workspaceId && <> · Workspace {envelope.workspaceId}</>}
      {' · '}{envelope.sourceRevision ? `Snapshot revision ${envelope.sourceRevision}` : 'Snapshot revision unknown'}
    </p>
    <p className="hq-reference-freshness">
      {observation.freshness}{' · '}
      {observation.observedAt
        ? <>Observed <time dateTime={observation.observedAt}>{formatReferenceTime(observation.observedAt)}</time></>
        : 'Not observed'}
    </p>
    {resolution?.latestTitle && resolution.latestTitle !== envelope.title && <p className="hq-reference-latest">Latest title: {resolution.latestTitle} · Snapshot unchanged</p>}
    {(mismatch || observation.status === 'moved') && <p className="hq-reference-context">Read-only project context: {resolution?.targetProjectId ?? envelope.projectId}</p>}
    {onOpen && <Button size="sm" disabled={!openable} onClick={onOpen} aria-label={`Open ${envelope.title}`}>Open</Button>}
  </div>;
}
