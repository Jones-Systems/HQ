import type { ReactNode } from 'react';
import { Button, IconButton } from '../components/Button';
import { cx } from '../components/cx';

export const NOTICE_TONES = ['neutral', 'info', 'success', 'warning', 'danger', 'unknown'] as const;
export type NoticeTone = (typeof NOTICE_TONES)[number];

export interface InlineNoticeAction {
  readonly label: string;
  readonly onAction: () => void;
  /** Shows a spinner and ignores activation while the action runs. */
  readonly busy?: boolean;
  readonly busyLabel?: string;
}

export interface InlineNoticeProps {
  readonly tone: NoticeTone;
  /** What happened, in a few words: "Couldn't refresh the board". */
  readonly title: string;
  /** What it means and what was kept: "Showing what loaded at 14:02. Nothing was changed." */
  readonly children?: ReactNode;
  /** One or two recovery actions ("Retry", "Check", "Open settings"). */
  readonly actions?: readonly InlineNoticeAction[];
  readonly onDismiss?: () => void;
  /** Accessible name for the notice region, when the title alone does not identify it ("Read-only reference"). */
  readonly label?: string;
  /** Accessible name for the dismiss button. Default: "Dismiss". */
  readonly dismissLabel?: string;
  /** `banner` (default) is a soft panel with title and description; `bar` is one compact line for the top of a list. */
  readonly variant?: 'banner' | 'bar';
  /**
   * Announcement when the notice appears after something the user did. Default: assertive for danger and unknown,
   * polite otherwise. Use `off` for notices already present when a view loads.
   */
  readonly live?: 'polite' | 'assertive' | 'off';
  readonly className?: string;
}

const GLYPHS: Record<NoticeTone, ReactNode> = {
  neutral: <><circle cx="12" cy="12" r="8.5" /><path d="M12 11v5M12 8h.01" /></>,
  info: <><circle cx="12" cy="12" r="8.5" /><path d="M12 11v5M12 8h.01" /></>,
  success: <><circle cx="12" cy="12" r="8.5" /><path d="m8.5 12.5 2.3 2.3 4.7-5" /></>,
  warning: <><path d="M12 4 21 19.5H3Z" /><path d="M12 10v4M12 17h.01" /></>,
  danger: <><circle cx="12" cy="12" r="8.5" /><path d="m9 9 6 6M15 9l-6 6" /></>,
  unknown: <><circle cx="12" cy="12" r="8.5" strokeDasharray="3 2.6" /><path d="M10 9.8a2.2 2.2 0 1 1 3 2c-.6.3-1 .8-1 1.4v.3M12 16.5h.01" /></>,
};

/**
 * Status or failure shown in place, on the screen the user is already looking at, instead of replacing it with a
 * full-screen error. Keep what loaded visible below it. Tone pairs a glyph with words, never colour alone.
 */
export function InlineNotice({ tone, title, children, actions = [], onDismiss, label, dismissLabel = 'Dismiss', variant = 'banner', live, className }: InlineNoticeProps) {
  const politeness = live ?? (tone === 'danger' || tone === 'unknown' ? 'assertive' : 'polite');
  return (
    <div className={cx('hq-notice', `hq-notice--${tone}`, variant === 'bar' && 'hq-notice--bar', className)} data-tone={tone} aria-label={label}
      role={politeness === 'assertive' ? 'alert' : politeness === 'polite' ? 'status' : undefined}>
      <span className="hq-notice-glyph" aria-hidden="true"><svg viewBox="0 0 24 24">{GLYPHS[tone]}</svg></span>
      <div className="hq-notice-text">
        <strong className="hq-notice-title">{title}</strong>
        {children && <span className="hq-notice-description">{children}</span>}
      </div>
      {(actions.length > 0 || onDismiss) && (
        <div className="hq-notice-actions">
          {actions.map((action) => (
            <Button key={action.label} size="sm" variant={tone === 'danger' && action === actions[0] ? 'secondary' : 'ghost'}
              busy={action.busy} busyLabel={action.busyLabel} onClick={action.onAction}>{action.label}</Button>
          ))}
          {onDismiss && (
            <IconButton size="sm" label={dismissLabel} onClick={onDismiss} icon={<svg viewBox="0 0 24 24"><path d="m7 7 10 10M17 7 7 17" /></svg>} />
          )}
        </div>
      )}
    </div>
  );
}
