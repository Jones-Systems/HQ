import type { DragEvent, KeyboardEvent } from 'react';
import { Menu } from '@hq/ui';
import {
  BY_DATE_GROUPS, cardDate, DATE_KIND_LABEL, formatDay, formatValue, groupByDate, matchesFilters, STATUS_LABEL, STATUSES, weekBounds,
  type ByDateGroup, type Item, type Status,
} from '../core';
import { isPending, useEnv } from './env';
import { AreaTag, cx, DateChip, HorizonChip, KindMark, MoreIcon, MotivationPill, StatusMark } from './parts';

// By date (RV-5, T4; "Lists" is an alias). A read-only board that groups open
// items by their own dates: Today, This week (bounded by the Planner's
// week_start), Later and Undated. Placement here never writes: drag and
// keyboard moves are inert and explained, the menu offers status moves only,
// and no date or horizon is ever written or relabelled from a group.

export const BY_DATE_BANNER = "This board is read-only, so dragging is off. To move a card to another group, change its date in the card. Status and horizon don't change here. Done and Dropped are hidden.";
export const BY_DATE_INERT = 'By date is read-only. To move a card to another group, change its date in the card.';

const MOVE_KEYS = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown']);

export function ByDateView() {
  const env = useEnv();
  const { state, settings, today } = env;
  const groups = groupByDate(state.items.filter((it) => matchesFilters(it, env.filters)), settings, env.now());
  const weekEnd = weekBounds(today, settings.week_start)[1];
  const rule = (id: ByDateGroup, text: string) => (id === 'week' ? `${text} (to ${formatDay(weekEnd)})` : id === 'undated' ? `${text}. Dates are never invented` : text);

  const inert = (event: DragEvent | KeyboardEvent) => {
    event.preventDefault();
    env.announce(BY_DATE_INERT);
  };

  return (
    <div className="wv-bydate">
      <div className="wv-banner wv-banner--info" role="note">
        <strong>Grouped from each card's own dates.</strong> {BY_DATE_BANNER}
      </div>
      <div className="wv-board" data-board-kind="by-date">
        {BY_DATE_GROUPS.map((g) => {
          const list = groups[g.id];
          return (
            <section key={g.id} className="wv-col" data-group={g.id} aria-label={`${g.label}, ${list.length} item${list.length === 1 ? '' : 's'}`} onDrop={inert} onDragOver={(event) => { if (event.dataTransfer) event.dataTransfer.dropEffect = 'none'; }}>
              <header className="wv-col-head"><h3 className="wv-col-name">{g.label}</h3><span className="wv-count">{list.length}</span></header>
              <p className="wv-col-rule">{rule(g.id, g.rule)}</p>
              <div className="wv-col-list">
                {list.length ? list.map((item) => <ByDateCard key={item.id} item={item} onInert={inert} />) : <div className="wv-col-empty">Nothing here</div>}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}

function ByDateCard({ item, onInert }: { item: Item; onInert: (event: DragEvent | KeyboardEvent) => void }) {
  const env = useEnv();
  const date = cardDate(item, env.today);
  const move = (status: Status) => void env.run(env.store.move(item.id, status, { place: 'top' }), `Moved “${item.title}” to ${STATUS_LABEL[status]}.`);
  const onKey = (event: KeyboardEvent<HTMLElement>) => {
    if (event.target !== event.currentTarget) return;
    if (event.altKey && MOVE_KEYS.has(event.key)) { onInert(event); return; }
    if (event.key === 'Enter' && env.openItem) { event.preventDefault(); env.openItem(item.id); return; }
    if (event.key === 'm' || event.key === 'M') {
      event.preventDefault();
      event.currentTarget.querySelector<HTMLButtonElement>('.wv-card-menu button')?.click();
    }
  };
  return (
    <article
      className={cx('wv-card', isPending(env.state, item.id) && 'is-pending', item.is_example && 'is-example')}
      tabIndex={0}
      draggable={false}
      onDragStart={onInert}
      onKeyDown={onKey}
      data-item-id={item.id}
      aria-label={`${item.title}, ${STATUS_LABEL[item.status]}, ${date ? `${DATE_KIND_LABEL[date.entry.kind]} ${formatValue(date.entry, env.today)}` : 'no date'}. Read-only here; M for status moves.`}
    >
      <div className="wv-card-head">
        <KindMark kind={item.kind} />
        <h4 className="wv-card-title">
          {env.openItem ? <button type="button" className="wv-link" tabIndex={-1} onClick={() => env.openItem!(item.id)}>{item.title}</button> : item.title}
        </h4>
        <Menu
          className="wv-card-menu"
          size="sm"
          variant="ghost"
          align="end"
          trigger={<MoreIcon />}
          triggerLabel={`Move “${item.title}” to a status`}
          items={STATUSES.map((s) => ({ id: s.id, label: s.label, disabled: s.id === item.status, onSelect: () => move(s.id) }))}
        />
      </div>
      <div className="wv-card-meta">
        <StatusMark status={item.status} />
        <MotivationPill motivation={item.motivation} />
        <HorizonChip horizon={item.horizon} />
        <AreaTag area={item.area} />
      </div>
      {date && <div className="wv-card-foot"><DateChip entry={date.entry} state={date.state} /></div>}
    </article>
  );
}
