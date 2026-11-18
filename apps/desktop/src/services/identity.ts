import type * as C from '@hq/contracts/services';
import type * as S from '../../../../modules/social/live/transport';
import type * as W from '../../../../modules/work/live/transport';
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
type Assert<T extends true> = T;
export type TransportIdentity = [
  Assert<Equal<C.SocialServiceRoute, S.SocialServiceRoute>>,
  Assert<Equal<C.SocialServiceParams, S.SocialServiceParams>>,
  Assert<Equal<C.ServiceResponse, S.ServiceResponse>>,
  Assert<C.SocialServiceTransport extends S.SocialServiceTransport ? true : false>,
  Assert<C.WorkServiceTransport extends W.WorkServiceTransport ? true : false>,
  Assert<NonNullable<C.HqServices['social']> extends S.SocialServiceTransport ? true : false>,
  Assert<Equal<Exclude<C.WorkServiceRoute, 'export'>, W.WorkServiceRoute>>,
  Assert<Equal<C.WorkMutationRoute, W.WorkMutationRoute>>,
  Assert<Equal<Omit<C.WorkServiceParams, 'export'>, W.WorkServiceParams>>,
  Assert<Equal<C.ServiceResponse, W.ServiceResponse>>,
];
