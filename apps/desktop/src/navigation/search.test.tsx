// @vitest-environment happy-dom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DomainId, ReferenceEnvelope } from '@hq/contracts';
import { buildCommands } from './commands';
import { buildGroups, describeReference, flattenRows, SEARCH_DEBOUNCE_MS, useReferenceSearch } from './search';

const envelope = (domain: DomainId, kind: string, entityId: string, title: string): ReferenceEnvelope => ({
  version: 1, domain, projectId: 'hq-local', kind, entityId, title, returnDestination: { domain, destination: 'home' },
});
const commands = buildCommands({ domain: 'work', settingsOpen: false, appearance: 'system', back: null, mac: false });

describe('describeReference', () => {
  it('names the domain and kind in plain words, never the entity id', () => {
    expect(describeReference({ domain: 'work', kind: 'item' })).toBe('Work card');
    expect(describeReference({ domain: 'social', kind: 'draft' })).toBe('Social draft');
    expect(describeReference({ domain: 'design', kind: 'project' })).toBe('Design project');
    expect(describeReference({ domain: 'design', kind: 'some_new-kind' })).toBe('Design some new kind');
  });
});

describe('buildGroups', () => {
  it('lists the short browse set for an empty query, current domain sections included', () => {
    const groups = buildGroups({ query: '', commands, results: [], currentDomain: 'work' });
    expect(groups.map(group => group.label)).toEqual(['Go to', 'Work', 'Settings', 'Appearance', 'Help']);
    const ids = flattenRows(groups).map(row => row.id);
    expect(ids).toContain('go:social');
    expect(ids).toContain('section:work:board');
    expect(ids).not.toContain('section:social:library');
  });

  it('finds commands across domains by typing, best match first', () => {
    const rows = flattenRows(buildGroups({ query: 'library', commands, results: [], currentDomain: 'work' }));
    expect(rows[0]!.id).toBe('section:social:library');
    const settings = flattenRows(buildGroups({ query: 'work settings', commands, results: [], currentDomain: 'design' }));
    expect(settings.map(row => row.title)).toContain('Planner settings');
    expect(flattenRows(buildGroups({ query: 'dark', commands, results: [], currentDomain: 'work' })).map(row => row.id)).toContain('appearance:dark');
  });

  it('groups results by domain with the current domain first, labelled by kind', () => {
    const results = [
      envelope('design', 'project', 'p-1', 'Autumn menu design'), envelope('work', 'item', 'abc123', 'Autumn tasting card'),
      envelope('social', 'draft', 'd-9', 'Autumn blend notes'),
    ];
    const groups = buildGroups({ query: 'autumn', commands, results, currentDomain: 'social' });
    const found = groups.filter(group => group.id.startsWith('found:'));
    expect(found.map(group => group.label)).toEqual(['In Social', 'In Design', 'In Work']);
    const rows = found.flatMap(group => group.rows);
    expect(rows.map(row => [row.title, row.detail])).toEqual([
      ['Autumn blend notes', 'Social draft'], ['Autumn menu design', 'Design project'], ['Autumn tasting card', 'Work card'],
    ]);
    for (const row of rows) expect([row.title, row.detail, row.shortcut].join(' ')).not.toMatch(/p-1|abc123|d-9/u);
    expect(rows[0]!.action).toEqual({ type: 'open-reference', envelope: results[2] });
  });

  it('puts commands before results and the Wiki search fallback last', () => {
    const results = [envelope('work', 'item', 'i1', 'Settings review card')];
    const groups = buildGroups({ query: 'settings', commands, results, currentDomain: 'work' });
    const order = groups.map(group => group.id);
    expect(order.indexOf('settings')).toBeLessThan(order.indexOf('found:work'));
    expect(order.at(-1)).toBe('search');
    const fallback = groups.at(-1)!.rows[0]!;
    expect(fallback.title).toBe('Search Wiki for “settings”');
    expect(fallback.action).toEqual({ type: 'navigate', domain: 'wiki', destination: 'search?q=settings' });
  });

  it('searches only from two characters, and drops previous results that no longer match', () => {
    const results = [envelope('work', 'item', 'i1', 'Venue booking')];
    const one = buildGroups({ query: 'v', commands, results, currentDomain: 'work' });
    expect(one.some(group => group.id === 'search' || group.id.startsWith('found:'))).toBe(false);
    expect(buildGroups({ query: 'ven', commands, results, currentDomain: 'work' }).some(group => group.id === 'found:work')).toBe(true);
    expect(buildGroups({ query: 'xyz', commands, results, currentDomain: 'work' }).some(group => group.id === 'found:work')).toBe(false);
  });

  it('trims the query and ignores a query only the fallback could answer', () => {
    const groups = buildGroups({ query: '  zzqx  ', commands, results: [], currentDomain: 'work' });
    expect(groups.map(group => group.id)).toEqual(['search']);
    expect(groups[0]!.rows[0]!.title).toBe('Search Wiki for “zzqx”');
  });
});

