import { StateView } from '@hq/ui';
import {
  cardDate, dayNum, HORIZON_LABEL, HORIZONS, isLive, matchesFilters, MOTIVATION_LABEL, periodBounds, PRIORITY_LABEL,
  sortByPosition, STATUS_LABEL, STATUSES, type Horizon, type Item, type Status,
} from '../core';
import { isPending, useEnv, useRemembered } from './env';
import { ago, AreaTag, cx, Dash, DateChip, ExampleBadge, KindMark } from './parts';

// List (RV-4): a dense, sortable table with inline Status and Horizon. A
// status change is a `move` to the top of the new status (RW-7), so its Undo
// restores the exact place; a horizon change is a `{ horizon }` patch.

const STATUS_ORDER = Object.fromEntries(STATUSES.map((s, i) => [s.id, i])) as Record<string, number>;
const HORIZON_ORDER: Record<string, number> = { now: 0, soon: 1, later: 2, someday: 3 };
const PRIORITY_ORDER: Record<string, number> = { high: 0, normal: 1, low: 2 };
const MOTIVATION_ORDER: Record<string, number> = { need: 0, want: 1, exploring: 2 };

export const LIST_COLUMNS = [
  { key: 'title', label: 'Title' },
  { key: 'status', label: 'Status' },
  { key: 'motivation', label: 'Why' },
  { key: 'horizon', label: 'Horizon' },
  { key: 'priority', label: 'Priority' },
  { key: 'area', label: 'Area' },
  { key: 'date', label: 'Next date' },
  { key: 'steps', label: 'Steps' },
  { key: 'updated', label: 'Updated' },
] as const;
type SortKey = (typeof LIST_COLUMNS)[number]['key'];

const rank = (map: Record<string, number>, v: string | null) => (v !== null && v in map ? map[v]! : 99);
const steps = (item: Item) => ({ total: item.next_steps.length, done: item.next_steps.filter((s) => s.done).length });

function compare(a: Item, b: Item, key: SortKey, today: string): number {
  switch (key) {
    case 'title': return a.title.localeCompare(b.title);
    case 'status': return rank(STATUS_ORDER, a.status) - rank(STATUS_ORDER, b.status) || a.position - b.position;
    case 'motivation': return rank(MOTIVATION_ORDER, a.motivation) - rank(MOTIVATION_ORDER, b.motivation);
    case 'horizon': return rank(HORIZON_ORDER, a.horizon) - rank(HORIZON_ORDER, b.horizon);
    case 'priority': return rank(PRIORITY_ORDER, a.priority) - rank(PRIORITY_ORDER, b.priority);
    case 'area': return (a.area || '￿').localeCompare(b.area || '￿');
    case 'date': {
      const start = (item: Item) => {
        const d = cardDate(item, today);
        return d ? dayNum(periodBounds(d.entry.precision, d.entry.value)![0]) : Infinity;
      };
      const va = start(a);
      const vb = start(b);
      return va === vb ? 0 : va < vb ? -1 : 1;
    }
    case 'steps': return steps(b).total - steps(a).total;
    case 'updated': return a.updated_at < b.updated_at ? 1 : a.updated_at > b.updated_at ? -1 : 0;
  }
}

export function ListView() {
  const env = useEnv();
  const { today, state, settings } = env;
  const [sort, setSort] = useRemembered<{ key: SortKey; dir: 1 | -1 }>('list.sort', { key: 'status', dir: 1 });
  const items = sortByPosition(state.items.filter((it) => isLive(it) && matchesFilters(it, env.filters)));
  if (!items.length) {
    return (
      <StateView
        state="empty"
        title="Nothing to list"
        description={state.items.some(isLive) ? 'No items match the current filters.' : 'Add your first item to see it here.'}
      />
    );
  }
  items.sort((a, b) => compare(a, b, sort.key, today) * sort.dir || a.position - b.position);

  const move = (item: Item, status: Status) => {
    if (status === item.status) return;
    void env.run(env.store.move(item.id, status, { place: 'top' }), `Moved “${item.title}” to ${STATUS_LABEL[status]}.`);
  };
  const setHorizon = (item: Item, horizon: Horizon | null) => {
    if (horizon === item.horizon) return;
    void env.run(env.store.patch(item.id, { horizon }), `“${item.title}” is now ${horizon ? HORIZON_LABEL[horizon] : 'without a horizon'}.`);
  };

  return (
    <div className="wv-table-wrap">
      <table className="wv-table">
        <thead>
          <tr>
            {LIST_COLUMNS.map((col) => {
              const active = sort.key === col.key;
              return (
                <th key={col.key} scope="col" className={`wv-col-${col.key}`} aria-sort={active ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'}>
                  <button
                    type="button"
                    className="wv-th-sort"
                    onClick={() => setSort(active ? { key: col.key, dir: sort.dir === 1 ? -1 : 1 } : { key: col.key, dir: 1 })}
                  >
                    {col.label}{active && <span aria-hidden="true">{sort.dir === 1 ? ' ↑' : ' ↓'}</span>}
                  </button>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {items.map((item) => {
            const date = cardDate(item, today);
            const s = steps(item);
            return (
              <tr key={item.id} className={cx(isPending(state, item.id) && 'is-pending', item.is_example && 'is-example')}>
                <td className="wv-col-title">
                  <KindMark kind={item.kind} />
                  {env.openItem
                    ? <button type="button" className="wv-link" onClick={() => env.openItem!(item.id)}>{item.title}</button>
                    : <span>{item.title}</span>}
                  <ExampleBadge item={item} />
                </td>
                <td className="wv-col-status">
                  <select
                    className={cx('wv-select', `wv-st--${item.status}`)}
                    aria-label={`Status of ${item.title}`}
                    value={item.status}
                    onChange={(event) => move(item, event.target.value as Status)}
                  >
                    {STATUSES.map((st) => <option key={st.id} value={st.id}>{st.label}</option>)}
                  </select>
                </td>
                <td className="wv-col-motivation">{item.motivation ? <span className={`wv-pill wv-pill--${item.motivation}`}>{MOTIVATION_LABEL[item.motivation]}</span> : <Dash />}</td>
                <td className="wv-col-horizon">
                  <select
                    className="wv-select"
                    aria-label={`Horizon of ${item.title}`}
                    value={item.horizon ?? ''}
                    onChange={(event) => setHorizon(item, (event.target.value || null) as Horizon | null)}
                  >
                    <option value="">—</option>
                    {HORIZONS.map((h) => <option key={h.id} value={h.id}>{h.label}</option>)}
                  </select>
                </td>
                <td className="wv-col-priority">{item.priority ? <span className={`wv-prio--${item.priority}`}>{PRIORITY_LABEL[item.priority]}</span> : <Dash />}</td>
                <td className="wv-col-area">{item.area ? <AreaTag area={item.area} /> : <Dash />}</td>
                <td className="wv-col-date">{date ? <DateChip entry={date.entry} state={date.state} /> : <Dash />}</td>
                <td className="wv-col-steps">{s.total ? `${s.done}/${s.total}` : <Dash />}</td>
                <td className="wv-col-updated wv-muted">{ago(item.updated_at, env.now(), settings)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
