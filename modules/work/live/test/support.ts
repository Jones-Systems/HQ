import { readdirSync, readFileSync } from 'node:fs';
import { expect } from 'vitest';
import {
  PlannerPortError, ReplayIndeterminateError,
  type Anchor, type FixtureControl, type FixtureWriteCall, type PlannerPort, type SettingsWriteResult, type WriteResult,
} from '../../core';
import type { PlannerTransport, ServiceResponse, WorkMutationCall, WorkParams, WorkRoute } from '../transport';

// Test support for the Work live adapter. Everything is synthetic: the pinned public contract exchanges, and the
// in-memory fixture Planner behind a transport that speaks the service's wire bodies. Nothing here reaches a network,
// an installed service or live data.

export const CONTRACT = new URL('./contract/', import.meta.url);

export interface Exchange {
  schema: 'hq.planner.exchange/v1';
  request: { method: string; path: string; headers: Record<string, string>; body_utf8: string };
  response: { status: number; headers: Record<string, string>; body?: unknown };
}

export function exchange(name: string): Exchange {
  return JSON.parse(readFileSync(new URL(`exchanges/${name}.json`, CONTRACT), 'utf8')) as Exchange;
}

export const exchangeNames = (): string[] => readdirSync(new URL('exchanges/', CONTRACT)).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5)).sort();

/** The response a bridge returns for a recorded exchange: every HTTP answer is `ok: true`. */
export function answer(ex: Exchange): ServiceResponse {
  return { ok: true, status: ex.response.status, body: ex.response.body ?? null, replayed: ex.response.headers['X-Replayed'] === '1' };
}

export interface Encoded { method: string; path: string; body: string; requestIdHeader: string | null }

/** A wire call as the fixture Planner's own call record, which keeps a move's anchor as one object. */
function fixtureCall(call: WorkMutationCall): FixtureWriteCall {
  if (call.route !== 'move') return call as FixtureWriteCall;
  const { after_id: _after, before_id: _before, place: _place, ...rest } = call.params;
  return { route: 'move', params: { ...rest, anchor: flatAnchor(call.params) } } as FixtureWriteCall;
}

/** The flat move anchor fields that are present, in body order. */
export function flatAnchor(params: WorkParams['move']): Partial<Record<'after_id' | 'before_id' | 'place', string>> {
  const out: Partial<Record<'after_id' | 'before_id' | 'place', string>> = {};
  for (const key of ['after_id', 'before_id', 'place'] as const) if (params[key] !== undefined) out[key] = params[key];
  return out;
}

/**
 * The reference encoding the main process is expected to apply: one pure function from a typed call to the fixed
 * method, path and exact UTF-8 body. Design owns the canonical encoder; this pins the bytes it must reproduce.
 */
export function encodeWrite(call: WorkMutationCall): Encoded {
  const p = call.params;
  const item = (suffix = '') => `/api/items/${(p as { id: string }).id}${suffix}`;
  const body = (value: unknown) => JSON.stringify(value);
  switch (call.route) {
    case 'create': return { method: 'POST', path: '/api/items', body: body({ fields: call.params.fields }), requestIdHeader: p.requestId };
    case 'patch': return { method: 'PATCH', path: item(), body: body({ revision: call.params.revision, patch: call.params.patch }), requestIdHeader: p.requestId };
    case 'move': return { method: 'POST', path: item('/move'), body: body({ revision: call.params.revision, status: call.params.status, ...flatAnchor(call.params) }), requestIdHeader: p.requestId };
    case 'archive': case 'restore': case 'reviewed':
      return { method: 'POST', path: item(`/${call.route}`), body: body({ revision: call.params.revision }), requestIdHeader: p.requestId };
    case 'settings': return { method: 'PUT', path: '/api/settings', body: body({ settings: call.params.settings }), requestIdHeader: p.requestId };
  }
}

