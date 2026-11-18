import { Button, Presence } from '@hq/ui';
import { useSimulationLabel } from './context.ts';
import { cx } from './GuardedButton.tsx';
import { useChangeFlash } from './hooks.ts';
import { DECISION_LABELS, PROVENANCE_LABELS, plural, returnProvenance, utc, type InboxItem } from './model.ts';

export interface ReturnedRowProps {
  readonly item: InboxItem;
  /** The packet number this return answers, or null when it matches no packet of its request. */
  readonly sequence: number | null;
  /** The request it belongs to; shown when returns from several requests are listed together. */
  readonly requestTitle?: string;
  readonly selected?: boolean;
  /** Slide the row in. Set it for a return that arrived while the list was on screen. */
  readonly arrived?: boolean;
  readonly onOpen: () => void;
  readonly openLabel?: string;
}

/**
 * One returned item: the packet it answers, whether it awaits review or what was decided, and how it got here
 * (simulated, agent-reported or owner-reported, kept distinct). Opening it only selects it; nothing is sent.
 */
export function ReturnedRow({ item, sequence, requestTitle, selected = false, arrived = false, onOpen, openLabel = 'Open for review' }: ReturnedRowProps) {
  const simulationLabel = useSimulationLabel();
  const provenance = returnProvenance(item.candidate, simulationLabel);
  // A new arrival and a fresh decision both take the accent wash once; it is colour only, so reduced motion keeps it.
  const flash = useChangeFlash(item.decision ?? 'awaiting');
  return <Presence as="li" show motion="slide-end" initial={arrived} className={cx('hqr-returned-row', (arrived || flash.className) && 'hq-flash')}
    onAnimationEnd={flash.onAnimationEnd} data-origin={item.origin}
    data-provenance={provenance} data-decision={item.decision ?? 'awaiting'} data-hq-motion-key={item.candidate.candidateId}
    aria-current={selected ? 'true' : undefined}>
    {requestTitle && <div className="hqr-returned-request">{requestTitle}</div>}
    <div className="hqr-packet-line">
      <strong>{sequence ? `Packet #${sequence}` : 'Unmatched packet'}</strong>
      <span className="hqr-badge" data-decision={item.decision ?? 'awaiting'}>{item.decision ? DECISION_LABELS[item.decision] : 'Awaiting review'}</span>
      <span className="hqr-badge hqr-badge-quiet" data-provenance={provenance}>{PROVENANCE_LABELS[provenance]}</span>
      {item.versionless && <span className="hqr-badge hqr-badge-quiet">No comparable version</span>}
    </div>
    <div className="hqr-muted">{plural(item.candidate.claims.length, 'claim')} · {plural(item.candidate.evidence.length, 'artifact')} · reported {utc(item.candidate.observedAt)}</div>
    <div className="hqr-inline">
      <Button type="button" size="sm" onClick={onOpen}>{openLabel}</Button>
    </div>
  </Presence>;
}
