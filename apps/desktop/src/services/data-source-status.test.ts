import { expect, it } from 'vitest';
import { WIKI_STATE_LABELS, serviceStatus, wikiStatus, worstSource } from './data-source-status';
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
