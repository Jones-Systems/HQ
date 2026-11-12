import { expect, it } from 'vitest';
import { WIKI_STATE_LABELS, plannerHealthStatus, serviceStatus, wikiStatus, worstSource } from './data-source-status';
it('distinguishes sample configuration, saved configuration and policy', () => {
  expect(serviceStatus({ configured: false, policy: 'ok', transport: null }).text).toBe('Sample data · not set up');
  expect(serviceStatus({ configured: true, policy: 'ok', transport: 'https' }).text).toBe('Set up · not checked');
  expect(serviceStatus({ configured: false, policy: 'rejected', transport: null }).text).toBe('Address rejected');
  expect(serviceStatus(undefined).text).toBe('Unavailable');
  expect(serviceStatus({ configured: true, policy: 'ok', transport: null }).text).toBe('Unavailable');
  expect(serviceStatus({ configured: false, policy: 'ok', transport: null }).indicator).toBe('info');
  expect(serviceStatus({ configured: false, policy: 'rejected', transport: null }).indicator).toBe('warning');
});
it('Wiki index states do not imply service or host connectivity and compact summary retains failure', () => {
  expect(wikiStatus([]).text).toBe('Not set up');
  expect(wikiStatus(['not-configured']).text).toBe('Not set up');
  expect(wikiStatus(['ready', 'not-configured']).text).toBe('Index ready');
  expect(wikiStatus(['ready', 'stale']).text).toBe('Index stale');
  expect(wikiStatus(undefined).text).toBe('Index unavailable');
  expect(worstSource({ social: { text: 'Reachable', tone: 'good' }, work: { text: 'Unreachable', tone: 'bad' }, wiki: wikiStatus(['ready']) }).text).toBe('Unreachable');
  expect(wikiStatus(['ready']).text).toBe(WIKI_STATE_LABELS.ready);
  expect(WIKI_STATE_LABELS['source-unavailable']).toBe('Source unavailable');
});

it('explains Planner refusals, incompatibility and missing capabilities without granting retries', () => {
  const checkedAt = '2026-11-12T12:00:00.000Z';
  for (const [reason, text] of [
    ['refused', 'Refused · start the Planner with --allowed-host for this address'],
    ['server_error', 'Planner error'], ['incompatible', 'Not a compatible Planner'], ['unreachable', 'Unreachable'],
  ] as const) expect(plannerHealthStatus({ status: 'unavailable', checkedAt, reason })).toMatchObject({ text, tone: 'bad' });
  const health = { checkedAt, api: 2, stateVersion: 7, features: [], retention: null };
  expect(plannerHealthStatus({ ...health, status: 'ready', limits: [] }).text).toBe('Reachable · Planner API 2');
  expect(plannerHealthStatus({ ...health, status: 'limited', limits: ['no_replay', 'no_hq_references', 'no_batch'] }).text).toBe('Reachable · limited (no replay, no HQ links, no batch create)');
});
