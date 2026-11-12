import { Skeleton } from '@hq/ui';

const COLUMNS = [3, 2, 3, 2] as const;

/**
 * The board while the first snapshot loads: columns with card placeholders, so the page keeps its shape. The status line
 * is real text for screen readers; the shapes are hidden from them.
 */
export function BoardSkeleton() {
  return (
    <div className="work-skeleton" aria-busy="true">
      <p className="wk-quiet" role="status">Loading the Planner…</p>
      <div className="work-skeleton-columns" aria-hidden="true">
        {COLUMNS.map((cards, column) => (
          <div key={column} className="work-col work-skeleton-col">
            <Skeleton shape="text" width="45%" />
            <div className="work-skeleton-cards">
              {Array.from({ length: cards }, (_, card) => (
                <div key={card} className="work-skeleton-card">
                  <Skeleton shape="text" lines={card % 2 === 0 ? 2 : 1} />
                  <div className="work-skeleton-chips"><Skeleton shape="block" width="44px" height="20px" /><Skeleton shape="block" width="58px" height="20px" /></div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
