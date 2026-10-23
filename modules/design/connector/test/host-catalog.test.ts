import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { HostCatalog } from '../src/host-catalog.ts';
import type { DestinationId } from '../src/ids.ts';
import { createFakeClock, createFakeReceiver, syntheticCatalog, syntheticDestination, syntheticIdentity } from '../src/fakes.ts';
import { NEW_THREAD_REASON, REAL_JONES_NOT_QUALIFIED_REASON, evaluateDestination } from '../src/eligibility.ts';
import { acknowledgeIdentity, findDestination, mergeHostCatalog, parseHostCatalog } from '../src/host-catalog.ts';

const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Record<string, unknown>;

describe('hq.design.host-catalog/v1 parsing', () => {
  it('round-trips the synthetic catalog', () => {
    const catalog = syntheticCatalog();
    const parsed = parseHostCatalog(json(catalog));
    assert.ok(parsed.ok);
    assert.deepEqual(parsed.catalog, catalog);
  });

  it('rejects a future schema version without down-conversion', () => {
    const parsed = parseHostCatalog({ ...json(syntheticCatalog()), schema: 'hq.design.host-catalog/v2' });
    assert.deepEqual(parsed.ok ? null : parsed.error.code, 'unsupported-schema');
  });

  it('rejects unknown fields, duplicates and credential-bearing locators', () => {
    const base = json(syntheticCatalog());
    assert.equal(parseHostCatalog({ ...base, extra: 1 }).ok, false);
    const destinations = base.destinations as Record<string, unknown>[];
    const dup = parseHostCatalog({ ...base, destinations: [destinations[0], destinations[0]] });
    assert.equal(dup.ok ? null : dup.error.code, 'duplicate-destination');
    for (const locator of ['https://user:token@example.invalid/x', 'jones:x?token=1', 'has space']) {
      const bad = parseHostCatalog({ ...base, destinations: [{ ...destinations[0], endpoint: { transport: 'jones-code', locator } }] });
      assert.equal(bad.ok, false, locator);
    }
  });

  it('requires a thread reference for existing-thread destinations', () => {
    const base = json(syntheticCatalog());
    const [first] = base.destinations as Record<string, unknown>[];
    const { threadRef: _unused, ...withoutThread } = first ?? {};
    assert.equal(parseHostCatalog({ ...base, destinations: [withoutThread] }).ok, false);
  });

  it('keeps two destinations with the same label as separate records', () => {
    const catalog: HostCatalog = {
      ...syntheticCatalog(),
      destinations: [
        syntheticDestination({ destinationId: 'dest.a' as DestinationId, label: 'Same name' }),
        syntheticDestination({ destinationId: 'dest.b' as DestinationId, label: 'Same name' }),
      ],
    };
    const parsed = parseHostCatalog(json(catalog));
    assert.ok(parsed.ok);
    assert.equal(parsed.catalog.destinations.length, 2);
  });
});

