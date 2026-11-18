import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hostId, isoFromMs, type IsoTime } from '../src/contract.ts';
import { EMPTY_CATALOG, parseSnapshot, reduceCatalog, type CatalogState } from '../src/catalog.ts';
import { FAKE_HOSTS, fixtureEntry, fixtureSnapshot } from '../src/fakes.ts';

const A = FAKE_HOSTS.laptop;
const B = FAKE_HOSTS.studio;
const at = (minute: number): IsoTime => isoFromMs(Date.UTC(2026, 9, 20, 12, minute));

async function applied(state: CatalogState, snapshot: Awaited<ReturnType<typeof fixtureSnapshot>>, minute: number, expectedFingerprint?: string) {
  const parsed = await parseSnapshot(structuredClone(snapshot), snapshot.hostId);
  assert.ok(parsed.ok, parsed.ok ? '' : parsed.reason);
  return reduceCatalog(state, { type: 'snapshot', snapshot: parsed.snapshot, at: at(minute), ...(expectedFingerprint !== undefined ? { expectedFingerprint } : {}) });
}

test('identical titles and remotes on different hosts or paths stay separate records', async () => {
  const repo = { normalizedRemote: 'github.com/example/site', localOnly: false };
  let state = EMPTY_CATALOG;
  state = (await applied(state, await fixtureSnapshot(A, 1, [{ path: 'site', name: 'Marketing site', repo }, { path: 'copy/site', name: 'Marketing site', repo }]), 0)).state;
  state = (await applied(state, await fixtureSnapshot(B, 1, [{ path: 'site', name: 'Marketing site', repo }]), 0)).state;
  const records = Object.values(state.records);
  assert.equal(records.length, 3);
  assert.equal(new Set(records.map((record) => record.entry.sourceProjectId)).size, 3);
  assert.deepEqual(records.map((record) => record.entry.hostId).sort(), [A, A, B].sort());
});

test('partial source failure preserves cached records with freshness and a per-source error', async () => {
  let state = (await applied(EMPTY_CATALOG, await fixtureSnapshot(A, 1, [{ path: 'one', name: 'One' }]), 0)).state;
  state = (await applied(state, await fixtureSnapshot(B, 1, [{ path: 'two', name: 'Two' }]), 0)).state;
  state = reduceCatalog(state, { type: 'failure', hostId: B, kind: 'offline', message: 'unreachable\nnow', at: at(5) }).state;
  const recordB = Object.values(state.records).find((record) => record.entry.hostId === B)!;
  const recordA = Object.values(state.records).find((record) => record.entry.hostId === A)!;
  assert.equal(recordB.entry.displayName, 'Two');
  assert.equal(recordB.freshness.status, 'offline');
  assert.equal(recordB.freshness.lastSuccessAt, at(0));
  assert.equal(recordA.freshness.status, 'fresh');
  assert.equal(state.sources[B]!.status, 'offline');
  assert.equal(state.sources[B]!.error!.message, 'unreachable now');
  assert.equal(state.sources[A]!.error, null);
});

test('a partial snapshot never removes or marks entries missing; only a newer complete one does', async () => {
  let state = (await applied(EMPTY_CATALOG, await fixtureSnapshot(A, 1, [{ path: 'one', name: 'One' }, { path: 'two', name: 'Two' }]), 0)).state;
  state = (await applied(state, await fixtureSnapshot(A, 2, [{ path: 'one', name: 'One' }], { complete: false }), 1)).state;
  const status = (name: string) => Object.values(state.records).find((record) => record.entry.displayName === name)!.freshness.status;
  assert.equal(Object.keys(state.records).length, 2);
  assert.equal(status('Two'), 'partial');
  assert.equal(state.sources[A]!.status, 'partial');
  state = (await applied(state, await fixtureSnapshot(A, 3, [{ path: 'one', name: 'One' }]), 2)).state;
  assert.equal(Object.keys(state.records).length, 2, 'missing entries are kept');
  assert.equal(status('Two'), 'missing-at-source');
  // A workspace link to "Two" would survive because the record still exists; it returns to fresh when seen again.
  state = (await applied(state, await fixtureSnapshot(A, 4, [{ path: 'one', name: 'One' }, { path: 'two', name: 'Two' }]), 3)).state;
  assert.equal(status('Two'), 'fresh');
});

test('older or repeated generations are ignored', async () => {
  let state = (await applied(EMPTY_CATALOG, await fixtureSnapshot(A, 5, [{ path: 'one', name: 'New title' }]), 0)).state;
  const late = await applied(state, await fixtureSnapshot(A, 4, [{ path: 'one', name: 'Old title' }]), 1);
  assert.equal(late.outcome, 'ignored-stale-generation');
  assert.equal(late.state, state);
  state = late.state;
  assert.equal(Object.values(state.records)[0]!.entry.displayName, 'New title');
});

