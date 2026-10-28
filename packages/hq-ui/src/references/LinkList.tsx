import { useEffect, useRef, useState } from 'react';
import { parseReference, type ReferenceEnvelope } from '@hq/contracts';
import { Button } from '../components/Button';
import { ReferenceChip } from './ReferenceChip';
import { referenceObservation, REFERENCE_MAX_AGE_MS, useReferenceClock } from './freshness';
import { referenceKey, type ReferenceEntry, type ReferenceSnapshotUpdate, type ReferenceUndo } from './types';

export interface LinkListProps {
  readonly entries: readonly ReferenceEntry[];
  readonly projectId: string;
  readonly onOpen?: (envelope: ReferenceEnvelope) => void;
  /** Supply only when the source owner supports link persistence and versioned Undo. */
  readonly onUnlink?: (envelope: ReferenceEnvelope) => ReferenceUndo | Promise<ReferenceUndo>;
  readonly onUpdateSnapshot?: (envelope: ReferenceEnvelope, update: ReferenceSnapshotUpdate) => ReferenceUndo | Promise<ReferenceUndo>;
  readonly now?: number;
  readonly maxAgeMs?: number;
}
export function LinkList({ entries, projectId, onOpen, onUnlink, onUpdateSnapshot, now, maxAgeMs = REFERENCE_MAX_AGE_MS }: LinkListProps) {
  const clock = useReferenceClock(now);
  const [pending, setPending] = useState(false);
  const busy = useRef(false);
  const [notice, setNotice] = useState<{ message: string; action: ReferenceUndo }>();
  const [error, setError] = useState('');
  const undoRef = useRef<HTMLButtonElement>(null);
  const headingRef = useRef<HTMLParagraphElement>(null);
  // Disabling the focused button drops keyboard focus to <body>; give it back when nothing else took it.
  const returnFocus = useRef<HTMLElement | null>(null);
  useEffect(() => { if (notice) undoRef.current?.focus(); }, [notice]);
  useEffect(() => {
    const target = returnFocus.current;
    if (pending || !target) return;
    returnFocus.current = null;
    if (target.isConnected && (!document.activeElement || document.activeElement === document.body)) target.focus();
  }, [pending]);
  const start = () => {
    busy.current = true;
    returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setPending(true);
    setError('');
  };
  const mutate = async (message: string, action: () => ReferenceUndo | Promise<ReferenceUndo>) => {
    if (busy.current) return;
    start();
    try { setNotice({ message, action: await action() }); }
    catch { setError('Change was not confirmed. Check the source record before trying again.'); }
    finally { busy.current = false; setPending(false); }
  };
  const undo = async () => {
    if (!notice || busy.current) return;
    start();
    try { await notice.action.undo(); setNotice(undefined); headingRef.current?.focus(); }
    catch { setError('Undo was not confirmed. Check the source record before trying again.'); }
    finally { busy.current = false; setPending(false); }
  };
  return <section className="hq-link-list" aria-label="Linked references" aria-busy={pending}>
    <p className="hq-reference-summary" tabIndex={-1} ref={headingRef}>{entries.length ? `${entries.length} linked references` : 'No linked references'}</p>
    <ul className="hq-reference-items">
      {entries.map((entry) => {
        const { envelope, resolution } = entry;
        const observation = referenceObservation(entry, clock, maxAgeMs);
        const canUpdate = observation.fresh && ['available', 'changed'].includes(observation.status)
          && envelope.projectId === projectId && (!resolution?.targetProjectId || resolution.targetProjectId === projectId)
          && !!resolution?.latestTitle && !!resolution.latestRevision
          && !!parseReference({ ...envelope, title: resolution.latestTitle, sourceRevision: resolution.latestRevision })
          && (resolution.latestTitle !== envelope.title || resolution.latestRevision !== envelope.sourceRevision);
        return <li key={referenceKey(envelope)} className="hq-reference-item">
          <ReferenceChip {...entry} projectId={projectId} now={clock} maxAgeMs={maxAgeMs} onOpen={onOpen ? () => onOpen(envelope) : undefined} />
          <div className="hq-reference-actions">
            {onUnlink && <Button size="sm" disabled={pending} onClick={() => void mutate(`Unlinked “${envelope.title}”`, () => onUnlink(envelope))} aria-label={`Unlink ${envelope.title}`}>Unlink</Button>}
            {onUpdateSnapshot && <Button size="sm" disabled={pending || !canUpdate} onClick={() => {
              if (canUpdate) void mutate(`Updated snapshot “${envelope.title}”`, () => onUpdateSnapshot(envelope, { title: resolution!.latestTitle!, sourceRevision: resolution!.latestRevision! }));
            }} aria-label={`Update snapshot ${envelope.title}`}>Update snapshot</Button>}
          </div>
        </li>;
      })}
    </ul>
    <div role="status" aria-live="polite" className="hq-reference-notice">
      {notice && <><span>{notice.message}</span><Button ref={undoRef} disabled={pending} onClick={() => void undo()}>Undo</Button></>}
    </div>
    {error && <p role="alert">{error}</p>}
  </section>;
}
