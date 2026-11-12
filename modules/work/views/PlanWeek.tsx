import { useEffect, useState, type KeyboardEvent } from 'react';
import { Button, Menu, useListMotion } from '@hq/ui';
import { DATE_KIND_IDS, DATE_KIND_LABEL, dateState, formatDay, matchesFilters } from '../core';
import { DoneButton, PageHeader } from '../theme';
import { isPending, isTyping, pendingWord, useEnv, useRemembered } from './env';
import { DateChip, HorizonChip, ItemRow, MotivationPill, ViewHint } from './parts';
import { adjacentDay, kindChange, overdue, planBoard, planDrop, type PlanCard } from './plan-week-model';
import { usePlanDrag } from './plan-week-drag';
import { settleInto, shake } from './calendar-motion';
import './plan-week.css';

export const PLAN_WEEK_TITLE = 'Plan week';
const cardKey = (c: PlanCard) => `${c.item.id}:${c.entry?.id ?? 'backlog'}`;
export function PlanWeekView() {
  const env = useEnv();
  const [offset, setOffset] = useRemembered('week.offset', 0);
  const [focus, setFocus] = useState<string | null>(null);
  const board = planBoard(env.state.items.filter((it) => matchesFilters(it, env.filters)), env.settings, env.today, offset);
  const zones = ['backlog', ...board.days, 'week'];
  const root = useListMotion<HTMLDivElement>(zones.flatMap((z) => board.zones[z]!.map((c) => `${z}/${cardKey(c)}`)));
  const label = (z: string) => z === 'backlog' ? 'Backlog' : z === 'week' ? 'This week, no day' : formatDay(z, { weekday: true });
  const node = (id: string) => [...(root.current?.querySelectorAll<HTMLElement>('[data-plan-item]') ?? [])].find((el) => el.dataset.planItem === id);
  useEffect(() => { if (focus) node(focus)?.focus(); }, [focus, env.state.items]);
  const move = async (card: PlanCard, zone: string, point: { x: number; y: number } | null = null) => {
    const current = env.store.getState();
    const item = current.items.find((it) => it.id === card.item.id);
    const entry = card.entry && item?.dates.find((d) => d.id === card.entry!.id);
    if (!item || (card.entry && !entry) || isPending(current, card.item.id)) { env.announce('Planning paused · check the current item state'); return; }
    card = { item, entry };
    const result = planDrop(card, zone, board.weekValue);
    if (!result || isPending(env.state, card.item.id) || env.state.held) { env.announce('No planning change'); shake(node(card.item.id)); return; }
    setFocus(card.item.id);
    env.announce(result.badge);
    const ok = await env.run(env.store.patch(card.item.id, result.patch), `${result.badge} · “${card.item.title}”.`);
    requestAnimationFrame(() => { if (ok) settleInto(node(card.item.id), point); else if (!isPending(env.store.getState(), card.item.id)) shake(node(card.item.id)); });
  };
  const beginPointer = usePlanDrag((card, zone, point) => { void move(card, zone, point); }, (card, zone) => planDrop(card, zone, board.weekValue)?.badge ?? 'No planning change');
  const key = (event: KeyboardEvent<HTMLDivElement>, card: PlanCard) => {
    if (isTyping(event.target) || event.target !== event.currentTarget) return;
    if (event.key.toLowerCase() === 'p' && !event.metaKey && !event.ctrlKey && !event.altKey) {
      event.preventDefault(); event.stopPropagation(); event.currentTarget.querySelector<HTMLButtonElement>('.wv-plan-menu button')?.click();
    }
    if (!event.altKey || !['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
    event.preventDefault(); event.stopPropagation();
    const day = card.entry?.precision === 'day' ? adjacentDay(card.entry.value, event.key === 'ArrowRight' ? 1 : -1, board.days)
      : event.key === 'ArrowRight' ? board.days.includes(env.today) ? env.today : board.days[0] : undefined;
    if (day) void move(card, day); else env.announce('Edge of the shown week · use Plan for to choose another lane');
  };
  const renderCard = (card: PlanCard) => <div key={cardKey(card)} className="wv-plan-card" tabIndex={0} data-plan-item={card.item.id} data-plan-date={card.entry?.id}
    data-hq-motion-key={cardKey(card)} onPointerDown={(e) => { if (!isPending(env.state, card.item.id) && !env.state.held) beginPointer(e, card); }}
    onKeyDown={(e) => key(e, card)}>
    <ItemRow item={card.item} /><div className="wv-plan-chips"><MotivationPill motivation={card.item.motivation} /><HorizonChip horizon={card.item.horizon} />
      {card.entry && <DateChip entry={card.entry} state={dateState(card.entry, env.today, true)} />}
      {overdue(card.item, env.today) && <span>Overdue deadline</span>}</div>
    <div className="wv-plan-actions"><DoneButton label={`Mark “${card.item.title}” done`} disabled={isPending(env.state, card.item.id) || !!env.state.held}
      onDone={() => void env.run(env.store.move(card.item.id, 'done', { place: 'top' }), `Moved “${card.item.title}” to Done.`)} />
      <span className="wv-plan-menu"><Menu trigger="Plan for…" triggerLabel={`Plan “${card.item.title}” for…`}
        items={zones.map((z) => ({ id: z, label: pendingWord(env.state, card.item.id) ?? planDrop(card, z, board.weekValue)?.badge ?? label(z), disabled: isPending(env.state, card.item.id), onSelect: () => void move(card, z) }))} /></span>
      {card.entry && <Menu trigger="Date kind" triggerLabel={`Date kind for “${card.item.title}”`} items={DATE_KIND_IDS.map((kind) => ({ id: kind, label: DATE_KIND_LABEL[kind], checked: card.entry!.kind === kind, disabled: isPending(env.state, card.item.id),
        onSelect: () => { const patch = kindChange(card, kind); if (patch && !isPending(env.state, card.item.id) && !env.state.held) void env.run(env.store.patch(card.item.id, patch), `Changed date kind to ${DATE_KIND_LABEL[kind]}.`); } }))} />}</div>
  </div>;
  return <section className="wv-week" aria-labelledby="wv-week-title">
    <PageHeader title={PLAN_WEEK_TITLE} titleId="wv-week-title" meta={`Week of ${formatDay(board.start)} – ${formatDay(board.days[6]!)} · ${zones.slice(1).reduce((n, z) => n + board.zones[z]!.length, 0)} planned`}
      actions={<div className="wk-seg"><Button aria-label="Previous week" onClick={() => setOffset(offset - 1)}>‹</Button><Button onClick={() => setOffset(0)}>This week</Button><Button aria-label="Next week" onClick={() => setOffset(offset + 1)}>›</Button></div>} />
    <ViewHint>Drag or use Plan for… (P). Alt+←/→ moves a day. Planning change only · no run started.</ViewHint>
    <div ref={root} className="wv-week-board">
      {zones.map((z) => <section key={z} className={`wv-week-zone ${z === env.today ? 'is-today' : ''} ${board.days.includes(z) && z < env.today ? 'is-past' : ''}`} aria-label={label(z)} data-plan-zone={z}>
        <h3>{label(z)} {z === env.today && '· Today'} <span className="wv-count">{board.zones[z]!.length}</span></h3>
        {z === 'backlog' ? <>{['Overdue deadlines', 'Now', 'Next', 'Active', 'Considering'].map((group) => {
          const cards = board.zones.backlog!.filter(({ item }) => item.status !== 'inbox' && (overdue(item, env.today) ? 'Overdue deadlines' : item.horizon === 'now' ? 'Now' : item.status === 'next' ? 'Next' : item.status === 'active' ? 'Active' : 'Considering') === group);
          return cards.length > 0 && <div key={group}><h4>{group}</h4>{cards.map(renderCard)}</div>;
        })}<details><summary>Inbox captures · {board.zones.backlog!.filter((c) => c.item.status === 'inbox').length}</summary>
          {env.navigate && <Button onClick={() => env.navigate!({ view: 'review' })}>Sort in Review</Button>}{board.zones.backlog!.filter((c) => c.item.status === 'inbox').map(renderCard)}</details></> : board.zones[z]!.map(renderCard)}
      </section>)}
    </div>
  </section>;
}
