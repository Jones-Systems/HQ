import type { ReactNode } from 'react';
import { SocialIcon, type SocialIconName } from './icons';

/**
 * A compact empty state for inside a panel, list or column: what goes here and one way to start. Use `@hq/ui`
 * `StateView` only when a whole page has nothing to show.
 */
export function EmptyState({ icon = 'sparkle', title, children, action }: {
  readonly icon?: SocialIconName;
  readonly title: ReactNode;
  readonly children?: ReactNode;
  readonly action?: ReactNode;
}) {
  return (
    <div className="sx-empty">
      <span className="sx-empty-icon"><SocialIcon name={icon} /></span>
      <p className="sx-empty-title">{title}</p>
      {children && <p className="sx-empty-text">{children}</p>}
      {action && <div className="sx-empty-action">{action}</div>}
    </div>
  );
}