describe('useReferenceSearch', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { cleanup(); vi.useRealTimers(); });
  const found = [envelope('work', 'item', 'i1', 'Venue booking')];

  it('stays idle below two characters and when disabled', () => {
    const find = vi.fn(async () => found);
    const short = renderHook(() => useReferenceSearch({ find }, 'hq-local', 'v', true));
    const off = renderHook(() => useReferenceSearch({ find }, 'hq-local', 'venue', false));
    act(() => { vi.advanceTimersByTime(1000); });
    expect(find).not.toHaveBeenCalled();
    expect(short.result.current.status).toBe('idle');
    expect(off.result.current.status).toBe('idle');
  });

  it('debounces typing into one provider query with the project and limit', async () => {
    const find = vi.fn(async () => found);
    const { result, rerender } = renderHook(({ query }) => useReferenceSearch({ find }, 'hq-local', query, true), { initialProps: { query: 've' } });
    expect(result.current.status).toBe('pending');
    act(() => { vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS - 20); });
    rerender({ query: 'ven' });
    act(() => { vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS - 20); });
    expect(find).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(40); });
    expect(find).toHaveBeenCalledExactlyOnceWith('ven', { projectId: 'hq-local', limit: 20 });
    expect(result.current).toEqual({ status: 'done', results: found });
  });

  it('ignores a slow answer to an older query', async () => {
    let release!: (value: ReferenceEnvelope[]) => void;
    const slow = new Promise<ReferenceEnvelope[]>(resolve => { release = resolve; });
    const find = vi.fn((query: string) => (query === 'old' ? slow : Promise.resolve(found)));
    const { result, rerender } = renderHook(({ query }) => useReferenceSearch({ find }, 'hq-local', query, true), { initialProps: { query: 'old' } });
    await act(async () => { await vi.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS + 1); });
    rerender({ query: 'new' });
    await act(async () => { await vi.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS + 1); });
    expect(result.current.results).toEqual(found);
    await act(async () => { release([envelope('work', 'item', 'stale', 'Stale result')]); await Promise.resolve(); });
    expect(result.current.results).toEqual(found);
  });

  it('keeps earlier results while the next query is pending, and reports a failing port without throwing', async () => {
    const find = vi.fn().mockResolvedValueOnce(found).mockRejectedValueOnce(new Error('down'));
    const { result, rerender } = renderHook(({ query }) => useReferenceSearch({ find }, 'hq-local', query, true), { initialProps: { query: 'ven' } });
    await act(async () => { await vi.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS + 1); });
    rerender({ query: 'venu' });
    expect(result.current).toEqual({ status: 'pending', results: found });
    await act(async () => { await vi.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS + 1); });
    expect(result.current).toEqual({ status: 'failed', results: [] });
  });

  it('cancels a pending search on unmount', async () => {
    const find = vi.fn(async () => found);
    const { unmount } = renderHook(() => useReferenceSearch({ find }, 'hq-local', 'venue', true));
    unmount();
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(find).not.toHaveBeenCalled();
  });
});
