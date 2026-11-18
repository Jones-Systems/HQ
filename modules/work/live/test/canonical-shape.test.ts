import { describe, expect, it } from 'vitest';
import {
  WORK_SERVICE_ROUTES,
  type ServiceResponse, type WorkLocalJson, type WorkLocalParams, type WorkLocalResult, type WorkLocalRoute,
  type WorkLocalTransport, type WorkLocalValues, type WorkMutationCall, type WorkServiceParams, type WorkServiceTransport,
} from '../transport';
import { WORK_LOCAL_ROUTES as SHARED_WORK_LOCAL_ROUTES } from '@hq/contracts/services';
import type * as Shared from '@hq/contracts/services';

// A synthetic compile-time binding of Work's transport boundary to the shape Design froze in the shared services.ts at
// dccb4987b83ef77ffbd714bd2d58c3801e664fc7. It states the shape independently rather than importing or copying the
// shared file; `npm run typecheck` fails if the local mirror drifts. The Work-local assertions below also bind
// the device-document mirror directly to the shared types.

type Equal<X, Y> = (<T>() => T extends X ? 1 : 2) extends (<T>() => T extends Y ? 1 : 2) ? true : false;
type Assert<T extends true> = T;
type Plain = Readonly<Record<string, unknown>>;
type Guarded = { readonly requestId: string; readonly id: string; readonly revision: number };

export type Bound = [
  Assert<Equal<WorkServiceParams['state'], Record<string, never>>>,
  Assert<Equal<WorkServiceParams['version'], Record<string, never>>>,
  Assert<Equal<WorkServiceParams['item'], { readonly id: string }>>,
  Assert<Equal<WorkServiceParams['history'], { readonly id: string }>>,
  Assert<Equal<WorkServiceParams['create'], { readonly requestId: string; readonly fields: Plain }>>,
  Assert<Equal<WorkServiceParams['patch'], { readonly requestId: string; readonly id: string; readonly revision: number; readonly patch: Plain }>>,
  // The move anchor is flat: no nested `anchor` object.
  Assert<Equal<WorkServiceParams['move'], {
    readonly requestId: string; readonly id: string; readonly revision: number; readonly status: string;
    readonly after_id?: string; readonly before_id?: string; readonly place?: 'top' | 'bottom';
  }>>,
  Assert<Equal<WorkServiceParams['archive'], Guarded>>,
  Assert<Equal<WorkServiceParams['restore'], Guarded>>,
  Assert<Equal<WorkServiceParams['reviewed'], Guarded>>,
  Assert<Equal<WorkServiceParams['settings'], { readonly requestId: string; readonly settings: Plain }>>,
  Assert<Equal<WorkServiceParams['replay'], {
    readonly mode: 'lookup' | 'resend'; readonly requestId: string; readonly original: WorkMutationCall; readonly sentAfterVersion?: number;
  }>>,
  Assert<Equal<Extract<WorkMutationCall, { route: 'move' }>, { readonly route: 'move'; readonly params: WorkServiceParams['move'] }>>,
  Assert<Equal<WorkMutationCall['route'], 'create' | 'patch' | 'move' | 'archive' | 'restore' | 'reviewed' | 'settings'>>,
  // `replayed` is required on every received response.
  Assert<Equal<ServiceResponse, (
    | { readonly ok: true; readonly status: number; readonly body: unknown; readonly replayed: boolean }
    | { readonly ok: false; readonly kind: 'unavailable' | 'unknown' }
  )>>,
  Assert<Equal<Parameters<WorkServiceTransport['call']>, [route: (typeof WORK_SERVICE_ROUTES)[number], params: WorkServiceParams[(typeof WORK_SERVICE_ROUTES)[number]]]>>,
];

// The device-document mirror, stated independently and then held identical to the shared `services.ts` now that both
// sit on one base. A test may import the shared file; Work production code may not (ac.work-domain.001).
type Json = null | boolean | number | string | readonly Json[] | { readonly [key: string]: Json };
type Refusal = 'conflict' | 'invalid' | 'too_large' | 'unavailable';

export type BoundLocal = [
  Assert<Equal<WorkLocalRoute, 'load' | 'save'>>,
  Assert<Equal<WorkLocalParams['load'], Record<string, never>>>,
  Assert<Equal<WorkLocalParams['save'], { readonly binding: string; readonly expectedRevision: number; readonly value: Json }>>,
  Assert<Equal<WorkLocalValues['load'], { readonly binding: string; readonly revision: number; readonly value: Json | null }>>,
  Assert<Equal<WorkLocalValues['save'], { readonly revision: number }>>,
  Assert<Equal<WorkLocalResult<number>, { readonly ok: true; readonly value: number } | { readonly ok: false; readonly kind: Refusal }>>,
  Assert<Equal<Parameters<WorkLocalTransport['call']>, [route: WorkLocalRoute, params: WorkLocalParams[WorkLocalRoute]]>>,
  Assert<Equal<WorkLocalJson, Shared.JsonValue>>,
  Assert<Equal<WorkLocalRoute, Shared.WorkLocalRoute>>,
  Assert<Equal<WorkLocalParams, Shared.WorkLocalParams>>,
  Assert<Equal<WorkLocalValues, Shared.WorkLocalValues>>,
  Assert<Equal<WorkLocalResult<unknown>, Shared.WorkLocalResult<unknown>>>,
  Assert<Equal<WorkLocalTransport, Shared.WorkLocalTransport>>,
];

describe('canonical Work local shape', () => {
  it('has the shared route list', () => {
    const routes: readonly WorkLocalRoute[] = SHARED_WORK_LOCAL_ROUTES;
    expect(routes).toEqual(['load', 'save']);
  });
});

describe('canonical Work transport shape', () => {
  it('has the shared route list, in order', () => {
    expect(WORK_SERVICE_ROUTES).toEqual(['state', 'version', 'item', 'history', 'create', 'patch', 'move', 'archive', 'restore', 'reviewed', 'settings', 'replay']);
  });
});
