import { useEffect, useLayoutEffect, useRef, useState, type DragEvent, type KeyboardEvent, type ReactNode } from 'react';
import { Menu, useListMotion } from '@hq/ui';
import {
  DATE_KIND_IDS, DATE_KIND_LABEL, formatShort, formatValue, HORIZON_LABEL, isLive, isOpen, matchesFilters, sortByPosition,
  type Horizon, type Item,
} from '../core';
import { flash } from '../motion';
import { PageHeader } from '../theme';
import { shake, slideIn } from './calendar-motion';
import { isPending, useCssVars, useEnv, useRemembered } from './env';
import { stepHorizon, timelineGeometry, timelineScale, TIMELINE_LANES } from './moves';
import { cx, KindMark, MoreIcon, MotivationPill } from './parts';
import './timeline.css';

// Timeline (RV-4): horizon lanes across eight quarters. A row changes horizon
// by drag to another lane, Alt+↑/↓ to the adjacent lane, or its menu (M). Each
// is one `{ horizon }` patch with Undo. Coarse dates draw as the period they
// name, and a bar joins a start date to a later target or deadline only when
// the owner set both ends.
//
// Presentation (flow assessment X-4, X-8): the page header names the view and the range; moving the range slides the
// quarters in the direction of travel; a row that changes lane glides there (shared list motion) and flashes; the lane
// under a dragged row lights up; a refused move shakes the row once. Under reduced motion none of this moves.

const laneKey = (horizon: Horizon | null) => horizon ?? 'none';
const KEY_BY_KIND: Record<(typeof DATE_KIND_IDS)[number], string> = { target: 'Target', deadline: 'Deadline', start: 'Start', event: 'Event' };

/** One background layer per quarter boundary, in percent of the eight quarters, so the lines match the ticks exactly. */
const gridLayers = (lefts: readonly number[]) => lefts.slice(1)
  .map((left) => `linear-gradient(var(--hq-border), var(--hq-border)) ${left.toFixed(3)}% 0 / 1px 100% no-repeat`).join(', ');

function Placed({ className, left, width, title, children }: { className: string; left: number; width?: number; title?: string; children?: ReactNode }) {
  const ref = useRef<HTMLSpanElement>(null);
  useCssVars(ref, width === undefined ? { '--wv-left': `${left}%` } : { '--wv-left': `${left}%`, '--wv-width': `${width}%` });
  return <span ref={ref} className={className} title={title} role={title ? 'img' : undefined} aria-label={title}>{children}</span>;
}

