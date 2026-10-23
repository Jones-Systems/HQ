import type { ServiceConfigStatus } from '@hq/contracts/services';
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
