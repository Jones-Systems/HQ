import type { ReactNode } from 'react';
import { Button } from './Button';
import { cx } from './cx';

/** RS-3 panel states. `unknown` means a result was not confirmed; it is never shown as success or failure. */
export const VIEW_STATES = ['empty', 'loading', 'error', 'offline', 'unavailable', 'unknown'] as const;
export type ViewState = (typeof VIEW_STATES)[number];

export interface StateViewAction {
  readonly label: string;
  readonly onAction: () => void;
}

export interface StateViewProps {
  readonly state: ViewState;
  readonly title: string;
  readonly description?: ReactNode;
  readonly action?: StateViewAction;
  readonly className?: string;
}

const GLYPHS: Record<Exclude<ViewState, 'loading'>, ReactNode> = {
  empty: <path d="M4 13h4l1.5 2.5h5L16 13h4M4 13l2.5-7h11L20 13v6H4z" />,
  error: <><circle cx="12" cy="12" r="8.5" /><path d="M12 8v5M12 16h.01" /></>,
  offline: <path d="M4 4l16 16M8 8a5 5 0 0 0-1 9.5h9M12 6.5a5 5 0 0 1 5.5 4 3.5 3.5 0 0 1 2 5.5" />,
  unavailable: <><circle cx="12" cy="12" r="8.5" /><path d="m6 6 12 12" /></>,
  unknown: <path d="M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6v.6M12 17h.01" />,
};

export function StateView({ state, title, description, action, className }: StateViewProps) {
  if (state === 'loading') {
    return (
      <div className={cx('hq-state', 'hq-state--loading', className)} data-state={state} aria-busy="true">
        <span className="hq-save hq-save--saving" role="status"><span className="hq-spinner" aria-hidden="true" />{title}</span>
        <span className="hq-skeleton hq-skeleton--80" aria-hidden="true" />
        <span className="hq-skeleton hq-skeleton--95" aria-hidden="true" />
        <span className="hq-skeleton hq-skeleton--60" aria-hidden="true" />
      </div>
    );
  }
  return (
    <div className={cx('hq-state', `hq-state--${state}`, className)} data-state={state} role={state === 'error' ? 'alert' : undefined}>
      <span className={cx('hq-state-glyph', `hq-state-glyph--${state}`)} aria-hidden="true"><svg viewBox="0 0 24 24">{GLYPHS[state]}</svg></span>
      <strong className="hq-state-title">{title}</strong>
      {description && <p className="hq-state-description">{description}</p>}
      {action && <Button size="sm" variant="secondary" onClick={action.onAction}>{action.label}</Button>}
    </div>
  );
}
