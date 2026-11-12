import { describe, expect, it } from 'vitest';
import { CHECKING, UNAVAILABLE, serviceStatus, wikiStatus, type DataSource, type SourceStatus } from '../services/data-source-status';
import { describe as describeStatus } from '../services/observed-status';
import type { StoragePort } from '../state';
import {
  DEFAULT_ONBOARDING, ONBOARDING_KEY, checklistAction, checklistProgress, evaluateChecklist, isFirstRun, markCelebrated, markUsed, markVisited,
  parseOnboarding, platformShortcut, readOnboarding, serializeOnboarding, setPanelState, summarizeSource, summarizeSources, writeOnboarding,
  type OnboardingState, type SourceSummaries,
} from './onboarding-state';

const memory = (initial: Record<string, string> = {}): StoragePort & { values: Record<string, string> } => {
  const values = { ...initial };
  return { values, getItem: key => values[key] ?? null, setItem: (key, value) => { values[key] = value; } };
};
const refusing: StoragePort = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); } };

const SAMPLE = serviceStatus({ configured: false, policy: 'ok', transport: null });
const SET_UP = serviceStatus({ configured: true, policy: 'ok', transport: 'https' });
const observedService = (reachable: boolean) => describeStatus('work', { config: SET_UP, observed: { state: reachable ? 'reachable' : 'unreachable', at: 0 } });
const statuses = (social: SourceStatus, work: SourceStatus, wiki: SourceStatus): Record<DataSource, SourceStatus> => ({ social, work, wiki });
const fresh = summarizeSources(statuses(SAMPLE, SAMPLE, wikiStatus(['not-configured'])));

describe('stored panel state', () => {
  it('opens a profile that has stored nothing', () => {
    expect(parseOnboarding(null)).toEqual({ state: 'open', visited: {}, used: {}, celebrated: false });
    expect(readOnboarding(memory())).toBe(DEFAULT_ONBOARDING);
    expect(isFirstRun(memory())).toBe(true);
    expect(isFirstRun(memory({ [ONBOARDING_KEY]: '{}' }))).toBe(false);
  });

  it('round-trips every field through the versioned key', () => {
    const value: OnboardingState = { state: 'collapsed', visited: { social: true, work: true }, used: { palette: true }, celebrated: true };
    expect(ONBOARDING_KEY).toBe('hq.onboarding.v1');
    expect(parseOnboarding(serializeOnboarding(value))).toEqual(value);
    const storage = memory();
    expect(writeOnboarding(storage, value)).toBe(true);
    expect(readOnboarding(storage)).toEqual(value);
  });

  it.each([
    ['malformed JSON', '{"state":'],
    ['a string', '"hidden"'],
    ['an array', '[]'],
    ['null', 'null'],
    ['a number', '3'],
  ])('falls back to the defaults for %s', (_name, raw) => {
    expect(parseOnboarding(raw)).toEqual(DEFAULT_ONBOARDING);
  });

  it('keeps what is valid and defaults the rest, field by field', () => {
    expect(parseOnboarding(JSON.stringify({ state: 'hidden', visited: 'nope', used: [], celebrated: 'yes' })))
      .toEqual({ state: 'hidden', visited: {}, used: {}, celebrated: false });
    expect(parseOnboarding(JSON.stringify({ state: 'minimised', visited: { social: true } })))
      .toEqual({ state: 'open', visited: { social: true }, used: {}, celebrated: false });
    expect(parseOnboarding(JSON.stringify({ state: 'open', visited: { social: true, work: 1, galaxy: true, wiki: 'true' }, used: { palette: true, other: true } })))
      .toEqual({ state: 'open', visited: { social: true }, used: { palette: true }, celebrated: false });
  });

  it('survives storage that refuses reads and writes', () => {
    expect(readOnboarding(refusing)).toBe(DEFAULT_ONBOARDING);
    expect(isFirstRun(refusing)).toBe(true);
    expect(writeOnboarding(refusing, DEFAULT_ONBOARDING)).toBe(false);
  });
});

