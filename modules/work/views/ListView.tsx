import type { MouseEvent, ReactNode } from 'react';
import { StateView, useListMotion, usePresence } from '@hq/ui';
import {
  cardDate, dayNum, HORIZON_LABEL, HORIZONS, isLive, matchesFilters, MOTIVATION_LABEL, MOTIVATIONS, periodBounds, PRIORITIES, PRIORITY_LABEL,
  sortByPosition, STATUS_LABEL, STATUSES, type Horizon, type Item, type Motivation, type Priority, type Status,
} from '../core';
import { leavingProps, useExiting } from '../detail/exiting';
import { DoneButton, PageHeader, StatusDot } from '../theme';
import { isPending, pendingWord, useEnv, useRemembered } from './env';
import { ago, AreaTag, cx, Dash, DateChip, ExampleBadge, KindMark } from './parts';
import './list.css';

// List (RV-4): a dense, sortable table with inline Status, Why, Horizon and Priority. A status change is a `move` to
// the top of the new status (RW-7), so its Undo restores the exact place; the other three are one-field patches. The
// same applies to the Done control at the row's edge: one move to Done, place top, with Undo. Rows glide when the sort
// or the filters change and fade out when they stop matching. The inline pickers are native selects drawn as chips, so
// keyboard, type-ahead, screen readers and the platform's own menu all work as they do anywhere else.

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
const isClosed = (item: Item) => item.status === 'done' || item.status === 'dropped';

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

const CHEVRON = <svg className="wl-pick-chevron" viewBox="0 0 24 24" aria-hidden="true"><path d="m7 10 5 5 5-5" /></svg>;
const SORT_ARROW = <svg className="wl-sort-arrow" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 19V6m-5 5 5-5 5 5" /></svg>;

interface PickProps {
  readonly label: string;
  readonly value: string;
  readonly options: readonly { readonly id: string; readonly label: string }[];
  /** The word for "not set"; omit when there is no empty value. */
  readonly empty?: string;
  readonly tone?: string;
  readonly leading?: ReactNode;
  readonly onChange: (value: string) => void;
}