test('a changed host fingerprint is held as a conflict and the snapshot is not applied', async () => {
  let state = (await applied(EMPTY_CATALOG, await fixtureSnapshot(A, 1, [{ path: 'one', name: 'One' }], { fingerprint: 'fp-1' }), 0, 'fp-1')).state;
  const held = await applied(state, await fixtureSnapshot(A, 2, [{ path: 'other', name: 'Impostor' }], { fingerprint: 'fp-2' }), 1, 'fp-1');
  assert.equal(held.outcome, 'held-conflict');
  state = held.state;
  assert.deepEqual(Object.values(state.records).map((record) => record.entry.displayName), ['One']);
  assert.equal(state.sources[A]!.conflict!.observedFingerprint, 'fp-2');
  assert.equal(state.sources[A]!.error!.kind, 'identity-conflict');
  // Still held until explicitly resolved, even if a matching fingerprint shows up.
  assert.equal((await applied(state, await fixtureSnapshot(A, 3, [{ path: 'one', name: 'One' }], { fingerprint: 'fp-1' }), 2, 'fp-1')).outcome, 'held-conflict');
  state = reduceCatalog(state, { type: 'conflict-resolved', hostId: A }).state;
  assert.equal((await applied(state, await fixtureSnapshot(A, 3, [{ path: 'one', name: 'One' }], { fingerprint: 'fp-2' }), 2, 'fp-2')).outcome, 'applied');
});

test('a snapshot cannot claim an identity already owned by another host', async () => {
  const state = (await applied(EMPTY_CATALOG, await fixtureSnapshot(A, 1, [{ path: 'one', name: 'One' }]), 0)).state;
  const stolen = { ...(await fixtureEntry(A, { path: 'one', name: 'One' })), hostId: B, rootId: undefined };
  delete (stolen as { rootId?: unknown }).rootId;
  const parsed = await parseSnapshot({ hostId: B, generation: 1, complete: true, observedAt: at(1), entries: [stolen] }, B);
  assert.ok(parsed.ok);
  const result = reduceCatalog(state, { type: 'snapshot', snapshot: parsed.snapshot, at: at(1) });
  assert.equal(result.outcome, 'rejected-collision');
  assert.equal(result.state, state);
});

test('snapshot validation rejects mismatched hosts, duplicates, bad derivations and unexpected fields', async () => {
  const good = await fixtureSnapshot(A, 1, [{ path: 'one', name: 'One' }]);
  assert.equal((await parseSnapshot(good, B)).ok, false, 'host differs from request');
  const entry = good.entries[0]!;
  assert.equal((await parseSnapshot({ ...good, entries: [entry, entry] }, A)).ok, false, 'duplicate id');
  assert.equal((await parseSnapshot({ ...good, entries: [{ ...entry, relativePath: 'other' }] }, A)).ok, false, 'derivation mismatch');
  assert.equal((await parseSnapshot({ ...good, entries: [{ ...entry, hostId: B }] }, A)).ok, false, 'entry host mismatch');
  assert.equal((await parseSnapshot({ ...good, execute: 'rm -rf' }, A)).ok, false, 'unexpected field');
  assert.equal((await parseSnapshot({ ...good, generation: -1 }, A)).ok, false);
  assert.equal((await parseSnapshot({ ...good, observedAt: 'yesterday' }, A)).ok, false);
  assert.equal((await parseSnapshot({ ...good, entries: [{ ...entry, metadata: { nested: { a: 1 } } }] }, A)).ok, false);
  assert.equal((await parseSnapshot({ ...good, entries: [{ ...entry, previews: [{ digest: 'md5:x', mediaType: 'image/png', bytes: 1 }] }] }, A)).ok, false);
  assert.equal((await parseSnapshot(good, A)).ok, true);
  assert.equal((await parseSnapshot({ ...good, hostId: hostId('host-laptop-fake') }, A)).ok, true);
});

test('cache-loaded data is marked stale until refreshed', async () => {
  const state = (await applied(EMPTY_CATALOG, await fixtureSnapshot(A, 1, [{ path: 'one', name: 'One' }]), 0)).state;
  const loaded = reduceCatalog(state, { type: 'loaded-from-cache' }).state;
  assert.equal(Object.values(loaded.records)[0]!.freshness.status, 'stale');
  assert.equal(loaded.sources[A]!.status, 'stale');
  assert.equal(Object.values(loaded.records)[0]!.freshness.lastSuccessAt, at(0));
});