describe('tracking what the user has done', () => {
  it('records each fact once and hands back the same object when nothing changed', () => {
    const visited = markVisited(DEFAULT_ONBOARDING, 'social');
    expect(visited.visited).toEqual({ social: true });
    expect(markVisited(visited, 'social')).toBe(visited);
    const used = markUsed(visited, 'palette');
    expect(used.used).toEqual({ palette: true });
    expect(markUsed(used, 'palette')).toBe(used);
    expect(setPanelState(used, 'open')).toBe(used);
    expect(setPanelState(used, 'hidden').state).toBe('hidden');
    expect(markCelebrated(used).celebrated).toBe(true);
    expect(markCelebrated(markCelebrated(used))).toEqual(markCelebrated(used));
    expect(DEFAULT_ONBOARDING.visited).toEqual({});
  });
});

describe('source summaries', () => {
  it('describes Social and Work in the panel words', () => {
    expect(summarizeSource('work', SAMPLE)).toEqual({ kind: 'sample', text: 'Sample data · set up to use your own', tone: 'neutral', configured: false });
    expect(summarizeSource('work', SET_UP)).toEqual({ kind: 'configured', text: 'Set up · not checked', tone: 'neutral', configured: true });
    expect(summarizeSource('social', observedService(true))).toEqual({ kind: 'connected', text: observedService(true).text, tone: 'good', configured: true });
    expect(summarizeSource('social', observedService(false))).toEqual({ kind: 'unreachable', text: observedService(false).text, tone: 'warning', configured: true });
    expect(summarizeSource('social', CHECKING)).toMatchObject({ kind: 'checking', configured: undefined });
    expect(summarizeSource('work', UNAVAILABLE)).toMatchObject({ kind: 'problem', text: 'Unavailable', configured: false });
    expect(summarizeSource('work', serviceStatus({ configured: true, policy: 'rejected', transport: null }))).toMatchObject({ kind: 'problem', text: 'Address rejected' });
  });

  it('describes the Wiki, including the status the shell shows before its first check', () => {
    expect(summarizeSource('wiki', wikiStatus([]))).toMatchObject({ kind: 'unset', text: 'Not set up', configured: false });
    expect(summarizeSource('wiki', wikiStatus(['ready']))).toMatchObject({ kind: 'ready', text: 'Ready', tone: 'good', configured: true });
    expect(summarizeSource('wiki', wikiStatus(['indexing']))).toMatchObject({ kind: 'indexing', configured: true });
    expect(summarizeSource('wiki', wikiStatus(['stale']))).toMatchObject({ kind: 'stale', text: 'Index stale', tone: 'warning', configured: true });
    expect(summarizeSource('wiki', wikiStatus(undefined))).toMatchObject({ kind: 'problem', text: 'Index unavailable', configured: false });
    expect(summarizeSource('wiki', { text: 'Index not checked', tone: 'neutral' })).toMatchObject({ kind: 'checking', configured: undefined });
  });

  it('does not take a Social status for a Wiki one', () => {
    expect(summarizeSource('wiki', SAMPLE).kind).toBe('checking');
    expect(summarizeSource('work', wikiStatus(['ready'])).kind).toBe('checking');
  });
});

