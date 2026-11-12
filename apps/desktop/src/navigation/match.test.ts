import { describe, expect, it } from 'vitest';
import { matchScore, rank } from './match';

describe('matchScore', () => {
  it('matches everything for an empty query', () => {
    expect(matchScore('', 'Status board')).toBe(0);
    expect(matchScore('   ', 'Status board')).toBe(0);
  });
  it('is case-insensitive and ignores accents', () => {
    expect(matchScore('STATUS', 'status board')).not.toBeNull();
    expect(matchScore('cafe', 'Café notes')).not.toBeNull();
  });
  it('prefers a word prefix over a substring over scattered letters', () => {
    const prefix = matchScore('board', 'Status board')!;
    const substring = matchScore('oard', 'Status board')!;
    const subsequence = matchScore('sbd', 'Status board')!;
    expect(prefix).toBeGreaterThan(substring);
    expect(substring).toBeGreaterThan(subsequence);
    expect(subsequence).toBeGreaterThan(0);
  });
  it('needs every word to match somewhere in the title or keywords', () => {
    expect(matchScore('work settings', 'Planner settings', ['Work', 'go to'])).not.toBeNull();
    expect(matchScore('work banana', 'Planner settings', ['Work'])).toBeNull();
    expect(matchScore('zzz', 'Status board')).toBeNull();
  });
  it('ranks a title that starts with the query above one that merely contains it', () => {
    expect(matchScore('wiki', 'Wiki')!).toBeGreaterThan(matchScore('wiki', 'Local Wiki source')!);
  });
  it('ranks a title match above a keyword-only match', () => {
    expect(matchScore('theme', 'Theme')!).toBeGreaterThan(matchScore('theme', 'Dark', ['theme'])!);
  });
});

describe('rank', () => {
  const items = [{ title: 'Calendar' }, { title: 'Settings', keywords: ['preferences'] }, { title: 'Status board' }, { title: 'Open Settings' }];
  it('keeps the original order for an empty query', () => {
    expect(rank(items, '').map(item => item.title)).toEqual(['Calendar', 'Settings', 'Status board', 'Open Settings']);
  });
  it('drops non-matches and puts the best first, keeping ties in order', () => {
    expect(rank(items, 'sett').map(item => item.title)).toEqual(['Settings', 'Open Settings']);
    expect(rank(items, 'pref').map(item => item.title)).toEqual(['Settings']);
    expect(rank(items, 'st').map(item => item.title)).toEqual(['Status board', 'Settings', 'Open Settings']);
  });
});
