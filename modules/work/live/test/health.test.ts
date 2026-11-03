import { describe, expect, it } from 'vitest';
import { REPLAY_FEATURE, type PlannerHealth } from '../../core';
import { HQ_REFERENCES_FEATURE } from '../../core/types';
import { probePlanner } from '../health';
import * as live from '../index';
import type { PlannerTransport, ServiceResponse, WorkRoute } from '../transport';
import { exchange, strictTransport } from './support';

// probePlanner reads only `GET /api/version` through the Work transport and maps every outcome to a typed health. The
// transports are synthetic; nothing here reaches a network or a Planner.

const BATCH = 'items.batch_create';
const AT = new Date('2026-11-03T12:00:00.000Z');
const now = () => AT;
const http = (status: number, body: unknown): ServiceResponse => ({ ok: true, status, body, replayed: false });
const version = (extra: Record<string, unknown> = {}) => ({ state_version: 7, api: 2, features: [REPLAY_FEATURE, HQ_REFERENCES_FEATURE, BATCH], ...extra });

/** Answers `GET /api/version` with `response` (or throws) and records every call. */
function answering(response: ServiceResponse | Error | unknown) {
  const calls: { route: WorkRoute; params: unknown }[] = [];
  const transport: PlannerTransport = {
    async call(route, params) {
      calls.push({ route, params: structuredClone(params) });
      if (response instanceof Error) throw response;
      return response as ServiceResponse;
    },
  };
  return { transport, calls };
}
async function probe(response: ServiceResponse | Error | unknown): Promise<PlannerHealth> {
  const t = answering(response);
  const health = await probePlanner(t.transport, now);
  expect(t.calls).toEqual([{ route: 'version', params: {} }]);
  return health;
}

describe('probePlanner reads only the version route', () => {
  it('reproduces the recorded GET /api/version and reads it as ready, API 2', async () => {
    const t = strictTransport([{ exchange: exchange('01-version') }]);
    expect(await probePlanner(t.transport, now)).toEqual({
      status: 'ready', checkedAt: '2026-11-03T12:00:00.000Z', api: 2, stateVersion: 0,
      features: [BATCH, REPLAY_FEATURE, HQ_REFERENCES_FEATURE], limits: [], retention: { max: 2000, evictedThroughVersion: 0 },
    });
    expect(t.calls.map((c) => [c.route, c.encoded.method, c.encoded.path, c.encoded.body])).toEqual([['version', 'GET', '/api/version', '']]);
    expect(t.remaining()).toBe(0);
  });

  it('stamps checkedAt from the clock it is given, and from the real clock by default', async () => {
    expect((await probe(http(200, version()))).checkedAt).toBe('2026-11-03T12:00:00.000Z');
    const before = Date.now();
    const health = await probePlanner(answering(http(200, version())).transport);
    expect(Date.parse(health.checkedAt)).toBeGreaterThanOrEqual(before);
    expect(Date.parse(health.checkedAt)).toBeLessThanOrEqual(Date.now());
  });

  it('is exported from the live module and never sends a mutation or a replay', async () => {
    expect(live.probePlanner).toBe(probePlanner);
    for (const response of [http(200, version()), http(403, null), { ok: false, kind: 'unavailable' }, http(200, 'not json')]) {
      const t = answering(response);
      await probePlanner(t.transport, now);
      expect(t.calls.map((c) => c.route)).toEqual(['version']);
    }
  });
});

