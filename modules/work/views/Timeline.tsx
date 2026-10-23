import { useEffect, useRef, useState, type DragEvent, type KeyboardEvent, type ReactNode } from 'react';
import { Menu } from '@hq/ui';
import {
  DATE_KIND_LABEL, formatShort, formatValue, HORIZON_LABEL, isLive, isOpen, matchesFilters, sortByPosition,
  type Horizon, type Item,
} from '../core';
import { isPending, useCssVars, useEnv, useRemembered } from './env';
import { stepHorizon, timelineGeometry, timelineScale, TIMELINE_LANES } from './moves';
import { cx, KindMark, MoreIcon, MotivationPill, ViewHint } from './parts';

// Timeline (RV-4): horizon lanes across eight quarters. A row changes horizon
// by drag to another lane, Alt+↑/↓ to the adjacent lane, or its menu (M). Each
// is one `{ horizon }` patch with Undo. Coarse dates draw as the period they
// name, and a bar joins a start date to a later target or deadline only when
// the owner set both ends.

const laneKey = (horizon: Horizon | null) => horizon ?? 'none';

function Placed({ className, left, width, title, children }: { className: string; left: number; width?: number; title?: string; children?: ReactNode }) {
  const ref = useRef<HTMLSpanElement>(null);
  useCssVars(ref, width === undefined ? { '--wv-left': `${left}%` } : { '--wv-left': `${left}%`, '--wv-width': `${width}%` });
  return <span ref={ref} className={className} title={title} role={title ? 'img' : undefined} aria-label={title}>{children}</span>;
}

export function TimelineView() {
  const env = useEnv();
  const { today, state } = env;
  const [focusId, setFocusId] = useState<string | null>(null);
  const [offset, setOffset] = useRemembered('timeline.offset', 0);
  const dragging = useRef<string | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const timeline = useRef<HTMLDivElement>(null);
  const items = state.items.filter((it) => isLive(it) && isOpen(it) && matchesFilters(it, env.filters));
  const scale = timelineScale(today, offset);
  const todayVisible = scale.today >= 0 && scale.today <= 100;
  useCssVars(timeline, { '--wv-today': `${scale.today}%` });
  const quarterLabel = (value: string) => `${value.slice(5)} ${value.slice(0, 4)}`;

  useEffect(() => {
    if (!focusId || !root.current) return;
    const row = [...root.current.querySelectorAll<HTMLElement>('[data-row-id]')].find((el) => el.dataset.rowId === focusId);
    if (row && document.activeElement !== row) row.focus();
  }, [focusId, state.items]);

  const setHorizon = (id: string, horizon: Horizon | null): Promise<unknown> => {
    const item = state.items.find((it) => it.id === id);
    if (!item || item.horizon === horizon) {
      if (item) env.announce('Same horizon');
      return Promise.resolve();
    }
    return env.run(env.store.patch(id, { horizon }), `“${item.title}” is now ${horizon ? HORIZON_LABEL[horizon] : 'without a horizon'}.`);
  };

  const onRowKey = (event: KeyboardEvent<HTMLDivElement>, item: Item) => {
    if (event.target !== event.currentTarget) return;
    if (event.key === 'Enter' && env.openItem) { event.preventDefault(); env.openItem(item.id); return; }
    if (event.key === 'm' || event.key === 'M') {
      event.preventDefault();
      event.currentTarget.querySelector<HTMLButtonElement>('.wv-tl-menu button')?.click();
      return;
    }
    if (!event.altKey || (event.key !== 'ArrowUp' && event.key !== 'ArrowDown')) return;
    event.preventDefault();
    const next = stepHorizon(item.horizon, event.key === 'ArrowUp' ? -1 : 1);
    if (next === undefined) return;
    // The row moves to another lane and remounts; focus follows it until the write settles.
    setFocusId(item.id);
    void setHorizon(item.id, next).finally(() => setFocusId((f) => (f === item.id ? null : f)));
  };

  return (
    <div ref={root} className="wv-tl-wrap">
      <ViewHint>Drag a row to another lane to change its horizon, or press Alt+↑ or Alt+↓, or M for its menu. Bars appear only between a start date and a later target or deadline you set.</ViewHint>
      <div className="wv-tl-nav">
        <div className="wv-seg" role="group" aria-label="Timeline navigation">
          <button type="button" className="wv-seg-btn" onClick={() => setOffset(offset - 4)}>Earlier</button>
          <button type="button" className="wv-seg-btn" onClick={() => setOffset(0)}>Today</button>
          <button type="button" className="wv-seg-btn" onClick={() => setOffset(offset + 4)}>Later</button>
        </div>
        <span className="wv-tl-range" role="status" aria-label="Timeline range" aria-live="polite" aria-atomic="true">{quarterLabel(scale.quarters[0]!.value)} – {quarterLabel(scale.quarters.at(-1)!.value)}</span>
      </div>
      <div className="wv-tl-scroll" role="region" aria-label="Horizon timeline" tabIndex={0}>
      <div ref={timeline} className={cx('wv-tl', todayVisible && 'has-today')}>
        <div className="wv-tl-row wv-tl-header">
          <div className="wv-tl-label wv-tl-corner"><span>Horizon</span><span className="wv-muted">open items</span></div>
          <div className="wv-tl-track wv-tl-scale">
            {scale.quarters.map((q, index) => (
              <Placed key={q.value} className={cx('wv-tl-tick', q.value.endsWith('Q1') && 'is-year')} left={q.left} width={q.width}>
                <span>{index === 0 || q.value.endsWith('Q1') ? q.value.replace('-', ' · ') : q.value.slice(5)}</span>
              </Placed>
            ))}
            {todayVisible && <Placed className="wv-tl-today" left={scale.today} title="Today"><span>Today</span></Placed>}
          </div>
          <div className="wv-tl-date-text">Dates</div>
        </div>
        {TIMELINE_LANES.map((lane) => {
          const laneItems = sortByPosition(items.filter((it) => (it.horizon ?? null) === lane.id));
          return (
            <section
              key={laneKey(lane.id)}
              className={cx('wv-tl-lane', `wv-hz--${laneKey(lane.id)}`)}
              data-lane={laneKey(lane.id)}
              aria-label={`${lane.label} lane, ${laneItems.length} items`}
              onDragOver={(event: DragEvent) => { if (dragging.current) event.preventDefault(); }}
              onDrop={(event: DragEvent) => {
                const id = dragging.current;
                dragging.current = null;
                if (!id) return;
                event.preventDefault();
                void setHorizon(id, lane.id);
              }}
            >
              <div className="wv-tl-lane-head">
                <strong>{lane.label}</strong>
                <span className="wv-muted">{lane.hint}</span>
                <span className="wv-count">{laneItems.length}</span>
              </div>
              {!laneItems.length && <div className="wv-tl-empty">Drop items here</div>}
              {laneItems.map((item) => (
                <TimelineRow
                  key={item.id}
                  item={item}
                  offset={offset}
                  onKey={onRowKey}
                  onPick={setHorizon}
                  onDragStart={(event) => { dragging.current = item.id; event.dataTransfer?.setData('text/plain', item.title); }}
                />
              ))}
            </section>
          );
        })}
      </div>
      </div>
    </div>
  );
}

