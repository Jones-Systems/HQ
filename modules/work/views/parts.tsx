import type { ReactNode } from 'react';
import {
  DATE_KIND_LABEL, formatShort, formatValue, HORIZON_LABEL, KIND_META, MOTIVATION_LABEL, plannerToday, PRIORITY_LABEL,
  STATUS_LABEL, dateState, formatDay, type Item, type PlanningDate, type Settings,
} from '../core';
import { isPending, pendingWord, useEnv } from './env';

export type DateState = ReturnType<typeof dateState>;

// Building blocks shared by the views. Every chip carries a word, and colour
// only reinforces it: status, date kind and date state never rely on colour.

export function cx(...names: readonly (string | false | null | undefined)[]): string {
  return names.filter(Boolean).join(' ');
}

const STATE_WORD: Partial<Record<DateState, string>> = { overdue: 'Overdue · ', passed: 'Target passed · ' };

/** Day groups supply the date heading; coarse periods and overdue dates retain their full date context. */
export function DateChip({ entry, state, long = false, inDayGroup = false }: { entry: PlanningDate; state: DateState; long?: boolean; inDayGroup?: boolean }) {
  const { today } = useEnv();
  const compact = inDayGroup && entry.precision === 'day' && state !== 'overdue';
  const clock = entry.time ? `${Number(entry.time.slice(0, 2)) % 12 || 12}:${entry.time.slice(3)} ${Number(entry.time.slice(0, 2)) < 12 ? 'AM' : 'PM'}` : '';
  const label = compact ? `${DATE_KIND_LABEL[entry.kind]}${clock ? ` · ${clock}` : ''}` : long ? formatValue(entry, today) : formatShort(entry, today);
  const prefix = state === 'overdue' ? STATE_WORD.overdue : state === 'passed' && entry.kind === 'target' ? STATE_WORD.passed : '';
  return (
    <span
      className={cx('wv-date', `wv-dk--${entry.kind}`, `wv-ds--${state}`, entry.precision !== 'day' && 'is-coarse')}
      title={`${DATE_KIND_LABEL[entry.kind]} · ${formatValue(entry, today)}${entry.note ? ` — ${entry.note}` : ''}`}
    >
      <span className="wv-dk-shape" aria-hidden="true" />
      {!compact && <span className="wv-sr">{DATE_KIND_LABEL[entry.kind]} </span>}
      {prefix && (state === 'overdue' ? <strong>{prefix}</strong> : <span>{prefix}</span>)}
      {label}
    </span>
  );
}

/** Status word with its module-local role shape. */
export function StatusMark({ status }: { status: Item['status'] }) {
  return (
    <span className={cx('wv-status', `wv-st--${status}`)}>
      <span className="wv-st-shape" aria-hidden="true" />
      {STATUS_LABEL[status]}
    </span>
  );
}

export function KindMark({ kind }: { kind: Item['kind'] }) {
  const label = KIND_META[kind]?.label ?? kind;
  return <span className={cx('wv-kind', `wv-kind--${kind}`)} role="img" aria-label={label} title={label} />;
}

export function MotivationPill({ motivation }: { motivation: Item['motivation'] }) {
  return motivation ? <span className={cx('wv-pill', `wv-pill--${motivation}`)}>{MOTIVATION_LABEL[motivation]}</span> : null;
}

/** The Planner horizon, labelled as the Planner labels it. Work never relabels a horizon. */
export function HorizonChip({ horizon }: { horizon: Item['horizon'] }) {
  return horizon ? <span className={cx('wv-chip', 'wv-horizon', `wv-hz--${horizon}`)} title="Horizon">{HORIZON_LABEL[horizon]}</span> : null;
}

export function PriorityMark({ priority }: { priority: Item['priority'] }) {
  if (!priority || priority === 'normal') return null;
  return <span className={cx('wv-chip', `wv-prio--${priority}`)} title={`${PRIORITY_LABEL[priority]} priority`}>{PRIORITY_LABEL[priority]}</span>;
}

/** `area` is the Planner's free-text label. It is shown as a label, never as a project. */
export function AreaTag({ area }: { area: Item['area'] }) {
  return area ? <span className="wv-chip wv-area" title="Area">{area}</span> : null;
}

export function Dash() {
  return <span className="wv-muted" aria-label="none">—</span>;
}

export function ExampleBadge({ item }: { item: Item }) {
  return item.is_example ? <span className="wv-example">Example</span> : null;
}

/** The title opens the item; an optional next step stays separate from trailing metadata. */
export function ItemRow({ item, sub, trailing }: { item: Item; sub?: ReactNode; trailing?: ReactNode }) {
  const { openItem, state } = useEnv();
  const title = <span className="wv-row-title" title={item.title}>{item.title}</span>;
  const pending = pendingWord(state, item.id);
  return (
    <div className={cx('wv-row', isPending(state, item.id) && 'is-pending', item.is_example && 'is-example')}>
      <KindMark kind={item.kind} />
      {openItem
        ? <button type="button" className="wv-link" title={item.title} onClick={() => openItem(item.id)}>{title}</button>
        : title}
      {sub && <span className="wv-row-sub">{sub}</span>}
      {(trailing || pending) && <span className="wv-row-trailing">{trailing}{pending && <span className="wv-pending">{pending}</span>}</span>}
    </div>
  );
}

export function SectionHead({ title, count, action, level = 3 }: { title: string; count?: number; action?: ReactNode; level?: 2 | 3 }) {
  const Heading = level === 2 ? 'h2' : 'h3';
  return (
    <div className="wv-section-head">
      <Heading className="wv-section-title">
        <span>{title}</span>
        {count !== undefined && <span className="wv-count">{count}</span>}
      </Heading>
      {action}
    </div>
  );
}

export function Quiet({ title, hint }: { title: string; hint: string }) {
  return (
    <div className="wv-quiet">
      <p className="wv-quiet-title">{title}</p>
      <p className="wv-quiet-hint">{hint}</p>
    </div>
  );
}

export function ViewHint({ children }: { children: ReactNode }) {
  return <p className="wv-hint">{children}</p>;
}

/** Planner `ago`: relative time for a stamp, then a date in the display zone. */
export function ago(stamp: string, now: Date, settings: Settings): string {
  const diff = (now.getTime() - new Date(stamp).getTime()) / 1000;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 86400 * 30) return `${Math.floor(diff / 86400)}d ago`;
  return formatDay(plannerToday(settings, new Date(stamp)), { weekday: false, year: true });
}

/** Three dots for a menu trigger. An SVG, because the fallback font may lack the ellipsis glyph. */
export function MoreIcon() {
  return <svg className="wv-more-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 12h.01M12 12h.01M18 12h.01" /></svg>;
}
