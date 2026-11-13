import { Children, createElement, forwardRef, type HTMLAttributes, type ReactNode } from 'react';
import { cx } from '../components/cx';

export interface PanelProps extends HTMLAttributes<HTMLDivElement> {
  readonly padding?: 'compact' | 'comfortable';
}

export const Panel = forwardRef<HTMLDivElement, PanelProps>(function Panel({ padding = 'comfortable', className, ...props }, ref) {
  return <div {...props} ref={ref} className={cx('hq-panel', `hq-panel--${padding}`, className)} />;
});

export interface PanelHeaderProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  readonly title: ReactNode;
  readonly headingLevel?: 2 | 3 | 4 | 5 | 6;
  readonly description?: ReactNode;
  /** Caller-owned freshness, provenance or limitation disclosure; never inferred by the panel. */
  readonly metadata?: ReactNode;
  readonly actions?: ReactNode;
}

export function PanelHeader({ title, headingLevel = 2, description, metadata, actions, children, className, ...props }: PanelHeaderProps) {
  return <div {...props} className={cx('hq-panel-header', className)}>
    <div className="hq-panel-heading">
      {createElement(`h${headingLevel}`, { className: 'hq-panel-title' }, title)}
      {description != null && <div className="hq-panel-description">{description}</div>}
      {metadata != null && <div className="hq-panel-metadata">{metadata}</div>}
      {children}
    </div>
    {actions != null && <div className="hq-panel-actions">{actions}</div>}
  </div>;
}

export function PanelRows({ children, className, ...props }: HTMLAttributes<HTMLUListElement>) {
  return <ul {...props} className={cx('hq-panel-rows', className)}>
    {Children.map(children, child => child != null && typeof child !== 'boolean' ? <li className="hq-panel-row">{child}</li> : null)}
  </ul>;
}

export function PanelGrid({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div {...props} className={cx('hq-panel-grid', className)} />;
}

export function TileGrid({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div {...props} className={cx('hq-tile-grid', className)} />;
}
