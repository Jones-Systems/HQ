import { describe, expect, it } from 'vitest';
import { suggestDate } from '../suggest';

// 2026-10-21 is a Wednesday in the fixture's display zone.
const TODAY = '2026-10-21';

describe('suggestDate: an offer only, never an invented date', () => {
  it('offers a day Target for today, tonight and tomorrow', () => {
    expect(suggestDate('Call the plumber tomorrow', TODAY)).toEqual({
      word: 'tomorrow', date: { kind: 'target', precision: 'day', value: '2026-10-22' }, label: 'Target · Thu, Oct 22',
    });
    expect(suggestDate('Water plants TODAY', TODAY)?.date.value).toBe('2026-10-21');
    expect(suggestDate('Stargaze tonight', TODAY)?.date.value).toBe('2026-10-21');
  });

  it('resolves a weekday to its next occurrence after today', () => {
    expect(suggestDate('Market run friday', TODAY)?.date.value).toBe('2026-10-23');
    expect(suggestDate('Choir on Wednesday', TODAY)?.date.value).toBe('2026-10-28');
    expect(suggestDate('sunday roast', TODAY)?.date.value).toBe('2026-10-25');
  });

  it('keeps coarse phrases coarse: next week is a week, next month a month', () => {
    expect(suggestDate('Sort photos next week', TODAY)?.date).toEqual({ kind: 'target', precision: 'week', value: '2026-W44' });
    expect(suggestDate('Plan trip next month', TODAY)?.date).toEqual({ kind: 'target', precision: 'month', value: '2026-11' });
    expect(suggestDate('Plan trip next month', '2026-12-05')?.date.value).toBe('2027-01');
  });

  it('offers nothing for a title without a date word, or a word that only contains one', () => {
    expect(suggestDate('Plan the garden beds', TODAY)).toBeNull();
    expect(suggestDate('Read the todayish zine', TODAY)).toBeNull();
    expect(suggestDate('', TODAY)).toBeNull();
  });
});
