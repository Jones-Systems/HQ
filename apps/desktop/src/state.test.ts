import { describe, expect, it } from 'vitest';
import { APPEARANCE_KEY, DEFAULT_STATE, navigate, navigationKey, persist, readAppearance, readNavigation, resolveAppearance, type StoragePort } from './state';

function memoryStorage(): StoragePort {
  const values = new Map<string, string>();
  return { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value); } };
}

describe('appearance persistence and system following', () => {
  it('persists the preference rather than the resolved system color', () => {
    const storage = memoryStorage();
    expect(readAppearance(storage)).toBe('system');
    persist(storage, APPEARANCE_KEY, 'system');
    expect(resolveAppearance(readAppearance(storage), false)).toBe('light');
    expect(resolveAppearance(readAppearance(storage), true)).toBe('dark');
    persist(storage, APPEARANCE_KEY, 'light');
    expect(resolveAppearance(readAppearance(storage), true)).toBe('light');
    persist(storage, APPEARANCE_KEY, 'dark');
    expect(resolveAppearance(readAppearance(storage), false)).toBe('dark');
  });
  it('recovers from invalid and inaccessible storage', () => {
    const storage = memoryStorage();
    storage.setItem(APPEARANCE_KEY, 'unknown');
    expect(readAppearance(storage)).toBe('system');
    const blocked: StoragePort = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } };
    expect(readAppearance(blocked)).toBe('system');
    expect(readNavigation(blocked, 'a')).toEqual(DEFAULT_STATE);
    expect(persist(blocked, 'key', 'value')).toBe(false);
  });
});

describe('independent domain destinations', () => {
  it('restores all domains across switches and reloads without dispatch', () => {
    const storage = memoryStorage();
    let state = navigate(DEFAULT_STATE, 'design', 'decisions/one');
    state = navigate(state, 'social', 'calendar');
    state = navigate(state, 'work', 'board/review');
    state = navigate(state, 'design');
    expect(state.destinations).toEqual({ design: 'decisions/one', social: 'calendar', work: 'board/review', wiki: 'home' });
    persist(storage, navigationKey('a'), JSON.stringify(state));
    expect(readNavigation(storage, 'a')).toEqual(state);
    expect(navigate(readNavigation(storage, 'a'), 'work').destinations.work).toBe('board/review');
    expect(readNavigation(storage, 'b')).toEqual(DEFAULT_STATE);
    expect(DEFAULT_STATE.destinations.design).toBe('home');
  });
  it.each(['{broken', 'null', '[]', '{"domain":"unknown"}', '{"domain":"design","destinations":{"design":"https://example.com","social":"home","work":"home"}}'])('recovers from corrupted navigation %s', (value) => {
    const storage = memoryStorage();
    storage.setItem(navigationKey('a'), value);
    expect(readNavigation(storage, 'a')).toEqual(DEFAULT_STATE);
  });
  it('rejects executable navigation without changing state', () => {
    expect(navigate(DEFAULT_STATE, 'design', 'javascript:run()')).toBe(DEFAULT_STATE);
  });
});

it('migrates legacy home to Wiki while preserving the other domain destinations', () => {
  const storage = memoryStorage();
  storage.setItem(navigationKey('legacy'), JSON.stringify({ domain: 'home', destinations: { design: 'projects', social: 'calendar', work: 'board' } }));
  expect(readNavigation(storage, 'legacy')).toEqual({ domain: 'wiki', destinations: { design: 'projects', social: 'calendar', work: 'board', wiki: 'home' } });
});
it('adds Wiki home to old three-domain state and preserves current Wiki destinations', () => {
  const storage = memoryStorage();
  storage.setItem(navigationKey('a'), JSON.stringify({ domain: 'work', destinations: { design: 'home', social: 'calendar', work: 'board' } }));
  expect(readNavigation(storage, 'a').destinations.wiki).toBe('home');
  const current = navigate(readNavigation(storage, 'a'), 'wiki', 'topics/bl');
  persist(storage, navigationKey('a'), JSON.stringify(current)); expect(readNavigation(storage, 'a')).toEqual(current);
});
