import type { ReactNode } from 'react';
import { cx } from './cx';

/**
 * Each tone has its own shape, so status never depends on colour: success a filled dot, warning a half dot,
 * danger a filled square, info a ringed dot, unknown a dashed ring, unavailable a slashed ring, neutral an open
 * ring. The first four T2 freshness shapes (fresh, stale, unknown, unavailable) map to success, warning, unknown
 * and unavailable.
 */
export const STATUS_TONES = ['neutral', 'success', 'warning', 'danger', 'info', 'unknown', 'unavailable'] as const;
export type StatusTone = (typeof STATUS_TONES)[number];

export interface StatusChipProps {
  readonly tone: StatusTone;
  /** The status word, always visible, for example "Fresh", "Stale" or "Unknown". */
  readonly label: string;
  /** Optional mono detail after the word, for example "observed 2 min ago". */
  readonly detail?: ReactNode;
  readonly className?: string;
}

export function StatusChip({ tone, label, detail, className }: StatusChipProps) {
  if (label.trim() === '') throw new Error('StatusChip needs a visible status word; colour alone is never a status');
  return (
    <span className={cx('hq-status', `hq-status--${tone}`, className)} data-tone={tone}>
      <span className="hq-status-shape" aria-hidden="true" />
      <b className="hq-status-label">{label}</b>
      {detail && <span className="hq-status-detail">{detail}</span>}
    </span>
  );
}