describe('a valid answer', () => {
  it('is ready with every capability, carrying the decoded version, features and retention', async () => {
    expect(await probe(http(200, version({ request_retention: { max: 2000, evicted_through_version: 5 } })))).toEqual({
      status: 'ready', checkedAt: '2026-11-03T12:00:00.000Z', api: 2, stateVersion: 7,
      features: [REPLAY_FEATURE, HQ_REFERENCES_FEATURE, BATCH], limits: [], retention: { max: 2000, evictedThroughVersion: 5 },
    });
  });

  it('is ready when only batch create is missing, and still names it', async () => {
    expect(await probe(http(200, version({ features: [REPLAY_FEATURE, HQ_REFERENCES_FEATURE] })))).toMatchObject({ status: 'ready', limits: ['no_batch'] });
  });

  it.each([
    ['no replay', [HQ_REFERENCES_FEATURE, BATCH], ['no_replay']],
    ['no HQ references', [REPLAY_FEATURE, BATCH], ['no_hq_references']],
    ['neither replay nor references', [BATCH], ['no_replay', 'no_hq_references']],
    ['no replay and no batch', [HQ_REFERENCES_FEATURE], ['no_replay', 'no_batch']],
    ['no references and no batch', [REPLAY_FEATURE], ['no_hq_references', 'no_batch']],
    ['none of the three', [], ['no_replay', 'no_hq_references', 'no_batch']],
    ['unrelated features only', ['something.else'], ['no_replay', 'no_hq_references', 'no_batch']],
  ])('is limited with %s, listing limits in a fixed order', async (_, features, limits) => {
    expect(await probe(http(200, version({ features })))).toMatchObject({ status: 'limited', limits });
  });

  it('treats a body without features as a Planner with none of them', async () => {
    expect(await probe(http(200, { state_version: 1 }))).toMatchObject({ status: 'limited', features: [], limits: ['no_replay', 'no_hq_references', 'no_batch'], api: null, retention: null });
  });

  it('carries api as null when the body names none', async () => {
    expect(await probe(http(200, version({ api: undefined })))).toMatchObject({ status: 'ready', api: null });
  });
});

describe('an unusable answer', () => {
  it.each([
    ['transport unavailable', { ok: false, kind: 'unavailable' }],
    ['transport unknown', { ok: false, kind: 'unknown' }],
    ['a malformed envelope', { ok: true }],
    ['a non-object answer', 'down'],
    ['an undefined answer', undefined],
  ])('is unreachable for %s, with no status', async (_, response) => {
    const health = await probe(response);
    expect(health).toEqual({ status: 'unavailable', checkedAt: '2026-11-03T12:00:00.000Z', reason: 'unreachable' });
    expect('httpStatus' in health).toBe(false);
  });

  it('is unreachable when the bridge throws', async () => {
    expect(await probe(new Error('bridge gone'))).toEqual({ status: 'unavailable', checkedAt: '2026-11-03T12:00:00.000Z', reason: 'unreachable' });
  });

  it.each([403, 421])('is refused for %i, with the status', async (status) => {
    expect(await probe(http(status, { error: 'bad_host' }))).toEqual({ status: 'unavailable', checkedAt: '2026-11-03T12:00:00.000Z', reason: 'refused', httpStatus: status });
  });

  it.each([500, 502, 503, 599])('is server_error for %i, with the status', async (status) => {
    expect(await probe(http(status, null))).toEqual({ status: 'unavailable', checkedAt: '2026-11-03T12:00:00.000Z', reason: 'server_error', httpStatus: status });
  });

  it.each([100, 204, 301, 302, 400, 401, 404, 405, 418, 499])('is incompatible for %i, with the status', async (status) => {
    expect(await probe(http(status, '<html>another service</html>'))).toEqual({ status: 'unavailable', checkedAt: '2026-11-03T12:00:00.000Z', reason: 'incompatible', httpStatus: status });
  });

  it.each([
    ['null', null],
    ['text', '<html>a web page</html>'],
    ['a list', [1, 2]],
    ['no state_version', { api: 2, features: [] }],
    ['a textual state_version', version({ state_version: '7' })],
    ['a negative state_version', version({ state_version: -1 })],
    ['features that are not a list', version({ features: 'requests.replay' })],
    ['a non-text feature', version({ features: [REPLAY_FEATURE, 7] })],
    ['an api of zero', version({ api: 0 })],
    ['a textual api', version({ api: '2' })],
    ['a null api', version({ api: null })],
    ['a malformed request_retention', version({ request_retention: { max: 2000 } })],
  ])('is incompatible for a 200 with %s, keeping the status', async (_, body) => {
    expect(await probe(http(200, body))).toEqual({ status: 'unavailable', checkedAt: '2026-11-03T12:00:00.000Z', reason: 'incompatible', httpStatus: 200 });
  });

  it('is incompatible for a 204 with no body', async () => {
    expect(await probe(http(204, null))).toMatchObject({ reason: 'incompatible', httpStatus: 204 });
  });
});
