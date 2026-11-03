import type { ReactNode } from 'react';
import {
  cardDate, DATE_KIND_LABEL, formatShort, HORIZON_LABEL, MOTIVATION_LABEL, PRIORITY_LABEL,
  type DateKind, type Item, type ItemKind, type PlanningDate,
} from '../core';

// Small presentational pieces shared by the board card and the detail panel.
// Every chip carries a visible word, so no meaning depends on colour (T4 check 7).

const KIND_PATHS: Record<ItemKind, ReactNode> = {
  project: <path d="M3.5 7.5v10h17v-8h-8l-2-2z" />,
  idea: <><path d="M9 17h6M10 20h4" /><path d="M12 4a5 5 0 0 0-3 9c.6.5 1 1.2 1 2h4c0-.8.4-1.5 1-2a5 5 0 0 0-3-9z" /></>,
  goal: <path d="M6 20V4m0 1h11l-2 4 2 4H6" />,
  chore: <path d="m14 4 6 6-9 9H5v-6zM12 6l6 6" />,
};

export function KindIcon({ kind }: { kind: ItemKind }) {
  return <svg className="work-icon" viewBox="0 0 24 24" aria-hidden="true">{KIND_PATHS[kind]}</svg>;
}

const DATE_KIND_PATHS: Record<DateKind, ReactNode> = {
  target: <><circle cx="12" cy="12" r="7" /><circle cx="12" cy="12" r="2.5" /></>,
  deadline: <path d="M6 20V4m0 1h11l-2 4 2 4H6" />,
  start: <path d="M5 12h12m-4-5 5 5-5 5" />,
  event: <><rect x="4" y="5.5" width="16" height="14" rx="2" /><path d="M4 10h16M8 3.5v4M16 3.5v4" /></>,
};

export function DateKindIcon({ kind }: { kind: DateKind }) {
  return <svg className="work-icon work-icon--sm" viewBox="0 0 24 24" aria-hidden="true">{DATE_KIND_PATHS[kind]}</svg>;
}

export const COARSE_PRECISIONS: ReadonlySet<PlanningDate['precision']> = new Set(['week', 'month', 'quarter', 'year']);

export interface DateChipModel {
  entry: PlanningDate;
  /** Visible words. */
  text: string;
  /** Full accessible description, naming the date kind. */
  label: string;
  state: 'overdue' | 'passed' | 'current' | 'today' | 'upcoming';
  /** A week, month, quarter or year date: drawn dashed so it never reads as one day. */
  coarse: boolean;
}

/** The card's primary date chip, in the Planner's display zone `today`. Undated items have none. */
export function dateChip(item: Item, today: string): DateChipModel | null {
  const found = cardDate(item, today);
  if (!found) return null;
  const { entry, state } = found;
  const kind = DATE_KIND_LABEL[entry.kind];
  const value = formatShort(entry, today);
  const time = value.slice(formatShort({ ...entry, time: null }, today).length).trim();
  const text = state === 'overdue' ? `Overdue · ${value}`
    : state === 'passed' ? `${kind} passed · ${value}`
      : state === 'today' ? `Today${time ? ` · ${time}` : ''}`
        : value;
  return { entry, text, label: `${kind}: ${text}`, state, coarse: COARSE_PRECISIONS.has(entry.precision) };
}

export function DateChip({ chip }: { chip: DateChipModel }) {
  return (
    <span
      className={`work-chip work-chip--date work-chip--dk-${chip.entry.kind} work-chip--${chip.state}${chip.coarse ? ' work-chip--coarse' : ''}`}
      title={chip.label}
    >
      <DateKindIcon kind={chip.entry.kind} />
      <span className="hq-sr-only">{DATE_KIND_LABEL[chip.entry.kind]}: </span>
      {chip.text}
    </span>
  );
}

/** Why, Horizon, the primary date and High priority, in the Planner's order. */
export function ItemChips({ item, today }: { item: Item; today: string }) {
  const chip = dateChip(item, today);
  return (
    <span className="work-chips">
      {item.motivation && <span className={`work-chip work-chip--why-${item.motivation}`}><span className="hq-sr-only">Why: </span>{MOTIVATION_LABEL[item.motivation]}</span>}
      {item.horizon && <span className="work-chip work-chip--horizon"><span className="hq-sr-only">Horizon: </span>{HORIZON_LABEL[item.horizon]}</span>}
      {chip && <DateChip chip={chip} />}
      {item.priority === 'high' && <span className="work-chip work-chip--priority-high"><span aria-hidden="true">↑ </span>{PRIORITY_LABEL.high}<span className="hq-sr-only"> priority</span></span>}
    </span>
  );
}

export function stepProgress(item: Pick<Item, 'next_steps'>): { done: number; total: number } {
  return { done: item.next_steps.filter((step) => step.done).length, total: item.next_steps.length };
}
