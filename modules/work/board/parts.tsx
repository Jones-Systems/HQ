import {
  cardDate, DATE_KIND_LABEL, formatShort, HORIZON_LABEL, MOTIVATION_LABEL, PRIORITY_LABEL,
  type Item, type PlanningDate,
} from '../core';
import { ArrowUpIcon, DateKindIcon } from '../theme/icons';

export { DateKindIcon, KindIcon } from '../theme/icons';

// Small presentational pieces shared by the board card and the detail panel. Marks and chip styles come from the
// Work theme (one chip family for every surface). Every chip carries a visible word, so no meaning depends on colour.

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
  const state = chip.state === 'overdue' || chip.state === 'passed' ? ` wk-chip--${chip.state}` : '';
  return (
    <span className={`wk-chip wk-chip--${chip.entry.kind}${state}${chip.coarse ? ' wk-chip--coarse' : ''}`} title={chip.label}>
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
      {item.motivation && <span className={`wk-chip wk-chip--${item.motivation}`}><span className="hq-sr-only">Why: </span>{MOTIVATION_LABEL[item.motivation]}</span>}
      {item.horizon && <span className="wk-chip"><span className="hq-sr-only">Horizon: </span>{HORIZON_LABEL[item.horizon]}</span>}
      {chip && <DateChip chip={chip} />}
      {item.priority === 'high' && <span className="wk-chip wk-chip--high"><ArrowUpIcon />{PRIORITY_LABEL.high}<span className="hq-sr-only"> priority</span></span>}
    </span>
  );
}

export function stepProgress(item: Pick<Item, 'next_steps'>): { done: number; total: number } {
  return { done: item.next_steps.filter((step) => step.done).length, total: item.next_steps.length };
}
