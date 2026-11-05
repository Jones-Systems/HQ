import { describe, expect, it } from 'vitest';
import {
  WORK_SERVICE_ROUTES,
  type ServiceResponse, type WorkMutationCall, type WorkServiceParams, type WorkServiceTransport,
} from '../transport';

// A synthetic compile-time binding of Work's transport boundary to the shape Design froze in the shared services.ts at
// dccb4987b83ef77ffbd714bd2d58c3801e664fc7. It states the shape independently rather than importing or copying the
// shared file; `npm run typecheck` fails if the local mirror drifts. Identity with the shared file itself, on the
// combined base, remains integration work.

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

describe('canonical Work transport shape', () => {
  it('has the shared route list, in order', () => {
    expect(WORK_SERVICE_ROUTES).toEqual(['state', 'version', 'item', 'history', 'create', 'patch', 'move', 'archive', 'restore', 'reviewed', 'settings', 'replay']);
  });
});
