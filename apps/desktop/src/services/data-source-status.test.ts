import { expect, it } from 'vitest';
import { checkedServiceStatus, serviceStatus, wikiStatus, worstSource } from './data-source-status';
it('distinguishes sample configuration, saved configuration, policy and observed reachability', () => {
  expect(serviceStatus({ configured: false, policy: 'ok', transport: null }).text).toBe('Sample data · not set up');
  expect(serviceStatus({ configured: true, policy: 'ok', transport: 'https' }).text).toBe('Set up · not checked');
  expect(serviceStatus({ configured: false, policy: 'rejected', transport: null }).text).toBe('Address rejected');
  expect(serviceStatus(undefined).text).toBe('Unavailable');
  expect(serviceStatus({ configured: true, policy: 'ok', transport: null }).text).toBe('Unavailable');
  expect(checkedServiceStatus(true)).toEqual({ text: 'Reachable', tone: 'good' });
  expect(checkedServiceStatus(false)).toEqual({ text: 'Unreachable', tone: 'bad' });
});
it('Wiki index states do not imply service or host connectivity and compact summary retains failure', () => {
  expect(wikiStatus([]).text).toBe('Not set up');
  expect(wikiStatus(['not-configured']).text).toBe('Not set up');
  expect(wikiStatus(['ready', 'not-configured']).text).toBe('Index ready');
  expect(wikiStatus(['ready', 'stale']).text).toBe('Index stale');
  expect(wikiStatus(undefined).text).toBe('Index unavailable');
  expect(worstSource({ social: checkedServiceStatus(true), work: checkedServiceStatus(false), wiki: wikiStatus(['ready']) }).text).toBe('Unreachable');
});