describe('catalog refresh', () => {
  const generation = (catalog: HostCatalog, value: number, patch: Partial<HostCatalog> = {}): HostCatalog =>
    ({ ...catalog, generation: value, observedAt: `2026-01-0${value}T00:00:00.000Z`, ...patch });

  it('ignores a late (older or equal generation) response', () => {
    const current = generation(syntheticCatalog(), 3);
    const late = generation(syntheticCatalog(), 2, { destinations: [] });
    const merged = mergeHostCatalog(current, late);
    assert.equal(merged.applied, false);
    assert.equal(merged.catalog, current);
  });

  it('holds a changed identity as a conflict and blocks sending until acknowledged', () => {
    const transports = { 'fake-receiver': createFakeReceiver({ identity: syntheticIdentity(), clock: createFakeClock() }) };
    const current = generation(syntheticCatalog(), 1);
    const changed = generation(current, 2, {
      destinations: current.destinations.map((entry) => entry.destinationId === 'dest.fake-existing'
        ? { ...entry, identity: { ...entry.identity, fingerprint: 'fp.rotated' } }
        : entry),
    });
    const merged = mergeHostCatalog(current, changed);
    assert.deepEqual(merged.conflicts, ['dest.fake-existing']);
    const held = findDestination(merged.catalog, 'dest.fake-existing' as DestinationId);
    assert.equal(held?.identity.fingerprint, 'fp.synthetic-0001', 'accepted identity is kept');
    assert.equal(held?.identityConflict?.observed.fingerprint, 'fp.rotated');
    const eligibility = held ? evaluateDestination(held, transports) : null;
    assert.equal(eligibility?.eligible ? null : eligibility?.code, 'identity-conflict');

    // A later matching observation does not silently clear the conflict.
    const again = mergeHostCatalog(merged.catalog, generation(merged.catalog, 3, {
      destinations: merged.catalog.destinations.map(({ identityConflict: _c, ...entry }) => entry),
    }));
    assert.ok(findDestination(again.catalog, 'dest.fake-existing' as DestinationId)?.identityConflict);

    const acknowledged = acknowledgeIdentity(merged.catalog, 'dest.fake-existing' as DestinationId);
    const adopted = findDestination(acknowledged, 'dest.fake-existing' as DestinationId);
    assert.equal(adopted?.identity.fingerprint, 'fp.rotated');
    assert.equal(adopted?.identityConflict, undefined);
  });

  it('a partial refresh keeps omitted entries as stale; a complete one marks them missing', () => {
    const current = generation(syntheticCatalog(), 1);
    const partial = mergeHostCatalog(current, generation(current, 2, { complete: false, destinations: [] }));
    assert.equal(partial.catalog.destinations.length, current.destinations.length);
    assert.ok(partial.catalog.destinations.every((entry) => entry.freshness.status === 'stale'));
    const complete = mergeHostCatalog(current, generation(current, 2, { complete: true, destinations: [] }));
    assert.ok(complete.catalog.destinations.every((entry) => entry.freshness.status === 'missing-at-host'));
  });
});

describe('eligibility is not reachability', () => {
  const transports = { 'fake-receiver': createFakeReceiver({ identity: syntheticIdentity(), clock: createFakeClock() }) };

  it('real Jones is not qualified even when reachable and fresh', () => {
    const jones = findDestination(syntheticCatalog(), 'dest.jones-existing' as DestinationId);
    assert.equal(jones?.status, 'reachable');
    const result = jones ? evaluateDestination(jones, transports) : null;
    assert.deepEqual(result?.eligible ? null : [result?.code, result?.reason], ['transport-not-qualified', REAL_JONES_NOT_QUALIFIED_REASON]);
  });

  it('a transport claiming qualification without evidence does not qualify', () => {
    const jones = findDestination(syntheticCatalog(), 'dest.jones-existing' as DestinationId);
    const fake = transports['fake-receiver'];
    const pretender = { ...fake, descriptor: { ...fake.descriptor, kind: 'jones-code' as const, provenance: 'jones' as const, qualification: { level: 'qualified' as const, evidenceRef: ' ' } } };
    const result = jones ? evaluateDestination(jones, { 'jones-code': pretender }) : null;
    assert.equal(result?.eligible, false);
    const fakeAsJones = { ...fake, descriptor: { ...fake.descriptor, kind: 'jones-code' as const } };
    assert.equal(jones ? evaluateDestination(jones, { 'jones-code': fakeAsJones }).eligible : null, false, 'a fake cannot stand in for Jones');
  });

  it('new-thread destinations are disabled with the U1 reason', () => {
    const next = findDestination(syntheticCatalog(), 'dest.jones-new' as DestinationId);
    const result = next ? evaluateDestination(next, transports) : null;
    assert.deepEqual(result?.eligible ? null : [result?.code, result?.reason], ['new-thread-unavailable', NEW_THREAD_REASON]);
  });

  it('only the fresh, reachable labelled fake is eligible in the synthetic catalog', () => {
    const eligible = syntheticCatalog().destinations.filter((entry) => evaluateDestination(entry, transports).eligible);
    assert.deepEqual(eligible.map((entry) => entry.destinationId), ['dest.fake-existing']);
  });
});
