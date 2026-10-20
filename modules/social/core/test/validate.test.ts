import { describe, expect, it } from 'vitest';
import { FEATURE_HQ_REFERENCES } from '../port';
import { possibleRunMatches, submitRunOnce } from '../runs';
import {
  MAX_BODY_BYTES, MESSAGES, checkDraft, checkRunSubmission, codePoints, isPlanningDate, pyStrip, textMessage,
} from '../validate';

describe('Social client validation', () => {
  it('uses the service message text verbatim', () => {
    expect([textMessage('Title', 200), textMessage('Body', 50_000, true), textMessage('Brand name', 80), textMessage('ID', 32)])
      .toEqual(['Title must be text, 1–200 characters', 'Body must be text, 0–50000 characters', 'Brand name must be text, 1–80 characters', 'ID must be text, 1–32 characters']);
    expect(MESSAGES).toMatchObject({
      unknownChannel: 'Unknown channel', plannedDate: 'Use a YYYY-MM-DD planning date', plannedDateText: 'Planning date must be text',
      archived: 'Invalid archive state', unknownBrand: 'Unknown brand', version: 'Version required',
      conflict: 'This draft changed in another window. Close and reopen it before saving.',
      runInput: 'Choose a known tool and supply a JSON object', exampleFlag: 'Example label must be boolean',
      queueFull: 'Run queue is full. Wait for a run to finish.', runId: 'Invalid run ID', unknownTool: 'Unknown tool',
      bodySize: 'Input must be 1–2,000,000 bytes', jsonObject: 'JSON object required',
      interrupted: 'Service restarted before completion; run again explicitly.',
    });
  });

  it('strips the same whitespace as the service', () => {
    expect(pyStrip('\u001c\u0085 title 　')).toBe('title');
    expect(pyStrip('﻿title')).toBe('﻿title');
  });

  it('counts code points', () => {
    expect(codePoints('🌿a')).toBe(2);
  });

  it.each([
    ['2024-02-29', true], ['2023-02-29', false], ['1900-02-29', false], ['2000-02-29', true],
    ['0000-01-01', false], ['9999-12-31', true], ['2026-04-31', false], ['２０２６-01-01', false],
  ])('treats %s as a planning date: %s', (value, expected) => {
    expect(isPlanningDate(value)).toBe(expected);
  });

  it('applies service defaults for absent fields', () => {
    const checked = checkDraft({ title: 'Only a title' }, { features: [] });
    expect(checked).toEqual({ ok: true, value: { fields: { title: 'Only a title', body: '', brand_id: 'default', channel: 'General', planned_date: '', archived: 0 } } });
  });

  it('checks the brand only when the brand list is known', () => {
    expect(checkDraft({ title: 'T', brand_id: 'other' }, { features: [] }).ok).toBe(true);
    expect(checkDraft({ title: 'T', brand_id: 'other' }, { features: [], brandIds: ['default'] })).toEqual({ ok: false, error: { kind: 'invalid', message: MESSAGES.unknownBrand } });
  });

  it('accepts boolean archive flags and normalizes them', () => {
    expect(checkDraft({ title: 'T', archived: true }, { features: [] })).toMatchObject({ ok: true, value: { fields: { archived: 1 } } });
  });

  it('rejects a non-boolean version and a non-text ID', () => {
    expect(checkDraft({ title: 'T', id: 'abc', version: true }, { features: [] })).toMatchObject({ ok: false, error: { message: MESSAGES.version } });
    expect(checkDraft({ title: 'T', id: 7, version: 1 }, { features: [] })).toMatchObject({ ok: false, error: { message: textMessage('ID', 32) } });
  });

  it('drops an empty links list instead of sending it to a service without hq-references-v1', () => {
    expect(checkDraft({ title: 'T', links: [] }, { features: [] })).toMatchObject({ ok: true, value: expect.not.objectContaining({ links: expect.anything() }) });
    expect(checkDraft({ title: 'T', links: 'x' }, { features: [FEATURE_HQ_REFERENCES] })).toMatchObject({ ok: false, error: { message: MESSAGES.linksInvalid } });
  });

  it('checks the serialized run body size before the tool', () => {
    const huge = { notes: 'x'.repeat(MAX_BODY_BYTES) };
    expect(checkRunSubmission('no-such-tool', huge, false)).toEqual({ ok: false, error: { kind: 'invalid', message: MESSAGES.bodySize } });
  });
});

describe('Social run helpers', () => {
  it('reports a non-port rejection from submitRun as unknown', async () => {
    const port = { submitRun: () => Promise.reject(new TypeError('socket hang up')) };
    const outcome = await submitRunOnce(port as never, 'x-studio', {}, false, () => '2026-10-20T12:00:00Z');
    expect(outcome).toEqual({ kind: 'unknown', attemptedAt: '2026-10-20T12:00:00Z' });
  });

  it('offers only same-tool, same-flag runs created since the attempt as possible matches', () => {
    const run = (id: string, tool: 'x-studio' | 'seo-studio', created_at: string, is_example: 0 | 1 = 0) =>
      ({ id, tool, status: 'queued' as const, is_example, created_at, finished_at: null, error: null });
    const runs = [
      run('a', 'x-studio', '2026-10-20T12:00:05.000000+00:00'),
      run('b', 'x-studio', '2026-10-20T11:59:59+00:00'),
      run('c', 'seo-studio', '2026-10-20T12:00:06+00:00'),
      run('d', 'x-studio', '2026-10-20T12:00:07+00:00', 1),
    ];
    expect(possibleRunMatches(runs, { tool: 'x-studio', isExample: false, attemptedAt: '2026-10-20T12:00:00Z' }).map((item) => item.id)).toEqual(['a']);
  });

  it('prefers the run IDs seen before the attempt over clock comparison', () => {
    const run = (id: string, created_at: string) => ({ id, tool: 'x-studio' as const, status: 'queued' as const, is_example: 0 as const, created_at, finished_at: null, error: null });
    // The service clock runs behind the client: the new run looks older than the attempt.
    const runs = [run('new', '2026-10-20T11:59:58+00:00'), run('old', '2026-10-20T11:00:00+00:00')];
    expect(possibleRunMatches(runs, { tool: 'x-studio', isExample: false, attemptedAt: '2026-10-20T12:00:00Z', knownRunIds: ['old'] }).map((item) => item.id)).toEqual(['new']);
  });

  it('rejects a non-text brand even without a known brand list', () => {
    expect(checkDraft({ title: 'T', brand_id: 5 }, { features: [] })).toMatchObject({ ok: false, error: { message: MESSAGES.unknownBrand } });
  });
});