export function TimelineView() {
  const env = useEnv();
  const { today, state } = env;
  const [focusId, setFocusId] = useState<string | null>(null);
  const [landed, setLanded] = useState<{ id: string } | null>(null);
  const [offset, setOffset] = useRemembered('timeline.offset', 0);
  const dragging = useRef<string | null>(null);
  const over = useRef<Element | null>(null);
  const slid = useRef(offset);
  const root = useRef<HTMLDivElement>(null);
  const items = state.items.filter((it) => isLive(it) && isOpen(it) && matchesFilters(it, env.filters));
  const lanes = TIMELINE_LANES.map((lane) => ({ lane, items: sortByPosition(items.filter((it) => (it.horizon ?? null) === lane.id)) }));
  // Rows glide between lanes when a horizon changes: one ref on the grid measures every row.
  const timeline = useListMotion<HTMLDivElement>(lanes.flatMap((l) => l.items.map((it) => it.id)));
  const scale = timelineScale(today, offset);
  const todayVisible = scale.today >= 0 && scale.today <= 100;
  useCssVars(timeline, { '--wv-today': `${scale.today}%`, '--wv-grid': gridLayers(scale.quarters.map((q) => q.left)) });
  const quarterLabel = (value: string) => `${value.slice(5)} ${value.slice(0, 4)}`;

  useEffect(() => {
    if (!focusId || !root.current) return;
    const row = [...root.current.querySelectorAll<HTMLElement>('[data-row-id]')].find((el) => el.dataset.rowId === focusId);
    if (row && document.activeElement !== row) row.focus();
  }, [focusId, state.items]);

  // Moving the range slides every plane (ticks, today line, marks) from the side the new quarters come from.
  useLayoutEffect(() => {
    const before = slid.current;
    slid.current = offset;
    if (before === offset) return;
    timeline.current?.querySelectorAll('.wv-tl-plane').forEach((plane) => slideIn(plane, offset - before));
  }, [offset, timeline]);

  const rowOf = (id: string) => [...(root.current?.querySelectorAll<HTMLElement>('[data-row-id]') ?? [])].find((el) => el.dataset.rowId === id)?.closest('.wv-tl-row') ?? null;
  // The moved row flashes where it landed. The write is projected at once, so the row is in its new lane within a frame.
  useEffect(() => {
    if (!landed) return undefined;
    const handle = requestAnimationFrame(() => flash(rowOf(landed.id)));
    return () => cancelAnimationFrame(handle);
  }, [landed]);

  const setHorizon = async (id: string, horizon: Horizon | null): Promise<boolean> => {
    const item = state.items.find((it) => it.id === id);
    if (!item) return false;
    if (item.horizon === horizon) {
      env.announce('Same horizon');
      shake(rowOf(id));
      return false;
    }
    const saved = env.run(env.store.patch(id, { horizon }), `“${item.title}” is now ${horizon ? HORIZON_LABEL[horizon] : 'without a horizon'}.`);
    setLanded({ id });
    const ok = await saved;
    if (!ok) shake(rowOf(id));
    return ok;
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

  // ---- drag: arm on dragstart, light up the lane under the pointer, disarm on drop or dragend
  const setOver = (next: Element | null) => {
    if (over.current === next) return;
    over.current?.removeAttribute('data-over');
    next?.setAttribute('data-over', 'true');
    over.current = next;
  };
  const beginDrag = (item: Item, event: DragEvent) => {
    dragging.current = item.id;
    event.dataTransfer?.setData('text/plain', item.title);
    // Marked after the browser has taken its drag image, so the image shows the row as it was.
    window.setTimeout(() => { if (dragging.current === item.id) root.current?.setAttribute('data-wk-dragging', 'row'); }, 0);
  };
  const endDrag = (): string | null => {
    const id = dragging.current;
    dragging.current = null;
    setOver(null);
    root.current?.removeAttribute('data-wk-dragging');
    return id;
  };

  return (
    // A drag that ends anywhere, dropped or cancelled, disarms; a later unrelated drop must not move the item.
    <div
      ref={root}
      className="wv-tl-wrap"
      onDragEnd={() => { endDrag(); }}
      onDragOver={(event: DragEvent) => {
        if (dragging.current) setOver(event.target instanceof Element ? event.target.closest('.wv-tl-lane') : null);
      }}
    >
      <PageHeader
        title="Timeline"
        meta={(
          <>
            <span className="wv-tl-range" role="status" aria-label="Timeline range" aria-live="polite" aria-atomic="true">
              {quarterLabel(scale.quarters[0]!.value)} – {quarterLabel(scale.quarters.at(-1)!.value)}
            </span>
            {' · '}Horizon lanes across eight quarters.
          </>
        )}
        actions={(
          <div className="wk-seg" role="group" aria-label="Timeline navigation">
            <button type="button" className="wk-seg-item" onClick={() => setOffset(offset - 4)}>Earlier</button>
            <button type="button" className="wk-seg-item" onClick={() => setOffset(0)}>Today</button>
            <button type="button" className="wk-seg-item" onClick={() => setOffset(offset + 4)}>Later</button>
          </div>
        )}
      />
      <div className="wv-tl-scroll" role="region" aria-label="Horizon timeline" tabIndex={0}>
        <div ref={timeline} className={cx('wv-tl', todayVisible && 'has-today')}>
          <div className="wv-tl-row wv-tl-header">
            <div className="wv-tl-label wv-tl-corner"><span>Horizon</span><span className="wv-muted">open items</span></div>
            <div className="wv-tl-track wv-tl-scale">
              <div className="wv-tl-plane">
                {scale.quarters.map((q, index) => (
                  <Placed key={q.value} className={cx('wv-tl-tick', q.value.endsWith('Q1') && 'is-year')} left={q.left} width={q.width}>
                    <span>{index === 0 || q.value.endsWith('Q1') ? q.value.replace('-', ' · ') : q.value.slice(5)}</span>
                  </Placed>
                ))}
                {todayVisible && <Placed className="wv-tl-today" left={scale.today} title="Today"><span>Today</span></Placed>}
              </div>
            </div>
            <div className="wv-tl-date-text">Dates</div>
          </div>
          {lanes.map(({ lane, items: laneItems }) => (
            <section
              key={laneKey(lane.id)}
              className={cx('wv-tl-lane', `wv-hz--${laneKey(lane.id)}`)}
              data-lane={laneKey(lane.id)}
              aria-label={`${lane.label} lane, ${laneItems.length} items`}
              onDragOver={(event: DragEvent) => { if (dragging.current) event.preventDefault(); }}
              onDrop={(event: DragEvent) => {
                const id = endDrag();
                if (!id) return;
                event.preventDefault();
                void setHorizon(id, lane.id);
              }}
            >
              <div className="wv-tl-lane-head">
                <div className="wv-tl-lane-title">
                  <strong>{lane.label}</strong>
                  <span className="wv-muted">{lane.hint}</span>
                  <span className="wk-count">{laneItems.length}</span>
                </div>
              </div>
              {!laneItems.length && <div className="wv-tl-empty">Drop items here</div>}
              {laneItems.map((item) => (
                <TimelineRow
                  key={item.id}
                  item={item}
                  offset={offset}
                  onKey={onRowKey}
                  onPick={setHorizon}
                  onDragStart={(event) => beginDrag(item, event)}
                />
              ))}
            </section>
          ))}
        </div>
      </div>
      <div className="wv-tl-foot">
        <ul className="wv-tl-key" aria-label="Key">
          {DATE_KIND_IDS.map((kind) => <li key={kind}><span className={cx('wv-tl-key-mark', `wv-dk--${kind}`)} aria-hidden="true" />{KEY_BY_KIND[kind]}</li>)}
          <li><span className="wv-tl-key-band" aria-hidden="true" />Period (week, month, quarter)</li>
          <li><span className="wv-tl-key-span" aria-hidden="true" />Start to a later target or deadline</li>
        </ul>
        <p className="wv-hint">Drag a row to another lane to change its horizon, or press Alt+↑ or Alt+↓, or M for its menu. A bar appears only between a start date and a later target or deadline you set.</p>
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
    <div className={cx('wv-tl-row', isPending(env.state, item.id) && 'is-pending', item.is_example && 'is-example')} data-hq-motion-key={item.id}>
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
        <div className="wv-tl-plane">
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
      </div>
      <div className="wv-tl-date-text" title={fullDates} aria-label={fullDates}>{dateText}</div>
    </div>
  );
}
