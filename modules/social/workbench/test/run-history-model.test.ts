import { describe, expect, it } from 'vitest';
import type { RunRecord } from '../../core';
import { dayLabel, groupRunsByDay, localDay, runDuration, timeOfDay } from '../run-history';

/** Local-time instants, so the expectations hold in any time zone the tests run in. */
const at = (month: number, day: number, hour: number, minute = 0) => new Date(2026, month - 1, day, hour, minute);
const run = (id: string, created: Date, finished: Date | null = null): RunRecord => ({
  id, tool: 'x-studio', status: finished ? 'succeeded' : 'queued', is_example: 0, created_at: created.toISOString(), finished_at: finished?.toISOString() ?? null, error: null,
});

describe('run history days', () => {
  const now = at(10, 20, 12);

  it('names today and yesterday, and gives older days a short date', () => {
    expect(dayLabel(localDay(at(10, 20, 8)), now)).toBe('Today');
    expect(dayLabel(localDay(at(10, 19, 23, 59)), now)).toBe('Yesterday');
    expect(dayLabel(localDay(at(10, 18, 9)), now)).toBe('Sun, Oct 18');
    expect(dayLabel(localDay(new Date(2025, 11, 30, 9)), now)).toBe('Tue, Dec 30, 2025');
  });

  it('groups consecutive runs by local day and keeps newest first', () => {
    const groups = groupRunsByDay([
      run('r1', at(10, 20, 11)), run('r2', at(10, 20, 9)), run('r3', at(10, 19, 17)), run('r4', at(10, 18, 10)), run('r5', at(10, 18, 8)),
    ], now);
    expect(groups.map((group) => [group.label, group.runs.map((item) => item.id)])).toEqual([
      ['Today', ['r1', 'r2']], ['Yesterday', ['r3']], ['Sun, Oct 18', ['r4', 'r5']],
    ]);
  });

  it('keeps a run with an unreadable time instead of dropping it', () => {
    const groups = groupRunsByDay([{ ...run('r1', at(10, 20, 11)), created_at: 'not a time' }], now);
    expect(groups).toMatchObject([{ key: 'unknown', label: 'Time not recorded' }]);
    expect(timeOfDay('not a time')).toBe('not a time');
    expect(timeOfDay(null)).toBe('—');
  });

  it('shows a time of day on one short line', () => {
    expect(timeOfDay(at(10, 20, 9, 5).toISOString())).toMatch(/^9:05\s[AP]M$/u);
    expect(timeOfDay(at(10, 20, 17, 42).toISOString())).toMatch(/^5:42\sPM$/u);
  });

  it('says how long a finished run took, and nothing for one that has not finished', () => {
    expect(runDuration(run('r', at(10, 20, 9), new Date(at(10, 20, 9).getTime() + 4000)))).toBe('4 s');
    expect(runDuration(run('r', at(10, 20, 9), new Date(at(10, 20, 9).getTime() + 125_000)))).toBe('2 min 5 s');
    expect(runDuration(run('r', at(10, 20, 9), new Date(at(10, 20, 9).getTime() + 3_780_000)))).toBe('1 h 3 min');
    expect(runDuration(run('r', at(10, 20, 9), new Date(at(10, 20, 9).getTime() + 200)))).toBe('under 1 s');
    expect(runDuration(run('r', at(10, 20, 9)))).toBeNull();
  });
});
