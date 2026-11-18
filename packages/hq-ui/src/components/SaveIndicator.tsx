import type { ReactNode } from 'react';
import { cx } from './cx';

/** RS-3 save states. Saving is local persistence only and never starts execution. */
export const SAVE_STATES = ['saved', 'saving', 'unsaved', 'failed', 'offline', 'unknown'] as const;
export type SaveState = (typeof SAVE_STATES)[number];

export interface SaveIndicatorProps {
  readonly state: SaveState;
  /** Display time for `saved`, for example "14:02". */
  readonly savedAt?: string;
  /** Required for `failed`: the user's explicit retry of the local save. */
  readonly onRetry?: () => void;
  /**
   * Required for `unknown`: read back whether the save landed before anything is retried. A save whose result is
   * unknown is never retried blindly.
   */
  readonly onCheck?: () => void;
  readonly className?: string;
}

const CHECK = <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5" /></svg>;
const OFFLINE = <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 4l16 16M8 8a5 5 0 0 0-1 9.5h9M12 6.5a5 5 0 0 1 5.5 4 3.5 3.5 0 0 1 2 5.5" /></svg>;

function text(state: SaveState, savedAt?: string): { glyph?: ReactNode; words: string } {
  switch (state) {
    case 'saved': return { glyph: CHECK, words: savedAt ? `Saved ${savedAt}` : 'Saved' };
    case 'saving': return { glyph: <span className="hq-spinner" aria-hidden="true" />, words: 'Saving…' };
    case 'unsaved': return { words: 'Unsaved changes' };
    case 'failed': return { words: 'Not saved' };
    case 'offline': return { glyph: OFFLINE, words: 'Offline · kept on this device' };
    case 'unknown': return { words: 'Save result unknown' };
  }
}

/** The words are a polite live region; the Retry and Check buttons sit outside it so they are not re-announced. */
export function SaveIndicator({ state, savedAt, onRetry, onCheck, className }: SaveIndicatorProps) {
  const { glyph, words } = text(state, savedAt);
  const action = state === 'failed' && onRetry ? { label: 'Retry', run: onRetry }
    : state === 'unknown' && onCheck ? { label: 'Check', run: onCheck } : undefined;
  return (
    <span className={cx('hq-save', `hq-save--${state}`, className)} data-state={state}>
      {glyph}
      <span role="status">{words}</span>
      {action && <><span aria-hidden="true">·</span><button type="button" className="hq-save-action" onClick={action.run}>{action.label}</button></>}
    </span>
  );
}