function TimelineRow({ item, offset, onKey, onPick, onDragStart }: {
  item: Item;
  offset: number;
  onKey: (event: KeyboardEvent<HTMLDivElement>, item: Item) => void;
  onPick: (id: string, horizon: Horizon | null) => Promise<unknown>;
  onDragStart: (event: DragEvent) => void;
}) {
  const env = useEnv();
  const geo = timelineGeometry(item, env.today, offset);
  const dateText = geo.marks.length
    ? geo.marks.map(({ entry }) => `${DATE_KIND_LABEL[entry.kind]} ${formatShort(entry, env.today)}`).join(' · ')
    : 'Unscheduled';
  const fullDates = geo.marks.length ? geo.marks.map(({ entry }) => `${DATE_KIND_LABEL[entry.kind]} · ${formatValue(entry)}`).join(' · ') : 'Unscheduled';
  return (
    <div className={cx('wv-tl-row', isPending(env.state, item.id) && 'is-pending', item.is_example && 'is-example')}>
      <div
        className="wv-tl-label"
        tabIndex={0}
        data-row-id={item.id}
        draggable
        onDragStart={onDragStart}
        onKeyDown={(event) => onKey(event, item)}
        aria-label={`${item.title}, horizon ${item.horizon ? HORIZON_LABEL[item.horizon] : 'none'}. Alt+Up or Alt+Down changes horizon. M for the horizon menu.${env.openItem ? ' Enter opens.' : ''}`}
      >
        <KindMark kind={item.kind} />
        {env.openItem
          ? <button type="button" className="wv-link wv-tl-title" title={item.title} tabIndex={-1} onClick={() => env.openItem!(item.id)}>{item.title}</button>
          : <span className="wv-tl-title" title={item.title}>{item.title}</span>}
        <MotivationPill motivation={item.motivation} />
        <Menu
          className="wv-tl-menu"
          size="sm"
          variant="ghost"
          align="end"
          trigger={<MoreIcon />}
          triggerLabel={`Change horizon for ${item.title}`}
          items={TIMELINE_LANES.map((lane) => ({
            id: laneKey(lane.id),
            label: `${lane.label}${(item.horizon ?? null) === lane.id ? ' · current' : ''}`,
            onSelect: () => void onPick(item.id, lane.id),
          }))}
        />
      </div>
      <div className="wv-tl-track">
        {!geo.marks.length && <span className="wv-tl-unscheduled">Unscheduled</span>}
        {geo.spans.map((s) => (
          <Placed key={`${s.from.id}-${s.to.id}`} className="wv-tl-span" left={s.left} width={s.width} title={`${formatValue(s.from, env.today)} → ${formatValue(s.to, env.today)}`} />
        ))}
        {geo.marks.map(({ entry, shape, left, width }) => {
          const title = `${DATE_KIND_LABEL[entry.kind]} · ${formatValue(entry)}${entry.note ? ` — ${entry.note}` : ''}`;
          if (shape === 'edge-before' || shape === 'edge-after') {
            return (
              <span key={entry.id} className={cx('wv-tl-edge', shape === 'edge-before' ? 'is-before' : 'is-after', `wv-dk--${entry.kind}`)} role="img" aria-label={`${title}, ${shape === 'edge-before' ? 'before' : 'after'} visible range`} title={title}>
                <span aria-hidden="true">{shape === 'edge-before' ? '‹' : '›'}</span><span className="wv-dk-shape" aria-hidden="true" />
              </span>
            );
          }
          if (shape === 'marker') return <Placed key={entry.id} className={cx('wv-tl-marker', `wv-dk--${entry.kind}`)} left={left} title={title} />;
          return (
            <Placed key={entry.id} className={cx('wv-tl-band', `wv-dk--${entry.kind}`, `wv-pr--${entry.precision}`)} left={left} width={width} title={title} />
          );
        })}
      </div>
      <div className="wv-tl-date-text" title={fullDates} aria-label={fullDates}>{dateText}</div>
    </div>
  );
}
