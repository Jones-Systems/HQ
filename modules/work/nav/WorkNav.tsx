import { useId } from 'react';
import { NavIcon } from './icons';
import { NAV_ITEMS, type NavItem, type WorkPage } from './routes';

/** A count beside a nav item, with the words a screen reader hears for it. The button's own name stays its label. */
export interface NavCount {
  readonly count: number;
  readonly words: string;
}

export type NavCounts = Partial<Record<NavItem['page'], NavCount>>;

const GROUPS: readonly { readonly group: NavItem['group']; readonly label: string }[] = [
  { group: 'views', label: 'Views' },
  { group: 'boards', label: 'Boards' },
  { group: 'settings', label: 'Planner' },
];

/**
 * The Work secondary navigation (X-5): a line icon per page, Glance first, counts where they help (Inbox on the Status
 * board, prompts on Review) and the number key of each view. Counts and key hints are decoration for the eye; the
 * count's words reach assistive technology through `aria-describedby`, so each button is still named by its label.
 * The Status board item is where a capture lands when no Inbox column is on screen.
 */
export function WorkNav({ current, counts, onOpen }: { current: WorkPage | null; counts: NavCounts; onOpen(item: NavItem): void }) {
  const id = useId();
  return (
    <nav className="wd-nav" aria-label="Work">
      {GROUPS.map(({ group, label }) => (
        <section key={group} className="wd-nav-group">
          <p className="wd-group" id={`${id}-${group}`}>{label}</p>
          <ul aria-labelledby={`${id}-${group}`}>
            {NAV_ITEMS.filter((item) => item.group === group).map((item) => {
              const count = counts[item.page];
              const shown = count !== undefined && count.count > 0;
              const countId = `${id}-${item.page}-count`;
              return (
                <li key={item.page}>
                  <button
                    type="button" className="wd-nav-item"
                    aria-current={item.page === current ? 'page' : undefined}
                    aria-keyshortcuts={item.key}
                    aria-describedby={shown ? countId : undefined}
                    data-wk-capture-target={item.page === 'board' ? 'nav' : undefined}
                    title={item.key ? `${item.label} (${item.key})` : item.label}
                    onClick={() => onOpen(item)}
                  >
                    <NavIcon page={item.page} />
                    <span className="wd-nav-label">{item.label}</span>
                    <span className="wd-nav-trail" aria-hidden="true">
                      {shown && <span className="wk-count wd-nav-count" data-count={item.page}>{count.count}</span>}
                      {item.key && <kbd className="wk-kbd wd-nav-key">{item.key}</kbd>}
                    </span>
                  </button>
                  {shown && <span className="hq-sr-only" id={countId}>{count.words}</span>}
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </nav>
  );
}
