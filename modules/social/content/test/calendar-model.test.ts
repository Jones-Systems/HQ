import { describe, expect, it } from 'vitest';
import { clockLabel, durationLabel } from '../calendar-time';
import { nearestPlanned, shortDateLabel } from '../model';

describe('calendar "now" helpers', () => {
  it('labels a short date, with the year only when it differs from the visible range', () => {
    expect(shortDateLabel('2026-10-24', '2026-10-01')).toBe('Oct 24');
    expect(shortDateLabel('2026-11-02', '2026-09-01')).toBe('Nov 2');
    expect(shortDateLabel('2026-11-02', '2027-03-01')).toBe('Nov 2, 2026');
  });

  it('finds the next planned date after an empty range, otherwise the latest one before it', () => {
    const planned = ['2026-10-24', '2026-11-02', '2026-08-30'];
    expect(nearestPlanned(planned, '2026-09-01', '2026-09-31')).toEqual({ date: '2026-10-24', direction: 'after' });
    expect(nearestPlanned(planned, '2026-12-01', '2026-12-31')).toEqual({ date: '2026-11-02', direction: 'before' });
    expect(nearestPlanned(planned, '2026-10-01', '2026-10-31')).toBeNull();
    expect(nearestPlanned([], '2026-10-01', '2026-10-31')).toBeNull();
  });

  it('shows stored HH:mm times with 12-hour labels and a plain duration', () => {
    expect(clockLabel(0)).toBe('12:00 a.m.');
    expect(clockLabel(9 * 60)).toBe('9:00 a.m.');
    expect(clockLabel(12 * 60 + 15)).toBe('12:15 p.m.');
    expect(clockLabel(23 * 60 + 45)).toBe('11:45 p.m.');
    expect(durationLabel(15)).toBe('15 min');
    expect(durationLabel(60)).toBe('1 h');
    expect(durationLabel(90)).toBe('1 h 30 min');
  });
});