/** A native select drawn as a compact chip: the word, an optional shape and a chevron. The select is the control. */
function Pick({ label, value, options, empty, tone, leading, onChange }: PickProps) {
  return (
    <span className={cx('wl-pick', tone && `wl-pick--${tone}`, value === '' && 'is-empty', leading ? 'has-lead' : false)}>
      {leading}
      <select className="wl-pick-select" aria-label={label} value={value} onChange={(event) => onChange(event.target.value)}>
        {empty !== undefined && <option value="">{empty}</option>}
        {options.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
      </select>
      {CHEVRON}
    </span>
  );
}

const STATUS_OPTIONS = STATUSES.map((s) => ({ id: s.id, label: s.label }));
const MOTIVATION_OPTIONS = MOTIVATIONS.map((m) => ({ id: m.id, label: m.label }));
const HORIZON_OPTIONS = HORIZONS.map((h) => ({ id: h.id, label: h.label }));
const PRIORITY_OPTIONS = PRIORITIES.map((p) => ({ id: p.id, label: p.label }));

interface RowProps {
  readonly item: Item;
  readonly leaving: boolean;
  readonly onExited: () => void;
  readonly onMove: (item: Item, status: Status) => void;
  readonly onHorizon: (item: Item, horizon: Horizon | null) => void;
  readonly onMotivation: (item: Item, motivation: Motivation | null) => void;
  readonly onPriority: (item: Item, priority: Priority | null) => void;
}

function Row({ item, leaving, onExited, onMove, onHorizon, onMotivation, onPriority }: RowProps) {
  const env = useEnv();
  const { today, state, settings } = env;
  // A row that stops matching fades out through Presence. List motion owns entering and moving rows.
  const presence = usePresence<HTMLTableRowElement>(!leaving, { motion: 'fade', initial: false, onExited });
  const date = cardDate(item, today);
  const s = steps(item);
  const closed = isClosed(item);
  const pending = pendingWord(state, item.id);
  const open = (event: MouseEvent<HTMLTableRowElement>) => {
    if (leaving || !env.openItem || (event.target as HTMLElement).closest('button, select, a, input, label')) return;
    env.openItem(item.id);
  };
  return (
    <tr
      ref={presence.ref} {...presence.props} {...leavingProps(leaving)} data-hq-motion-key={item.id} data-row-id={item.id}
      className={cx('wl-row', isPending(state, item.id) && 'is-pending', item.is_example && 'is-example', closed && 'is-closed', env.openItem && 'is-openable')}
      onClick={open}
    >
      <td className="wl-c-done">
        {!closed && <DoneButton label={`Mark “${item.title}” done`} onDone={() => onMove(item, 'done')} />}
      </td>
      <td className="wv-col-title">
        <div className="wl-title">
          <KindMark kind={item.kind} />
          {env.openItem
            ? <button type="button" className="wv-link wl-title-text" title={item.title} onClick={() => env.openItem!(item.id)}>{item.title}</button>
            : <span className="wl-title-text" title={item.title}>{item.title}</span>}
          <ExampleBadge item={item} />
          {pending && <span className="wv-pending">{pending}</span>}
        </div>
      </td>
      <td className="wv-col-status">
        <Pick
          label={`Status of ${item.title}`} value={item.status} options={STATUS_OPTIONS} tone={`st-${item.status}`}
          leading={<StatusDot status={item.status} />}
          onChange={(value) => onMove(item, value as Status)}
        />
      </td>
      <td className="wv-col-motivation">
        <Pick
          label={`Why of ${item.title}`} value={item.motivation ?? ''} options={MOTIVATION_OPTIONS} empty="—" tone={item.motivation ?? undefined}
          onChange={(value) => onMotivation(item, (value || null) as Motivation | null)}
        />
      </td>
      <td className="wv-col-horizon">
        <Pick
          label={`Horizon of ${item.title}`} value={item.horizon ?? ''} options={HORIZON_OPTIONS} empty="—"
          onChange={(value) => onHorizon(item, (value || null) as Horizon | null)}
        />
      </td>
      <td className="wv-col-priority">
        <Pick
          label={`Priority of ${item.title}`} value={item.priority ?? ''} options={PRIORITY_OPTIONS} empty="—" tone={item.priority === 'high' ? 'high' : undefined}
          onChange={(value) => onPriority(item, (value || null) as Priority | null)}
        />
      </td>
      <td className="wv-col-area">{item.area ? <AreaTag area={item.area} /> : <Dash />}</td>
      <td className="wv-col-date">{date ? <DateChip entry={date.entry} state={date.state} /> : <Dash />}</td>
      <td className="wv-col-steps">{s.total ? <span className="wl-steps">{s.done}/{s.total}</span> : <Dash />}</td>
      <td className="wv-col-updated wv-muted">{ago(item.updated_at, env.now(), settings)}</td>
    </tr>
  );
}

export function ListView() {
  const env = useEnv();
  const { today, state } = env;
  const [sort, setSort] = useRemembered<{ key: SortKey; dir: 1 | -1 }>('list.sort', { key: 'status', dir: 1 });
  const live = state.items.filter(isLive);
  const items = sortByPosition(live.filter((it) => matchesFilters(it, env.filters)));
  items.sort((a, b) => compare(a, b, sort.key, today) * sort.dir || a.position - b.position);
  const rows = useExiting(items, (item) => item.id, { clearWhenEmpty: true });
  const listRef = useListMotion<HTMLTableSectionElement>(rows.map((row) => row.item.id), { animateEntering: true });

  const count = items.length === live.length
    ? `${items.length} ${items.length === 1 ? 'item' : 'items'}`
    : `${items.length} of ${live.length} items`;
  const header = (
    <PageHeader
      title="List"
      meta={`${count} · Status changes here use the same move as the board, so Undo restores a card’s place.`}
    />
  );

  if (!items.length) {
    return (
      <div className="wl">
        {header}
        <StateView
          state="empty"
          title="Nothing to list"
          description={live.length ? 'No items match the current filters.' : 'Add your first item to see it here.'}
        />
      </div>
    );
  }

  const move = (item: Item, status: Status) => {
    if (status === item.status) return;
    void env.run(env.store.move(item.id, status, { place: 'top' }), `Moved “${item.title}” to ${STATUS_LABEL[status]}.`);
  };
  const setHorizon = (item: Item, horizon: Horizon | null) => {
    if (horizon === item.horizon) return;
    void env.run(env.store.patch(item.id, { horizon }), `“${item.title}” is now ${horizon ? HORIZON_LABEL[horizon] : 'without a horizon'}.`);
  };
  const setMotivation = (item: Item, motivation: Motivation | null) => {
    if (motivation === item.motivation) return;
    void env.run(env.store.patch(item.id, { motivation }), motivation ? `“${item.title}” is now ${MOTIVATION_LABEL[motivation]}.` : `“${item.title}” has no why.`);
  };
  const setPriority = (item: Item, priority: Priority | null) => {
    if (priority === item.priority) return;
    void env.run(env.store.patch(item.id, { priority }), priority ? `“${item.title}” is now ${PRIORITY_LABEL[priority]} priority.` : `“${item.title}” has no priority.`);
  };

  return (
    <div className="wl">
      {header}
      <div className="wl-wrap">
        <table className="wl-table wv-table">
          <thead>
            <tr>
              <th scope="col" className="wl-c-done"><span className="wv-sr">Mark done</span></th>
              {LIST_COLUMNS.map((col) => {
                const active = sort.key === col.key;
                return (
                  <th key={col.key} scope="col" className={`wv-col-${col.key}`} aria-sort={active ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'}>
                    <button
                      type="button"
                      className="wv-th-sort wl-sort"
                      data-dir={active ? (sort.dir === 1 ? 'asc' : 'desc') : undefined}
                      onClick={() => setSort(active ? { key: col.key, dir: sort.dir === 1 ? -1 : 1 } : { key: col.key, dir: 1 })}
                    >
                      {col.label}{SORT_ARROW}
                    </button>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody ref={listRef}>
            {rows.map(({ item, leaving, onExited }) => (
              <Row
                key={item.id} item={item} leaving={leaving} onExited={onExited}
                onMove={move} onHorizon={setHorizon} onMotivation={setMotivation} onPriority={setPriority}
              />
            ))}
          </tbody>
        </table>
      </div>
      <p className="wk-quiet wl-narrow-note">Some columns are hidden at this width. Open an item to see all of its fields.</p>
    </div>
  );
}
