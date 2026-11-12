import type { ReactNode } from 'react';

export interface PageHeaderProps {
  readonly title: ReactNode;
  /** Id for the title, so a section can be `aria-labelledby` it. */
  readonly titleId?: string;
  readonly eyebrow?: ReactNode;
  /** One quiet line under the title: a summary or the page's rule. */
  readonly meta?: ReactNode;
  /** Controls at the trailing edge, such as a segmented switcher or date navigation. */
  readonly actions?: ReactNode;
  /** Optional full-width row under the header, for example filters that belong to this page. */
  readonly children?: ReactNode;
}

/** The one page header every Work page uses: title, optional eyebrow and meta line, trailing actions. */
export function PageHeader({ title, titleId, eyebrow, meta, actions, children }: PageHeaderProps) {
  return (
    <header className="wk-page-head">
      <div className="wk-page-head-main">
        {eyebrow && <p className="wk-eyebrow">{eyebrow}</p>}
        <h2 className="wk-page-title" id={titleId}>{title}</h2>
        {meta && <p className="wk-page-meta">{meta}</p>}
      </div>
      {actions && <div className="wk-page-actions">{actions}</div>}
      {children}
    </header>
  );
}

export interface SegmentedNavItem {
  readonly id: string;
  readonly label: ReactNode;
  readonly current: boolean;
  readonly onSelect: () => void;
  /** Extra trailing content, such as a "Proposed" tag or a count. */
  readonly trailing?: ReactNode;
}

/** A compact segmented switcher between sibling pages (navigation only: selecting never writes). */
export function SegmentedNav({ label, items }: { readonly label: string; readonly items: readonly SegmentedNavItem[] }) {
  return (
    <nav className="wk-seg" aria-label={label}>
      {items.map((item) => (
        <button
          key={item.id} type="button" className="wk-seg-item"
          aria-current={item.current ? 'page' : undefined}
          onClick={item.onSelect}
        >
          {item.label}{item.trailing}
        </button>
      ))}
    </nav>
  );
}
