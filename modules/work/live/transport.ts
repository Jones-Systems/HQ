// The Work slice of the desktop service bridge, as a narrow local structural type (iface.service-bridge.001 and
// spec.hq-agent-cli#iface.work-live-transport.001, with the settled typed replay seam). It mirrors Design's frozen
// shared `services.ts` (`WorkServiceParams`, `WorkMutationCall`, `WorkServiceTransport`, `ServiceResponse`) exactly,
// without importing or copying it, so the adapter does not wait for it; `test/canonical-shape.test.ts` binds the shape.
// Calls carry typed parameters only: no URL, method, header, body bytes, fetch, Node or CLI capability. Fields, patches
// and settings cross as plain records; domain typing and validation stay inside the adapter. The main process owns
// encoding, so it rebuilds the same method, path and body bytes for a normal send and for a replay of it.

export const WORK_READ_ROUTES = ['state', 'version', 'item', 'history'] as const;
export const WORK_WRITE_ROUTES = ['create', 'patch', 'move', 'archive', 'restore', 'reviewed', 'settings'] as const;
export const WORK_SERVICE_ROUTES = [...WORK_READ_ROUTES, ...WORK_WRITE_ROUTES, 'replay'] as const;
export type WorkReadRoute = (typeof WORK_READ_ROUTES)[number];
export type WorkServiceRoute = (typeof WORK_SERVICE_ROUTES)[number];
export type WorkMutationRoute = (typeof WORK_WRITE_ROUTES)[number];
export const WORK_ROUTES: readonly WorkServiceRoute[] = WORK_SERVICE_ROUTES;

export interface WorkServiceParams {
  readonly state: Record<string, never>;
  readonly version: Record<string, never>;
  readonly item: { readonly id: string };
  readonly history: { readonly id: string };
  readonly create: { readonly requestId: string; readonly fields: Readonly<Record<string, unknown>> };
  readonly patch: { readonly requestId: string; readonly id: string; readonly revision: number; readonly patch: Readonly<Record<string, unknown>> };
  /** The anchor is flat: exactly one of `after_id`, `before_id` or `place`. */
  readonly move: {
    readonly requestId: string; readonly id: string; readonly revision: number; readonly status: string;
    readonly after_id?: string; readonly before_id?: string; readonly place?: 'top' | 'bottom';
  };
  readonly archive: { readonly requestId: string; readonly id: string; readonly revision: number };
  readonly restore: WorkServiceParams['archive'];
  readonly reviewed: WorkServiceParams['archive'];
  readonly settings: { readonly requestId: string; readonly settings: Readonly<Record<string, unknown>> };
  /**
   * The closed replay route. `original` is the exact typed call first sent; its `requestId` equals the outer one.
   * `sentAfterVersion` is the state version observed before that first send, never raised afterwards. No
   * X-Request-Id header is sent on a replay.
   */
  readonly replay: { readonly mode: 'lookup' | 'resend'; readonly requestId: string; readonly original: WorkMutationCall; readonly sentAfterVersion?: number };
}

/** One write exactly as first sent: the immutable intent a replay names. */
export type WorkMutationCall = { [R in WorkMutationRoute]: { readonly route: R; readonly params: WorkServiceParams[R] } }[WorkMutationRoute];

/**
 * Every received HTTP response, 4xx and 5xx included, is `ok: true`; `ok` never means success, so branch on
 * `status`. `body` is null when the response is empty; `replayed` reflects `X-Replayed` and is always present. Only a
 * transport failure is `ok: false`: `unavailable` when nothing was sent, `unknown` when a request may have been
 * delivered.
 */
export type ServiceResponse<B = unknown> =
  | { readonly ok: true; readonly status: number; readonly body: B; readonly replayed: boolean }
  | { readonly ok: false; readonly kind: 'unavailable' | 'unknown' };

export interface WorkServiceTransport {
  call<R extends WorkServiceRoute>(route: R, params: WorkServiceParams[R]): Promise<ServiceResponse>;
}

/** Local names kept for Work's existing callers. */
export type WorkRoute = WorkServiceRoute;
export type WorkWriteRoute = WorkMutationRoute;
export type WorkParams = WorkServiceParams;
export type PlannerTransport = WorkServiceTransport;

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
