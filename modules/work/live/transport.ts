import type { Anchor } from '../core/port';
import type { ItemPatch, NewItemFields, Settings, Status } from '../core/types';

// The Work slice of the desktop service bridge, as a narrow local structural type (iface.service-bridge.001 and
// spec.hq-agent-cli#iface.work-live-transport.001, with the settled typed replay seam). Design owns the canonical shared
// contract; this mirrors it so the adapter does not wait for it. Calls carry typed parameters only: no URL, method,
// header, body bytes, fetch, Node or CLI capability. The main process owns encoding, so it rebuilds the same method,
// path and body bytes for a normal send and for a replay of it.

export const WORK_READ_ROUTES = ['state', 'version', 'item', 'history'] as const;
export const WORK_WRITE_ROUTES = ['create', 'patch', 'move', 'archive', 'restore', 'reviewed', 'settings'] as const;
export type WorkReadRoute = (typeof WORK_READ_ROUTES)[number];
export type WorkWriteRoute = (typeof WORK_WRITE_ROUTES)[number];
export type WorkRoute = WorkReadRoute | WorkWriteRoute | 'replay';
export const WORK_ROUTES: readonly WorkRoute[] = [...WORK_READ_ROUTES, ...WORK_WRITE_ROUTES, 'replay'];

interface Guarded { id: string; requestId: string; revision: number }

export interface WorkParams {
  state: Record<string, never>;
  version: Record<string, never>;
  item: { id: string };
  history: { id: string };
  create: { requestId: string; fields: NewItemFields };
  patch: Guarded & { patch: ItemPatch };
  move: Guarded & { status: Status; anchor: Anchor };
  archive: Guarded;
  restore: Guarded;
  reviewed: Guarded;
  settings: { requestId: string; settings: Partial<Settings> };
  /**
   * The closed replay route. `original` is the exact typed call first sent; its `requestId` equals the outer one.
   * `sentAfterVersion` is the state version observed before that first send, never raised afterwards. No
   * X-Request-Id header is sent on a replay.
   */
  replay: { mode: 'lookup' | 'resend'; requestId: string; original: WorkMutationCall; sentAfterVersion?: number };
}

/** One write exactly as first sent: the immutable intent a replay names. */
export type WorkMutationCall = { [R in WorkWriteRoute]: { route: R; params: WorkParams[R] } }[WorkWriteRoute];

/**
 * Every received HTTP response, 4xx and 5xx included, is `ok: true`; `ok` never means success, so branch on
 * `status`. `body` is null when the response is empty; `replayed` reflects `X-Replayed`. Only a transport failure is
 * `ok: false`: `unavailable` when nothing was sent, `unknown` when a request may have been delivered.
 */
export type ServiceResponse =
  | { ok: true; status: number; body: unknown; replayed: boolean }
  | { ok: false; kind: 'unavailable' | 'unknown' };

export interface PlannerTransport {
  call<R extends WorkRoute>(route: R, params: WorkParams[R]): Promise<ServiceResponse>;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Fail-closed check of a bridge answer. Anything else is treated as a malformed result. */
export function isServiceResponse(value: unknown): value is ServiceResponse {
  if (!isRecord(value)) return false;
  if (value.ok === true) {
    return Number.isInteger(value.status) && (value.status as number) >= 100 && (value.status as number) <= 599
      && 'body' in value && typeof value.replayed === 'boolean';
  }
  return value.ok === false && (value.kind === 'unavailable' || value.kind === 'unknown');
}

/** The Planner's X-Request-Id shape, enforced again by main. */
export const REQUEST_ID_PATTERN = /^[A-Za-z0-9-]{8,64}$/u;
/** Item IDs main accepts in a route parameter. */
export const ENTITY_ID_PATTERN = /^[A-Za-z0-9_-]{6,40}$/u;

/** The bridge the preload exposes, read structurally so Work needs no shell type. */
export interface WorkBridge { call(route: string, params: unknown): Promise<unknown> }

export function isWorkBridge(value: unknown): value is WorkBridge {
  return isRecord(value) && typeof value.call === 'function';
}

/** Wraps a bridge so every answer is shape-checked before the adapter sees it; a malformed or thrown answer is `unknown`. */
export function bridgeTransport(bridge: WorkBridge): PlannerTransport {
  return {
    async call(route, params) {
      try {
        const answer = await bridge.call(route, params);
        return isServiceResponse(answer) ? answer : { ok: false, kind: 'unknown' };
      } catch {
        return { ok: false, kind: 'unknown' };
      }
    },
  };
}