export function encodeCall<R extends WorkRoute>(route: R, params: WorkParams[R]): Encoded {
  switch (route) {
    case 'state': return { method: 'GET', path: '/api/state', body: '', requestIdHeader: null };
    case 'version': return { method: 'GET', path: '/api/version', body: '', requestIdHeader: null };
    case 'item': return { method: 'GET', path: `/api/items/${(params as WorkParams['item']).id}`, body: '', requestIdHeader: null };
    case 'history': return { method: 'GET', path: `/api/items/${(params as WorkParams['history']).id}/history`, body: '', requestIdHeader: null };
    case 'replay': {
      const r = params as WorkParams['replay'];
      const original = encodeWrite(r.original);
      // No X-Request-Id on a replay: the original ID is in the body.
      const envelope = {
        mode: r.mode, request_id: r.requestId, method: original.method, path: original.path,
        body_b64: Buffer.from(original.body, 'utf8').toString('base64'),
        ...(r.sentAfterVersion !== undefined ? { sent_after_version: r.sentAfterVersion } : {}),
      };
      return { method: 'POST', path: '/api/requests/replay', body: JSON.stringify(envelope), requestIdHeader: null };
    }
    default: return encodeWrite({ route, params } as WorkMutationCall);
  }
}

export interface Step {
  /** The recorded exchange this call must reproduce exactly, and whose response it receives. */
  exchange?: Exchange;
  /** Or a route with a synthetic answer, for calls no exchange captured (a lost send). */
  route?: WorkRoute;
  respond?: ServiceResponse;
}

/**
 * A strict transcript: each call must be the next step's route, and its reference encoding must equal the recorded
 * method, path, body bytes and request-ID header. Unexpected or extra calls fail the test.
 */
export function strictTransport(steps: Step[]) {
  const queue = [...steps];
  const calls: { route: WorkRoute; params: unknown; encoded: Encoded }[] = [];
  const transport: PlannerTransport = {
    async call(route, params) {
      const encoded = encodeCall(route, params);
      calls.push({ route, params: structuredClone(params), encoded });
      const step = queue.shift();
      if (!step) throw new Error(`unexpected call ${route} ${encoded.path}`);
      if (step.route) {
        expect(route).toBe(step.route);
        return step.respond!;
      }
      const ex = step.exchange!;
      expect({ method: encoded.method, path: encoded.path, body: encoded.body }).toEqual({ method: ex.request.method, path: ex.request.path, body: ex.request.body_utf8 });
      expect(encoded.requestIdHeader).toBe(ex.request.headers['X-Request-Id'] ?? null);
      return answer(ex);
    },
  };
  return { transport, calls, remaining: () => queue.length };
}

// ------------------------------------------------------------ fixture transport

type Fault =
  /** Delivered and applied; the answer is lost. */
  | 'lose-response'
  /** Never delivered; the transport cannot tell, so it says unknown. */
  | 'drop'
  /** Refused before sending. */
  | 'unavailable'
  /** Applied, then answered with this. */
  | { after: ServiceResponse }
  /** Not delivered; answered with this. */
  | { instead: ServiceResponse };

const ok = (status: number, body: unknown, replayed = false): ServiceResponse => ({ ok: true, status, body, replayed });

function errorResponse(reason: unknown): ServiceResponse {
  if (reason instanceof ReplayIndeterminateError) {
    return ok(409, { error: 'replay_indeterminate', message: 'Read back before attempting another change.', sent_after_version: reason.sentAfterVersion, evicted_through_version: reason.evictedThroughVersion });
  }
  if (!(reason instanceof PlannerPortError)) throw reason;
  const e = reason.error;
  switch (e.kind) {
    case 'invalid': return ok(400, { error: 'invalid', message: 'Some fields are invalid.', errors: e.errors });
    case 'revision_conflict': return ok(409, { error: 'revision_conflict', message: 'This item changed since you loaded it.', current: e.current });
    case 'order_conflict': return ok(409, { error: 'order_conflict', message: 'The board changed since it was loaded. Refresh and try again.' });
    case 'request_id_reused': return ok(422, { error: 'request_id_reused', message: 'This request id was already used for a different change.' });
    case 'not_found': return ok(404, { error: 'not_found', message: 'Not found.' });
    default: throw reason;
  }
}

/** A write result in the service's wire shape: `changed` lists field names, not items. */
function writeBody(route: string, id: string | undefined, result: WriteResult | SettingsWriteResult): unknown {
  if ('settings' in result) return { settings: result.settings, state_version: result.stateVersion };
  if (route === 'create') return { item: result.item, state_version: result.stateVersion };
  const touched = result.changed.some((other) => other.id === id);
  const fields = !touched ? [] : route === 'move' ? ['status', 'position'] : route === 'patch' ? ['fields'] : route === 'reviewed' ? ['reviewed_at'] : ['archived'];
  return { item: result.item, changed: fields, state_version: result.stateVersion };
}

