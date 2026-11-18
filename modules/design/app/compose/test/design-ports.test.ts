import assert from 'node:assert/strict';
import { it } from 'node:test';
import { readDesignCapabilities, DESIGN_HELD_FEATURES, fakeDesignCapabilities, capabilitiesReader, withImportRights } from '../capabilities.ts';
import { createDesignExportPort } from '../design-export-port.ts';
import { DesignOperationError } from '../errors.ts';
import { FAKE_TAG } from '../labels.ts';
import { importSourceId } from '../../../imports/src/contract.ts';
import { createTransportDouble } from './bridge-double.ts';
const AT = '2026-01-01T00:00:00Z';
const capabilities = () => ({ imports: 'enabled', pick: 'disabled', export: 'disabled', held: DESIGN_HELD_FEATURES.map(item => ({ ...item })) });
const report = () => ({ documents: 1, blobs: 0, events: 2, omitted: [{ category: 'cache', count: 1, unit: 'records', reason: 'Cache excluded' }] });
const failure = (kind: string, outcome = 'no-effect') => (error: unknown) => error instanceof DesignOperationError && error.kind === kind && error.outcome === outcome;
it('validates capabilities, copies/freeze replies, and labels fake answers', async () => {
  const d = createTransportDouble(), value = capabilities(); d.failWith(() => ({ ok: true, value }));
  const result = await readDesignCapabilities(d.transport);
  assert.deepEqual(result, value); assert.ok(Object.isFrozen(result)); assert.ok(Object.isFrozen(result.held[0]));
  assert.deepEqual(d.calls, [{ route: 'design.capabilities', params: {} }]);
  const fake = await fakeDesignCapabilities(); assert.equal(fake.tag, FAKE_TAG); assert.equal(fake.capabilities.export, 'disabled');
  await assert.rejects(capabilitiesReader(null), failure('disabled'));
});
it('rejects malformed capabilities and preserves typed refusals without retry', async () => {
  const d = createTransportDouble();
  for (const value of [null, { ...capabilities(), extra: true }, { ...capabilities(), pick: true },
    { ...capabilities(), held: [] }, { ...capabilities(), held: [...DESIGN_HELD_FEATURES].reverse() },
    { ...capabilities(), held: DESIGN_HELD_FEATURES.map(item => ({ ...item, reason: 'wrong' })) }]) {
    d.failWith(() => ({ ok: true, value })); await assert.rejects(() => readDesignCapabilities(d.transport), failure('unavailable'));
  }
  for (const kind of ['invalid', 'read-only', 'unavailable', 'unknown']) {
    d.failWith(() => ({ ok: false, kind })); await assert.rejects(() => readDesignCapabilities(d.transport), failure(kind, kind === 'unknown' ? 'unknown-effect' : 'no-effect'));
  }
  d.failWith(() => ({ ok: false, kind: 'unavailable', reason: 'disabled' }));
  await assert.rejects(() => readDesignCapabilities(d.transport), failure('disabled'));
  const before = d.calls.length; d.failWith(() => { throw new Error('lost'); });
  await assert.rejects(() => readDesignCapabilities(d.transport), failure('unavailable')); assert.equal(d.calls.length, before + 1);
});
it('validates export reports and cancel/saved replies, returning detached frozen data', async () => {
  const d = createTransportDouble(), port = createDesignExportPort(d.transport), value = report();
  d.failWith(() => ({ ok: true, value })); const got = await port.preview(AT);
  assert.deepEqual(got, value); assert.notEqual(got.omitted, value.omitted); assert.ok(Object.isFrozen(got.omitted[0]));
  for (const saved of [false, true]) { d.failWith(() => ({ ok: true, value: { saved } })); assert.deepEqual(await port.save(AT), { saved }); }
});
it('keeps invalid timestamps local; malformed/lost save replies are unknown with Check', async () => {
  const d = createTransportDouble(), port = createDesignExportPort(d.transport);
  for (const at of ['', 'yesterday', '2026-01-01', '2026-99-01T00:00:00Z']) {
    await assert.rejects(() => port.preview(at), failure('invalid')); await assert.rejects(() => port.save(at), failure('invalid'));
  }
  assert.equal(d.calls.length, 0);
  for (const value of [{ ...report(), documents: -1 }, { ...report(), blobs: 0.5 }, { ...report(), events: Number.MAX_SAFE_INTEGER + 1 },
    { ...report(), extra: true }, { ...report(), omitted: [{ category: '', count: 0, unit: 'records', reason: 'x' }] },
    { ...report(), omitted: [{ category: 'cache', count: 0, unit: 'bytes', reason: 'x' }] }, null]) {
    d.failWith(() => ({ ok: true, value })); await assert.rejects(() => port.preview(AT), failure('unavailable'));
  }
  for (const value of [{ saved: 'yes' }, { saved: false, extra: true }, null]) {
    d.failWith(() => ({ ok: true, value })); await assert.rejects(() => port.save(AT), error => failure('unknown', 'unknown-effect')(error) && (error as DesignOperationError).recovery === 'check');
  }
  d.failWith(() => { throw new Error('lost'); });
  await assert.rejects(() => port.preview(AT), failure('unavailable')); await assert.rejects(() => port.save(AT), failure('unknown', 'unknown-effect'));
  for (const kind of ['invalid', 'unavailable', 'read-only', 'conflict']) {
    d.failWith(() => ({ ok: false, kind })); await assert.rejects(() => port.save(AT), failure(kind));
  }
  d.failWith(() => ({ ok: false, kind: 'unavailable', reason: 'disabled' }));
  await assert.rejects(() => port.save(AT), failure('disabled')); await assert.rejects(() => createDesignExportPort(null).save(AT), failure('disabled'));
});
it('captures explicit rights before invoking an existing picker and keeps cancellation and source identity', async () => {
  let calls = 0;
  const source = { kind: 'hq.files' as const, version: 1 as const, sourceId: importSourceId('src-local-png-files'), items: [
    { key: 'x', title: 'x', rights: { basis: 'owned' as const, holder: 'Owner' }, payload: { kind: 'png' as const, bytes: new Uint8Array() } },
  ] };
  const pick = async () => { calls++; return source; };
  for (const basis of ['owned', 'licensed', 'permission', 'public-domain'] as const) {
    const rights = { basis, holder: 'Synthetic holder', license: 'Synthetic statement' };
    const picker = withImportRights(pick, rights); rights.holder = 'changed';
    const result = await picker(); assert.equal(result?.sourceId, source.sourceId); assert.equal(result?.items[0]?.rights.basis, basis);
    assert.equal(result?.items[0]?.rights.holder, 'Synthetic holder'); assert.equal(source.items[0]?.rights.basis, 'owned');
  }
  assert.equal(calls, 4); assert.throws(() => withImportRights(pick, { basis: 'licensed', holder: 'Owner' }), failure('invalid')); assert.throws(() => withImportRights(pick, { basis: 'owned', holder: '' }), failure('invalid')); assert.equal(calls, 4);
  assert.equal(await withImportRights(async () => null, { basis: 'owned', holder: 'Owner' })(), null);
});
