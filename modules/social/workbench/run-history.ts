import type { RunRecord } from '../core';

/** The local calendar day of an instant, as `YYYY-MM-DD`. Run history groups by the day the reader lives in. */
export function localDay(value: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
}

export interface RunDay {
  /** `YYYY-MM-DD` in local time, or `unknown` for a run whose time could not be read. */
  readonly key: string;
  /** "Today", "Yesterday" or "Mon, Oct 19" (with the year when it is not this year). */
  readonly label: string;
  readonly runs: readonly RunRecord[];
}

/** "Today", "Yesterday", "Mon, Oct 19" and, for another year, "Mon, Oct 19, 2025". */
export function dayLabel(day: string, now: Date): string {
  const today = localDay(now);
  if (day === today) return 'Today';
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (day === localDay(yesterday)) return 'Yesterday';
  const [year, month, date] = day.split('-').map(Number) as [number, number, number];
  const shown = new Date(year, month - 1, date);
  return shown.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', ...(year === now.getFullYear() ? {} : { year: 'numeric' }) });
}

/** Runs grouped by the local day they were created, in the order given (newest first stays newest first). */
export function groupRunsByDay(runs: readonly RunRecord[], now: Date): RunDay[] {
  const days: { key: string; runs: RunRecord[] }[] = [];
  for (const run of runs) {
    const time = Date.parse(run.created_at);
    const key = Number.isFinite(time) ? localDay(new Date(time)) : 'unknown';
    const last = days[days.length - 1];
    if (last?.key === key) last.runs.push(run);
    else days.push({ key, runs: [run] });
  }
  return days.map((day) => ({ key: day.key, label: day.key === 'unknown' ? 'Time not recorded' : dayLabel(day.key, now), runs: day.runs }));
}

/** "10:42 AM" in the reader's zone: one short line. An unreadable value is shown as recorded. */
export function timeOfDay(value: string | null | undefined): string {
  if (!value) return '—';
  const time = Date.parse(value);
  return Number.isFinite(time) ? new Date(time).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : value;
}

/** "4 s", "2 min 5 s", "1 h 3 min"; null while the run has not finished or its times cannot be read. */
export function runDuration(run: Pick<RunRecord, 'created_at' | 'finished_at'>): string | null {
  if (!run.finished_at) return null;
  const ms = Date.parse(run.finished_at) - Date.parse(run.created_at);
  if (!Number.isFinite(ms) || ms < 0) return null;
  const seconds = Math.round(ms / 1000);
  if (seconds < 1) return 'under 1 s';
  if (seconds < 60) return `${seconds} s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return seconds % 60 === 0 ? `${minutes} min` : `${minutes} min ${seconds % 60} s`;
  return minutes % 60 === 0 ? `${Math.floor(minutes / 60)} h` : `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}
