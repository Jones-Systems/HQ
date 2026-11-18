import assert from 'node:assert/strict';
import { test } from 'node:test';
import { discoveryEnv } from '../fake-workspace.ts';
import { createBridgedDiscovery } from '../bridged-discovery.ts';

test('example Discovery enrolls only labelled synthetic sources and opening never refreshes', async () => {
  const env = await discoveryEnv();
  await env.service.open();
  assert.equal(env.tag.status, 'synthetic');
  assert.equal(env.cache.writes, 0);
  assert.equal(env.service.getState().refreshing.length, 0);
  assert.ok(env.service.getState().enrollments.length > 0);
  for (const entry of env.service.getState().enrollments) {
    assert.equal(entry.adapterKey, 'fake');
    assert.match(entry.label, /synthetic/i);
    assert.equal(env.adapterLabels[entry.adapterKey]?.fake, true);
    assert.match(env.adapterLabels[entry.adapterKey]!.label, /fake/i);
  }
});
test('missing or failed native Discovery transport rejects rather than selecting the example adapter', async () => {
  await assert.rejects(createBridgedDiscovery(undefined), /desktop catalog connection/);
  const transport = { call: async () => ({ ok: false, kind: 'unavailable' }) } as unknown as import('@hq/contracts/services').DesignServiceTransport;
  await assert.rejects(createBridgedDiscovery(transport), /Project catalog: unavailable/);
});
