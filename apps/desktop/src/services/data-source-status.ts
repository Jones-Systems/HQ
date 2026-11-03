import type { ServiceConfigStatus } from '@hq/contracts/services';
import type { PlannerHealth, PlannerLimit } from '../../../../modules/work/core/port';
export type DataSource = 'social' | 'work' | 'wiki';
export type SourceStatus = { readonly text: string; readonly tone: 'neutral' | 'good' | 'bad' };
export const SOURCE_NAMES: Record<DataSource, string> = { social: 'Social', work: 'Work', wiki: 'Local Wiki' };
export const UNAVAILABLE: SourceStatus = { text: 'Unavailable', tone: 'bad' };
export const CHECKING: SourceStatus = { text: 'Checking…', tone: 'neutral' };
export function serviceStatus(status: ServiceConfigStatus | null | undefined): SourceStatus {
  if (!status || typeof status.configured !== 'boolean') return UNAVAILABLE;
  if (status.policy === 'rejected') return { text: 'Address rejected', tone: 'bad' };
  if (status.policy !== 'ok') return UNAVAILABLE;
  if (!status.configured) return status.transport === null ? { text: 'Sample data · not set up', tone: 'neutral' } : UNAVAILABLE;
  return status.transport === 'https' || status.transport === 'loopback-http' ? { text: 'Set up · not checked', tone: 'neutral' } : UNAVAILABLE;
}
export function checkedServiceStatus(reachable: boolean): SourceStatus {
  return reachable ? { text: 'Reachable', tone: 'good' } : { text: 'Unreachable', tone: 'bad' };
}
const LIMIT_WORDS: Record<PlannerLimit, string> = { no_replay: 'no replay', no_hq_references: 'no HQ links', no_batch: 'no batch create' };
/** Work's connection check: why the Planner is or is not usable, in plain words. */
export function plannerHealthStatus(health: PlannerHealth): SourceStatus {
  if (health.status === 'ready') return { text: health.api === null ? 'Reachable' : `Reachable · Planner API ${health.api}`, tone: 'good' };
  if (health.status === 'limited') return { text: health.limits.length ? `Reachable · limited (${health.limits.map(limit => LIMIT_WORDS[limit]).join(', ')})` : 'Reachable · limited', tone: 'neutral' };
  switch (health.reason) {
    case 'refused': return { text: 'Refused · start the Planner with --allowed-host for this address', tone: 'bad' };
    case 'server_error': return { text: 'Planner error', tone: 'bad' };
    case 'incompatible': return { text: 'Not a compatible Planner', tone: 'bad' };
    default: return { text: 'Unreachable', tone: 'bad' };
  }
}
export function wikiStatus(states: readonly string[] | undefined): SourceStatus {
  if (!states) return { text: 'Index unavailable', tone: 'bad' };
  const configured = states.filter(state => state !== 'not-configured');
  if (!configured.length) return { text: 'Not set up', tone: 'neutral' };
  if (configured.every(state => state === 'ready')) return { text: 'Index ready', tone: 'good' };
  if (configured.includes('indexing')) return { text: 'Indexing', tone: 'neutral' };
  if (configured.includes('stale')) return { text: 'Index stale', tone: 'bad' };
  return { text: 'Index unavailable', tone: 'bad' };
}
export function worstSource(statuses: Readonly<Record<DataSource, SourceStatus>>): SourceStatus {
  const values = Object.values(statuses);
  return values.find(status => status.tone === 'bad') ?? values.find(status => status.tone === 'neutral') ?? values[0]!;
}
