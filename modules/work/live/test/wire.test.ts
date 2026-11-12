import { describe, expect, it } from 'vitest';
import { decodeSnapshot, decodeVersion } from '../wire';
import { exchange } from './support';

// The service's `api` and `request_retention` members on `GET /api/version`, and `api` on `GET /api/state`. Absent
// members decode to nothing; a present but malformed member makes the whole body malformed, like `state_version`.

const FEATURES = ['items.batch_create', 'requests.replay', 'hq-references-v1'];
const body = (extra: Record<string, unknown> = {}) => ({ state_version: 3, ...extra });
const without = (source: Record<string, unknown>, key: string) => Object.fromEntries(Object.entries(source).filter(([name]) => name !== key));

describe('decodeVersion', () => {
  it('reads the recorded version exchanges: api and retention beside the version and features', () => {
    expect(decodeVersion(exchange('01-version').response.body)).toEqual({
      stateVersion: 0, features: FEATURES, api: 2, retention: { max: 2000, evictedThroughVersion: 0 },
    });
    expect(decodeVersion(exchange('26-version').response.body)).toMatchObject({ stateVersion: 9, api: 2 });
  });

  it('decodes an absent api and retention as null, and missing features as []', () => {
    expect(decodeVersion(body())).toEqual({ stateVersion: 3, features: [], api: null, retention: null });
    expect(decodeVersion(body({ api: 1 }))).toMatchObject({ api: 1, retention: null });
    expect(decodeVersion(body({ request_retention: { max: 10, evicted_through_version: 4 } }))).toMatchObject({ api: null, retention: { max: 10, evictedThroughVersion: 4 } });
  });

  it('accepts any positive integer api and a zero eviction floor', () => {
    for (const api of [1, 2, 3, 41]) expect(decodeVersion(body({ api }))!.api).toBe(api);
    expect(decodeVersion(body({ request_retention: { max: 0, evicted_through_version: 0 } }))!.retention).toEqual({ max: 0, evictedThroughVersion: 0 });
  });

  it.each([0, -1, 2.5, '2', null, true, [2], { api: 2 }])('a present but malformed api (%j) makes the body malformed', (api) => {
    expect(decodeVersion(body({ api }))).toBeNull();
  });

  it.each([
    ['null', null],
    ['text', 'many'],
    ['a list', [{ max: 1, evicted_through_version: 0 }]],
    ['an empty record', {}],
    ['a missing max', { evicted_through_version: 0 }],
    ['a missing floor', { max: 2000 }],
    ['a fractional max', { max: 1.5, evicted_through_version: 0 }],
    ['a textual max', { max: '2000', evicted_through_version: 0 }],
    ['a negative floor', { max: 2000, evicted_through_version: -1 }],
    ['a null floor', { max: 2000, evicted_through_version: null }],
  ])('a present but malformed request_retention (%s) makes the body malformed', (_, request_retention) => {
    expect(decodeVersion(body({ request_retention }))).toBeNull();
  });

  it('still fails closed on the members it already checked', () => {
    expect(decodeVersion(body({ state_version: '3' }))).toBeNull();
    expect(decodeVersion(body({ features: 'requests.replay' }))).toBeNull();
    expect(decodeVersion(without(body({ api: 2 }), 'state_version'))).toBeNull();
    expect(decodeVersion(null)).toBeNull();
    expect(decodeVersion([])).toBeNull();
  });

  it('drops members it does not know', () => {
    expect(decodeVersion(body({ api: 2, extra: 'ignored' }))).not.toHaveProperty('extra');
  });
});

describe('decodeSnapshot api', () => {
  const state = exchange('25-state').response.body as Record<string, unknown>;

  it('sets api when the state carries one (the recorded state exchanges)', () => {
    expect(decodeSnapshot(exchange('02-state-empty').response.body)).toMatchObject({ api: 2, stateVersion: 0 });
    expect(decodeSnapshot(state)).toMatchObject({ api: 2, stateVersion: 9 });
  });

  it('leaves api absent, not undefined, when the state carries none', () => {
    const snapshot = decodeSnapshot(without(state, 'api'));
    expect(snapshot).not.toBeNull();
    expect('api' in snapshot!).toBe(false);
  });

  it.each([0, -3, 1.5, '2', null])('a present but malformed api (%j) makes the state malformed', (api) => {
    expect(decodeSnapshot({ ...state, api })).toBeNull();
  });
});
