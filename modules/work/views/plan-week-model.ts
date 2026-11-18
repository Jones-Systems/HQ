import { addDays, dateState, dayNum, isoWeekOf, isLive, isOpen, stripDerived, weekBounds,
  DATE_KIND_LABEL, type DateInput, type DateKind, type Item, type ItemPatch, type PlanningDate, type Settings } from '../core';

export interface PlanCard { item: Item; entry?: PlanningDate }
export function planBoard(items: readonly Item[], settings: Settings, today: string, offset: number) {
  const start = addDays(weekBounds(today, settings.week_start)[0], offset * 7);
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
  const weekValue = isoWeekOf(addDays(start, settings.week_start === 'sun' ? 1 : 0));
  const zones: Record<string, PlanCard[]> = Object.fromEntries([...days, 'week', 'backlog'].map((d) => [d, []]));
  for (const item of items.filter((it) => isLive(it) && isOpen(it) && it.status !== 'on_hold')) {
    const entries = item.dates.filter((d) => (d.precision === 'week' && d.value === weekValue)
      || (d.precision === 'day' && days.includes(d.value) && dateState(d, today, true) !== 'overdue'));
    if (entries.length) for (const entry of entries) zones[entry.precision === 'week' ? 'week' : entry.value]!.push({ item, entry });
    else zones.backlog!.push({ item });
  }
  return { start, days, weekValue, zones };
}
export function planDrop(card: PlanCard, zone: string, weekValue: string): { patch: ItemPatch; badge: string } | null {
  const { item, entry } = card;
  if (zone === 'backlog') return entry ? { patch: { dates: item.dates.filter((d) => d.id !== entry.id).map(stripDerived) }, badge: `Remove ${DATE_KIND_LABEL[entry.kind]} · back to backlog` } : null;
  const precision = zone === 'week' ? 'week' : 'day';
  const value = zone === 'week' ? weekValue : zone;
  if (entry?.precision === precision && entry.value === value) return null;
  const next: DateInput = entry ? { ...stripDerived(entry), precision, value } : { kind: 'target', precision, value, note: '' };
  if (precision === 'week') { next.time = null; next.end_time = null; next.tz = null; }
  return { patch: { dates: entry ? item.dates.map((d) => d.id === entry.id ? next : stripDerived(d)) : [...item.dates.map(stripDerived), next] },
    badge: `${entry ? entry.precision === 'week' && precision === 'day' ? 'Pin' : 'Move' : 'Set'} ${DATE_KIND_LABEL[next.kind]} · ${zone === 'week' ? 'this week, no day' : value}` };
}
export function kindChange(card: PlanCard, kind: DateKind): ItemPatch | null {
  return !card.entry || card.entry.kind === kind ? null : { dates: card.item.dates.map((d) => ({ ...stripDerived(d), kind: d.id === card.entry!.id ? kind : d.kind })) };
}
export const overdue = (item: Item, today: string) => item.dates.some((d) => d.kind === 'deadline' && dateState(d, today, true) === 'overdue');
export const adjacentDay = (day: string, delta: number, days: readonly string[]) => days.find((d) => dayNum(d) === dayNum(day) + delta);
