import type { ReactNode } from 'react';
import { StatusChip, type StatusTone } from '../components/StatusChip';
import { cx } from '../components/cx';

export interface StatusIndicatorProps {
  readonly tone: StatusTone;
  /** The status word, always visible: "Synced", "Offline", "Couldn't refresh". */
  readonly label: string;
  /** Mono detail after the word: "2 min ago", "kept on this device". */
  readonly detail?: ReactNode;
  /** Work in progress: a spinner replaces the shape ("Syncing…"). */
  readonly busy?: boolean;
  /** One small text action after the status: Retry, Check, Reconnect. */
  readonly action?: { readonly label: string; readonly onAction: () => void };
  /** Politely announce changes. Default true; turn off for many indicators in a list. */
  readonly live?: boolean;
  readonly className?: string;
}

/**
 * Compact, persistent status for a toolbar, panel header or row: a shape, a word, optional detail and one action.
 * Use it for ongoing state (offline, stale, syncing); use a toast for a one-off event.
 */
export function StatusIndicator({ tone, label, detail, busy = false, action, live = true, className }: StatusIndicatorProps) {
  return (
    <span className={cx('hq-indicator', busy && 'hq-indicator--busy', className)} data-tone={tone}
      role={live ? 'status' : undefined} aria-busy={busy || undefined}>
      {busy
        ? <span className={cx('hq-status', `hq-status--${tone}`)}><span className="hq-spinner" aria-hidden="true" /><b className="hq-status-label">{label}</b>{detail && <span className="hq-status-detail">{detail}</span>}</span>
        : <StatusChip tone={tone} label={label} detail={detail} />}
      {action && <button type="button" className="hq-save-action" onClick={action.onAction}>{action.label}</button>}
    </span>
  );
}