/**
 * The fixture Planner behind the bridge's typed routes, answering in the service's wire shapes, with injectable
 * transport faults per route. It reuses the one fixture store; there is no second store.
 */
export function fixtureTransport(fixture: { port: PlannerPort; control: FixtureControl }) {
  const { port, control } = fixture;
  const faults = new Map<WorkRoute, Fault[]>();
  const calls: { route: WorkRoute; params: unknown }[] = [];

  async function dispatch(call: WorkMutationCall): Promise<WriteResult | SettingsWriteResult> {
    const p = call.params as Record<string, never> & { requestId: string; id: string; revision: number };
    switch (call.route) {
      case 'create': return port.create(p.fields, p.requestId);
      case 'patch': return port.patch(p.id, p.revision, p.patch, p.requestId);
      case 'move': return port.move(p.id, p.revision, p.status, flatAnchor(call.params) as Anchor, p.requestId);
      case 'archive': case 'restore': return port.setArchived(p.id, p.revision, call.route === 'archive', p.requestId);
      case 'reviewed': return port.markReviewed(p.id, p.revision, p.requestId);
      case 'settings': return port.updateSettings(p.settings, p.requestId);
    }
  }

  async function serve(route: WorkRoute, params: unknown): Promise<ServiceResponse> {
    try {
      switch (route) {
        case 'state': {
          const s = await port.snapshot();
          return ok(200, {
            items: s.items, settings: s.settings, state_version: s.stateVersion, server_time: s.observedAt, api: 2, features: s.features,
            request_retention: { max: 2000, evicted_through_version: control.evictedThroughVersion() },
          });
        }
        case 'version': {
          const s = await port.snapshot();
          return ok(200, { state_version: s.stateVersion, api: 2, features: s.features, request_retention: { max: 2000, evicted_through_version: control.evictedThroughVersion() } });
        }
        case 'history': return ok(200, { history: await port.history((params as { id: string }).id) });
        case 'item': {
          const found = (await port.snapshot()).items.find((i) => i.id === (params as { id: string }).id);
          return found ? ok(200, { item: found }) : ok(404, { error: 'not_found', message: 'Not found.' });
        }
        case 'replay': {
          const r = params as WorkParams['replay'];
          const outcome = await control.replay({ mode: r.mode, requestId: r.requestId, original: fixtureCall(r.original), ...(r.sentAfterVersion !== undefined ? { sentAfterVersion: r.sentAfterVersion } : {}) });
          if (outcome.outcome === 'not_applied') return ok(200, { outcome: 'not_applied' });
          const status = r.original.route === 'create' ? 201 : 200;
          return ok(200, { outcome: outcome.outcome, status, response: writeBody(r.original.route, (r.original.params as { id?: string }).id, outcome.response) }, outcome.outcome === 'replayed');
        }
        default: {
          const call = { route, params } as WorkMutationCall;
          const result = await dispatch(call);
          return ok(route === 'create' ? 201 : 200, writeBody(route, (params as { id?: string }).id, result), 'replayed' in result && result.replayed);
        }
      }
    } catch (reason) {
      return errorResponse(reason);
    }
  }

  const transport: PlannerTransport = {
    async call(route, params) {
      calls.push({ route, params: structuredClone(params) });
      const fault = faults.get(route)?.shift();
      if (fault === 'unavailable') return { ok: false, kind: 'unavailable' };
      if (fault === 'drop') return { ok: false, kind: 'unknown' };
      if (fault && typeof fault === 'object' && 'instead' in fault) return fault.instead;
      const response = await serve(route, params);
      if (fault === 'lose-response') return { ok: false, kind: 'unknown' };
      if (fault && typeof fault === 'object') return fault.after;
      return response;
    },
  };

  return {
    transport,
    calls,
    /** Applies `fault` to the next call of `route`. */
    next(route: WorkRoute, fault: Fault) {
      faults.set(route, [...(faults.get(route) ?? []), fault]);
    },
    writes: () => calls.filter((c) => !['state', 'version', 'item', 'history'].includes(c.route)),
  };
}

export async function failure(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (reason) {
    if (reason instanceof PlannerPortError) return reason.error;
    throw reason;
  }
  throw new Error('expected a Planner failure');
}
