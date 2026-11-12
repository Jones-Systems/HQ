import { REPLAY_FEATURE, type PlannerHealth, type PlannerLimit, type UnavailableReason } from '../core/port';
import { HQ_REFERENCES_FEATURE } from '../core/types';
import { isServiceResponse, type PlannerTransport } from './transport';
import { decodeVersion } from './wire';

// One explicit connection check (spec.hq-backend-planner-assessment-20261103, gap G3). It reads only
// `GET /api/version` through the Work transport: it never writes, never replays, and records nothing in an adapter's
// ledger. Why the Planner cannot be used is a typed reason, not a guess from a single status.

/** Advertised by a Planner with `POST /api/items/batch`. HQ's Work views do not use it; agents using the CLI do. */
const BATCH_FEATURE = 'items.batch_create';

/**
 * Probes the Planner behind `transport`. No answer (or a bridge that throws or answers in no recognised shape) is
 * `unreachable`; 403 and 421 are `refused`; 5xx is `server_error`; any other status, or a malformed body, is
 * `incompatible`. Each carries `httpStatus` when a status was received. A valid answer is `ready` when replay and HQ
 * references are both advertised, else `limited`; `limits` names every missing capability HQ or its agents use.
 */
export async function probePlanner(transport: PlannerTransport, now: () => Date = () => new Date()): Promise<PlannerHealth> {
  const down = (reason: UnavailableReason, httpStatus?: number): PlannerHealth =>
    ({ status: 'unavailable', checkedAt: now().toISOString(), reason, ...(httpStatus !== undefined ? { httpStatus } : {}) });
  let answer: unknown;
  try {
    answer = await transport.call('version', {});
  } catch {
    return down('unreachable');
  }
  if (!isServiceResponse(answer) || !answer.ok) return down('unreachable');
  const { status } = answer;
  if (status === 403 || status === 421) return down('refused', status);
  if (status >= 500) return down('server_error', status);
  if (status < 200 || status >= 300) return down('incompatible', status);
  const version = decodeVersion(answer.body);
  if (!version) return down('incompatible', status);
  const limits: PlannerLimit[] = [];
  if (!version.features.includes(REPLAY_FEATURE)) limits.push('no_replay');
  if (!version.features.includes(HQ_REFERENCES_FEATURE)) limits.push('no_hq_references');
  if (!version.features.includes(BATCH_FEATURE)) limits.push('no_batch');
  return {
    status: limits.includes('no_replay') || limits.includes('no_hq_references') ? 'limited' : 'ready',
    checkedAt: now().toISOString(),
    api: version.api,
    stateVersion: version.stateVersion,
    features: version.features,
    limits,
    retention: version.retention,
  };
}