describe('checklist', () => {
  const ids = (items: ReturnType<typeof evaluateChecklist>) => items.map(item => item.id);
  const done = (items: ReturnType<typeof evaluateChecklist>) => Object.fromEntries(items.map(item => [item.id, item.done]));

  it('lists the five steps in order, none done on a new profile with sample data', () => {
    const items = evaluateChecklist(DEFAULT_ONBOARDING, fresh, 'Ctrl K');
    expect(ids(items)).toEqual(['look-around', 'connect-work', 'connect-social', 'add-wiki', 'command-palette']);
    expect(items.map(item => item.label)).toEqual([
      'Take a look around with sample data', 'Connect Work (Planner)', 'Connect Social', 'Add a Wiki repository', 'Jump anywhere with Ctrl K',
    ]);
    expect(Object.values(done(items))).toEqual([false, false, false, false, false]);
    expect(checklistProgress(items)).toEqual({ done: 0, total: 5, complete: false });
  });

  it('marks the look-around step done only once both Social and Work were visited', () => {
    const social = markVisited(DEFAULT_ONBOARDING, 'social');
    expect(done(evaluateChecklist(social, fresh, 'Ctrl K'))['look-around']).toBe(false);
    expect(done(evaluateChecklist(markVisited(social, 'design'), fresh, 'Ctrl K'))['look-around']).toBe(false);
    expect(done(evaluateChecklist(markVisited(social, 'work'), fresh, 'Ctrl K'))['look-around']).toBe(true);
  });

  it('derives the connect steps from the shell\'s data-source state', () => {
    const live = summarizeSources(statuses(observedService(true), SET_UP, wikiStatus(['ready'])));
    expect(done(evaluateChecklist(DEFAULT_ONBOARDING, live, 'Ctrl K'))).toMatchObject({ 'connect-work': true, 'connect-social': true, 'add-wiki': true, 'look-around': false });
    const dead = summarizeSources(statuses(observedService(false), observedService(false), wikiStatus(undefined)));
    const items = evaluateChecklist(DEFAULT_ONBOARDING, dead, 'Ctrl K');
    expect(done(items)).toMatchObject({ 'connect-work': true, 'connect-social': true, 'add-wiki': false });
    expect(items.find(item => item.id === 'connect-work')!.hint).toBe('Unreachable · check the address in Data sources');
    expect(items.find(item => item.id === 'add-wiki')!.hint).toBe('Index unavailable · check Data sources');
  });

  it('leaves a step undecided while the shell is still checking its source', () => {
    const checking = summarizeSources(statuses(CHECKING, CHECKING, { text: 'Index not checked', tone: 'neutral' }));
    const items = evaluateChecklist(DEFAULT_ONBOARDING, checking, 'Ctrl K');
    expect(done(items)).toMatchObject({ 'connect-work': undefined, 'connect-social': undefined, 'add-wiki': undefined, 'look-around': false });
    expect(checklistProgress(items)).toEqual({ done: 0, total: 5, complete: false });
    expect(checklistProgress(items, { 'connect-work': true, 'add-wiki': true })).toEqual({ done: 2, total: 5, complete: false });
  });

  it('marks the palette step after its first use', () => {
    expect(done(evaluateChecklist(markUsed(DEFAULT_ONBOARDING, 'palette'), fresh, 'Ctrl K'))['command-palette']).toBe(true);
  });

  it('counts a finished checklist as complete', () => {
    const all: SourceSummaries = summarizeSources(statuses(observedService(true), observedService(true), wikiStatus(['ready'])));
    const state = markUsed(markVisited(markVisited(DEFAULT_ONBOARDING, 'social'), 'work'), 'palette');
    expect(checklistProgress(evaluateChecklist(state, all, '⌘K'))).toEqual({ done: 5, total: 5, complete: true });
  });

  it('drops "sample data" from the first step once Social or Work is really connected', () => {
    const mixed = summarizeSources(statuses(SAMPLE, observedService(true), wikiStatus([])));
    expect(evaluateChecklist(DEFAULT_ONBOARDING, mixed, 'Ctrl K')[0]!.label).toBe('Take a look around Social and Work');
  });

  it('chooses what each step does', () => {
    expect(checklistAction('look-around', DEFAULT_ONBOARDING)).toEqual({ type: 'navigate', domain: 'social', destination: 'overview' });
    expect(checklistAction('look-around', markVisited(DEFAULT_ONBOARDING, 'social'))).toEqual({ type: 'navigate', domain: 'work', destination: 'board' });
    expect(checklistAction('connect-work', DEFAULT_ONBOARDING)).toEqual({ type: 'open-settings', source: 'work' });
    expect(checklistAction('connect-social', DEFAULT_ONBOARDING)).toEqual({ type: 'open-settings', source: 'social' });
    expect(checklistAction('add-wiki', DEFAULT_ONBOARDING)).toEqual({ type: 'open-settings', source: 'wiki' });
    expect(checklistAction('command-palette', DEFAULT_ONBOARDING)).toEqual({ type: 'open-command-palette' });
  });

  it('names the palette shortcut for the platform', () => {
    expect(platformShortcut('MacIntel')).toBe('⌘K');
    expect(platformShortcut('Linux x86_64')).toBe('Ctrl K');
    expect(platformShortcut('Win32')).toBe('Ctrl K');
    expect(platformShortcut('')).toBe('Ctrl K');
  });
});
