import { addDays, DATE_KIND_LABEL, formatValue, isoWeekOf, valueContaining, type DateInput } from '../core';

// Quick capture never invents a date (RV-2). A date-like word in the title only
// produces this offer; nothing is added unless the user accepts it, and the
// title is always saved exactly as typed.

export interface DateSuggestion {
  /** The word or phrase as it appears in the title. */
  word: string;
  date: DateInput;
  /** For example "Target · Wed, Oct 21". */
  label: string;
}

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const PATTERN = new RegExp(`\\b(today|tonight|tomorrow|next week|next month|${WEEKDAYS.join('|')})\\b`, 'iu');

function weekdayOf(iso: string): number {
  return new Date(`${iso}T00:00:00Z`).getUTCDay();
}

/**
 * The first date-like word in `title`, resolved against `today` (the Planner display zone's ISO day). A weekday
 * means its next occurrence after today. The offered kind is always Target, the Planner's soft aim.
 */
export function suggestDate(title: string, today: string): DateSuggestion | null {
  const match = PATTERN.exec(title);
  if (!match) return null;
  const word = match[1]!;
  const key = word.toLowerCase();
  let date: DateInput;
  if (key === 'today' || key === 'tonight') date = { kind: 'target', precision: 'day', value: today };
  else if (key === 'tomorrow') date = { kind: 'target', precision: 'day', value: addDays(today, 1) };
  else if (key === 'next week') date = { kind: 'target', precision: 'week', value: isoWeekOf(addDays(today, 7)) };
  else if (key === 'next month') {
    const [year, month] = today.split('-').map(Number) as [number, number];
    date = { kind: 'target', precision: 'month', value: valueContaining('month', `${month === 12 ? year + 1 : year}-${String(month === 12 ? 1 : month + 1).padStart(2, '0')}-01`) };
  } else {
    const ahead = (WEEKDAYS.indexOf(key) - weekdayOf(today) + 7) % 7 || 7;
    date = { kind: 'target', precision: 'day', value: addDays(today, ahead) };
  }
  const entry = { kind: date.kind, precision: date.precision, value: date.value };
  return { word, date, label: `${DATE_KIND_LABEL[date.kind]} · ${formatValue(entry, today)}` };
}
