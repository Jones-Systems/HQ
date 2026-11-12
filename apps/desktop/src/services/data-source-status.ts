import type { PlannerHealth, PlannerLimit } from '../../../../modules/work/core/port';
import type { ServiceConfigStatus } from '@hq/contracts/services';
import type { StatusTone } from '@hq/ui';
export type DataSource = 'social' | 'work' | 'wiki';
/**
 * What one data source shows. `text` is the words every surface uses; `tone` is the coarse shape for the Sources
 * popover and Settings; `indicator` is the finer `StatusIndicator` tone the domain strip uses.
 */
export type SourceStatus = { readonly text: string; readonly tone: 'neutral' | 'good' | 'bad'; readonly indicator?: StatusTone };
export const SOURCE_NAMES: Record<DataSource, string> = { social: 'Social', work: 'Work', wiki: 'Local Wiki' };
export const UNAVAILABLE: SourceStatus = { text: 'Unavailable', tone: 'bad', indicator: 'unavailable' };
export const CHECKING: SourceStatus = { text: 'Checking…', tone: 'neutral', indicator: 'neutral' };
/** A valid saved address. Only real traffic or an explicit check says more; see `describe` in `observed-status.ts`. */
export const NOT_CHECKED: SourceStatus = { text: 'Set up · not checked', tone: 'neutral', indicator: 'neutral' };
export function serviceStatus(status: ServiceConfigStatus | null | undefined): SourceStatus {
  if (!status || typeof status.configured !== 'boolean') return UNAVAILABLE;
  if (status.policy === 'rejected') return { text: 'Address rejected', tone: 'bad', indicator: 'warning' };
  if (status.policy !== 'ok') return UNAVAILABLE;
  if (!status.configured) return status.transport === null ? { text: 'Sample data · not set up', tone: 'neutral', indicator: 'info' } : UNAVAILABLE;
  return status.transport === 'https' || status.transport === 'loopback-http' ? NOT_CHECKED : UNAVAILABLE;
}
/** Per-namespace Wiki index wording, shared by the summary below and Settings › Local Wiki. */
export const WIKI_STATE_LABELS: Readonly<Record<string, string>> = {
  ready: 'Index ready', stale: 'Index stale', indexing: 'Indexing', 'index-unavailable': 'Index unavailable',
  'source-unavailable': 'Source unavailable', 'not-configured': 'Not set up',
};
export const WIKI_NOT_CHECKED: SourceStatus = { text: 'Index not checked', tone: 'neutral', indicator: 'neutral' };
export function wikiStatus(states: readonly string[] | undefined): SourceStatus {
  const unavailable: SourceStatus = { text: WIKI_STATE_LABELS['index-unavailable']!, tone: 'bad', indicator: 'unavailable' };
  if (!states) return unavailable;
  const configured = states.filter(state => state !== 'not-configured');
  if (!configured.length) return { text: WIKI_STATE_LABELS['not-configured']!, tone: 'neutral', indicator: 'info' };
  if (configured.every(state => state === 'ready')) return { text: WIKI_STATE_LABELS.ready!, tone: 'good', indicator: 'success' };
  if (configured.includes('indexing')) return { text: WIKI_STATE_LABELS.indexing!, tone: 'neutral', indicator: 'neutral' };
  if (configured.includes('stale')) return { text: WIKI_STATE_LABELS.stale!, tone: 'bad', indicator: 'warning' };
  return unavailable;
}
export function worstSource(statuses: Readonly<Record<DataSource, SourceStatus>>): SourceStatus {
  const values = Object.values(statuses);
  return values.find(status => status.tone === 'bad') ?? values.find(status => status.tone === 'neutral') ?? values[0]!;
}

const LIMIT_WORDS: Record<PlannerLimit, string> = { no_replay: 'no replay', no_hq_references: 'no HQ links', no_batch: 'no batch create' };
/** Wording for the explicit, read-only Planner connection check. */
export function plannerHealthStatus(health: PlannerHealth): SourceStatus {
  if (health.status !== 'unavailable') {
    if (health.status === 'ready') return { text: health.api === null ? 'Reachable' : `Reachable · Planner API ${health.api}`, tone: 'good', indicator: 'success' };
    return { text: health.limits.length ? `Reachable · limited (${health.limits.map(limit => LIMIT_WORDS[limit]).join(', ')})` : 'Reachable · limited', tone: 'neutral', indicator: 'warning' };
  }
  switch (health.reason) {
    case 'refused': return { text: 'Refused · start the Planner with --allowed-host for this address', tone: 'bad', indicator: 'warning' };
    case 'server_error': return { text: 'Planner error', tone: 'bad', indicator: 'danger' };
    case 'incompatible': return { text: 'Not a compatible Planner', tone: 'bad', indicator: 'warning' };
    default: return { text: 'Unreachable', tone: 'bad', indicator: 'danger' };
  }
}
