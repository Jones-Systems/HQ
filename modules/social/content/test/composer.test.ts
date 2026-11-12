import { describe, expect, it } from 'vitest';
import type { ReferenceEnvelope } from '@hq/contracts';
import { LIMITS } from '../../core';
import { ILLUSTRATIVE_LIMITS, draftChecks, formatCount, runOrigin, showsHeadline, splitAtLimit } from '../composer/channel';

function run(title: string, sourceRevision?: string): ReferenceEnvelope {
  return {
    version: 1, domain: 'social', projectId: 'fixture-project', kind: 'run', entityId: 'fixture-run', title,
    returnDestination: { domain: 'social', destination: 'library' }, ...(sourceRevision ? { sourceRevision } : {}),
  };
}

describe('composer: illustrative limits', () => {
  it('gives X a guide, gives article-like channels none, and never claims platform rules', () => {
    expect(ILLUSTRATIVE_LIMITS.X).toBe(280);
    expect(ILLUSTRATIVE_LIMITS.General).toBeNull();
    expect(ILLUSTRATIVE_LIMITS.Article).toBeNull();
    expect(ILLUSTRATIVE_LIMITS.Reddit).toBeNull();
  });

  it('splits at the limit by code point and leaves short or unguided text whole', () => {
    expect(splitAtLimit('abcdef', 4)).toEqual({ within: 'abcd', over: 'ef' });
    expect(splitAtLimit('abc', 4)).toEqual({ within: 'abc', over: '' });
    expect(splitAtLimit('abcdef', null)).toEqual({ within: 'abcdef', over: '' });
    expect(splitAtLimit('a🍵b🍵c', 3)).toEqual({ within: 'a🍵b', over: '🍵c' });
  });

  it('shows a headline only on channels whose posts have one', () => {
    expect(showsHeadline('Article')).toBe(true);
    expect(showsHeadline('X')).toBe(false);
  });

  it('formats counts with separators', () => {
    expect(formatCount(2200)).toBe('2,200');
  });
});

describe('composer: checks', () => {
  const ids = (checks: ReturnType<typeof draftChecks>) => Object.fromEntries(checks.map((check) => [check.id, check.state]));

  it('fails only a missing title; an empty body is a note, not a block', () => {
    expect(ids(draftChecks({ title: '', body: '', channel: 'X' }))).toMatchObject({ title: 'fail', text: 'warn' });
    expect(ids(draftChecks({ title: 'A title', body: 'Words', channel: 'X' }))).toMatchObject({ title: 'pass', text: 'pass', limit: 'pass', size: 'pass' });
  });

  it('warns past the illustrative limit, in words that say it is illustrative', () => {
    const checks = draftChecks({ title: 'T', body: 'x'.repeat(300), channel: 'X' });
    const limit = checks.find((check) => check.id === 'limit')!;
    expect(limit.state).toBe('warn');
    expect(limit.label).toBe('20 over the illustrative 280-character limit');
    expect(checks.find((check) => check.id === 'size')!.state).toBe('pass');
  });

  it('says there is no guide for a channel without one', () => {
    expect(draftChecks({ title: 'T', body: 'x', channel: 'Article' }).find((check) => check.id === 'limit')).toMatchObject({ state: 'info', label: 'No length guide for Article' });
  });

  it('fails on the Social service size limits, which are the only hard ones', () => {
    const body = draftChecks({ title: 'T', body: 'x'.repeat(LIMITS.body + 1), channel: 'Article' }).find((check) => check.id === 'size')!;
    expect(body.state).toBe('fail');
    expect(body.label).toContain('Social service limit');
    const title = draftChecks({ title: 't'.repeat(LIMITS.title + 1), body: 'x', channel: 'Article' }).find((check) => check.id === 'size')!;
    expect(title.state).toBe('fail');
  });
});

describe('composer: run origin', () => {
  it('has none without a run link', () => {
    expect(runOrigin(undefined)).toBeUndefined();
    expect(runOrigin([])).toBeUndefined();
    expect(runOrigin([{ ...run('Plan the cupping hour'), kind: 'item' }])).toBeUndefined();
  });

  it('reads the tool, date and example flag from a run citation title', () => {
    expect(runOrigin([run('Signal inbox run · 2026-10-18 · example')])).toMatchObject({ tool: 'Signal inbox', asOf: '18 Oct 2026', example: true });
    expect(runOrigin([run('Signal inbox run · 2026-10-18')])).toMatchObject({ tool: 'Signal inbox', asOf: '18 Oct 2026', example: false });
  });

  it('keeps the whole title as the tool when it has another shape, and takes the date from the source revision', () => {
    const origin = runOrigin([run('Signal inbox · Neighborhood tea', '2026-10-18')])!;
    expect(origin.tool).toBe('Signal inbox · Neighborhood tea');
    expect(origin.asOf).toBe('18 Oct 2026');
    expect(runOrigin([run('Signal inbox · Neighborhood tea', 'rev-7')])!.asOf).toBeUndefined();
  });
});
