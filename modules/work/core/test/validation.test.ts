import { describe, expect, it } from 'vitest';
import type { ReferenceEnvelope } from '@hq/contracts';
import { DEFAULT_SETTINGS, HQ_REFERENCES_FEATURE } from '../types';
import { isSafeUrl, isValidTimezone, normalizeFields, normalizeSettings, stripDerived, wallTimeToInstant } from '../validation';
import { FIELD_CASES, SETTINGS_CASES } from './parity-cases';

function sequence() {
  let n = 0;
  return () => `gen-${String((n += 1)).padStart(6, '0')}`;
}

describe('validation parity with the Planner rules', () => {
  it.each(FIELD_CASES)('fields: $name', ({ input, creating, expect: expected }) => {
    expect(normalizeFields(input, { creating, newId: sequence() })).toEqual(expected);
  });

  it.each(SETTINGS_CASES)('settings: $name', ({ input, expect: expected }) => {
    expect(normalizeSettings(input, { ...DEFAULT_SETTINGS })).toEqual(expected);
  });

  it('treats undefined members as absent, as JSON transport does', () => {
    expect(normalizeFields({ area: undefined, title: 'Card' }, { creating: false })).toEqual({ ok: true, value: { title: 'Card' } });
  });
});

describe('URL, zone and clock-change helpers', () => {
  it('accepts only http(s) links with a host', () => {
    expect(isSafeUrl('https://example.com')).toBe(true);
    expect(isSafeUrl('http://example.com:8080/a?b#c')).toBe(true);
    expect(isSafeUrl('https://[::1')).toBe(false);
    expect(isSafeUrl('mailto:someone@example.com')).toBe(false);
    expect(isSafeUrl('//example.com')).toBe(false);
  });

  it('matches zone names case-sensitively', () => {
    expect(isValidTimezone('America/New_York')).toBe(true);
    expect(isValidTimezone('UTC')).toBe(true);
    expect(isValidTimezone('America/new_york')).toBe(false);
    expect(isValidTimezone('')).toBe(false);
    expect(isValidTimezone(`Europe/${'x'.repeat(60)}`)).toBe(false);
  });

  it('resolves ambiguous wall times to the first occurrence and gaps to null', () => {
    expect(new Date(wallTimeToInstant('2026-11-01', '01:30', 'America/New_York')!).toISOString()).toBe('2026-11-01T05:30:00.000Z');
    expect(wallTimeToInstant('2026-03-08', '02:30', 'America/New_York')).toBeNull();
    expect(new Date(wallTimeToInstant('2026-07-01', '09:00', 'Asia/Kolkata')!).toISOString()).toBe('2026-07-01T03:30:00.000Z');
  });

  it('strips derived date members before write', () => {
    const entry = { id: 'date-001', kind: 'event' as const, precision: 'day' as const, value: '2026-11-14', time: '10:00', end_time: null, tz: 'UTC', note: '', instant: 'x', tz_abbr: 'UTC' };
    expect(stripDerived(entry)).toEqual({ id: 'date-001', kind: 'event', precision: 'day', value: '2026-11-14', time: '10:00', end_time: null, tz: 'UTC', note: '' });
  });
});

describe('proposed hq reference entry (D-4 option B, capability-gated)', () => {
  const target: ReferenceEnvelope = {
    version: 1, domain: 'design', projectId: 'fixture-project', kind: 'annotation', entityId: 'note-7',
    title: 'Hero spacing note', returnDestination: { domain: 'work', destination: 'item/ex-bread' }, sourceRevision: '3',
  };
  const features = [HQ_REFERENCES_FEATURE];

  it('stores the envelope losslessly when the service advertises hq-references-v1', () => {
    const result = normalizeFields({ references: [{ id: 'ref-hq-01', kind: 'hq', target }] }, { creating: false, features });
    expect(result).toEqual({ ok: true, value: { references: [{ id: 'ref-hq-01', kind: 'hq', label: 'Hero spacing note', target }] } });
  });

  it('is rejected exactly as today when the feature is absent', () => {
    expect(normalizeFields({ references: [{ kind: 'hq', target }] }, { creating: false })).toEqual({ ok: false, errors: [{ field: 'references', message: 'Reference 1 is malformed.' }] });
  });

  it('rejects a url member, an invalid envelope and duplicate targets', () => {
    expect(normalizeFields({ references: [{ kind: 'hq', target, url: 'https://example.com' }] }, { creating: false, features }))
      .toEqual({ ok: false, errors: [{ field: 'references', message: 'Reference 1 is malformed.' }] });
    expect(normalizeFields({ references: [{ kind: 'hq', target: { ...target, version: 2 } }] }, { creating: false, features }))
      .toEqual({ ok: false, errors: [{ field: 'references', message: 'Reference 1 has an invalid HQ target.' }] });
    expect(normalizeFields({ references: [{ kind: 'hq', target }, { kind: 'hq', label: 'Again', target: { ...target, title: 'Renamed' } }] }, { creating: false, features }))
      .toEqual({ ok: false, errors: [{ field: 'references', message: 'Reference 2 duplicates another HQ link.' }] });
  });

  it('keeps ordinary links unchanged alongside hq entries', () => {
    const result = normalizeFields({ references: [{ id: 'ref-url-01', url: 'https://example.com' }, { id: 'ref-hq-01', kind: 'hq', label: 'Note', target }] }, { creating: false, features });
    expect(result.ok && result.value.references).toEqual([
      { id: 'ref-url-01', kind: 'url', label: 'https://example.com', url: 'https://example.com' },
      { id: 'ref-hq-01', kind: 'hq', label: 'Note', target },
    ]);
  });
});
