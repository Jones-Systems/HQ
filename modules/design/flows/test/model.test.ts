import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { deriveEdges } from '../src/edges.ts';
import { parseFlow, validateFlow } from '../src/model.ts';
import { checkout, checkoutRaw, parsed } from './fixtures.ts';

const codes = (raw: Record<string, unknown>) => validateFlow(parsed(raw)).map((issue) => `${issue.code}:${issue.subject.id}`);

describe('parseFlow', () => {
  it('accepts the synthetic fixture and freezes it', () => {
    const flow = checkout();
    assert.equal(flow.screens.length, 5);
    assert.equal(flow.hotspots.length, 9);
    assert.ok(Object.isFrozen(flow) && Object.isFrozen(flow.hotspots[0]!.transition.target));
  });

  it('rejects a future schema as unsupported without inventing a down-conversion', () => {
    const result = parseFlow({ ...checkoutRaw(), schema: 'hq.design.flow/v2' });
    assert.equal(result.ok, false);
    assert.equal(!result.ok && result.unsupportedSchema, true);
  });

  it('rejects unknown keys, malformed rects, non-finite values and bad URLs', () => {
    const raw = checkoutRaw();
    const hotspots = raw.hotspots as Record<string, unknown>[];
    for (const mutate of [
      () => ({ ...raw, extra: 1 }),
      () => ({ ...raw, hotspots: [{ ...hotspots[0]!, rect: { x: 0, y: 0, width: 0, height: 10 } }] }),
      () => ({ ...raw, hotspots: [{ ...hotspots[0]!, rect: { x: Number.NaN, y: 0, width: 1, height: 1 } }] }),
      () => ({ ...raw, hotspots: [{ ...hotspots[0]!, transition: { target: { kind: 'external', url: 'javascript:alert(1)' }, animation: 'push', durationMs: 1 } }] }),
      () => ({ ...raw, platform: 'watch' }),
      () => ({ ...raw, title: ' padded' }),
    ]) assert.equal(parseFlow(mutate()).ok, false);
  });

  it('rejects duplicate identities instead of choosing one', () => {
    const raw = checkoutRaw();
    const hotspots = raw.hotspots as Record<string, unknown>[];
    const result = parseFlow({ ...raw, hotspots: [...hotspots, { ...hotspots[0]! }] });
    assert.equal(result.ok, false);
    assert.match(!result.ok ? result.errors.join() : '', /duplicate hotspot h-checkout/);
  });

  it('keeps broken targets in a parsed document so they can be reported', () => {
    const flow = checkout();
    assert.ok(flow.hotspots.some((hotspot) => hotspot.id === 'h-receipt'));
  });
});

describe('validateFlow', () => {
  it('reports every broken target in the fixture', () => {
    const issues = validateFlow(checkout());
    const broken = issues.filter((issue) => issue.code === 'broken-target').map((issue) => issue.subject.id);
    assert.deepEqual(broken, ['h-receipt', 'h-promo']);
    assert.ok(issues.every((issue) => issue.code !== 'broken-target' || issue.severity === 'error'));
  });

  it('reports each broken edge from the shared derivation exactly once', () => {
    const flow = checkout();
    const brokenEdges = deriveEdges(flow).filter((edge) => edge.resolution.status === 'broken').map((edge) => edge.id);
    const reported = validateFlow(flow).filter((issue) => issue.code === 'broken-target').map((issue) => issue.subject.id);
    assert.deepEqual(reported, brokenEdges);
  });

  it('reports undeclared states, ambiguous routes, orphan hotspots, missing start and geometry warnings', () => {
    const raw = checkoutRaw();
    const screens = raw.screens as Record<string, unknown>[];
    const hotspots = raw.hotspots as Record<string, unknown>[];
    const result = codes({
      ...raw,
      start: 'nope',
      screens: [...screens, { ...screens[2]!, id: 'checkout-copy' }, { ...screens[4]!, id: 'odd', state: 'weird' }],
      hotspots: [...hotspots, { ...hotspots[0]!, id: 'h-orphan', screenId: 'deleted' }, { ...hotspots[0]!, id: 'h-off', rect: { x: 200, y: 800, width: 400, height: 20 } }],
    });
    for (const expected of ['missing-start:flow-checkout', 'undeclared-state:odd', 'duplicate-screen-state:/checkout', 'orphan-hotspot:h-orphan', 'hotspot-outside-screen:h-off', 'overlapping-hotspots:h-checkout']) {
      assert.ok(result.includes(expected), `${expected} in ${result.join(', ')}`);
    }
    // The route target to /checkout is now ambiguous and reported as broken, not resolved to the first match.
    assert.ok(result.includes('broken-target:h-checkout'));
    assert.ok(!result.some((code) => code.startsWith('unreachable-screen')), 'reachability is not judged without a start');
  });

  it('warns about unreachable screens and declared states without screens', () => {
    const raw = checkoutRaw();
    const result = codes({ ...raw, routes: [...(raw.routes as unknown[]), { route: '/settings', states: ['default'] }], hotspots: (raw.hotspots as Record<string, unknown>[]).filter((hotspot) => hotspot.id !== 'h-decline') });
    assert.ok(result.includes('unreachable-screen:checkout-error'));
    assert.ok(result.includes('state-without-screen:/settings'));
  });
});
