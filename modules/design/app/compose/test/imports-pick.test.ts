import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { designFeedback, DesignOperationError } from '../errors.ts';
import { createImportsPickSource, importSourceFromFiles, LOCAL_FILES_RIGHTS, LOCAL_FILES_SOURCE_ID, pickRejection } from '../imports-pick.ts';
import { defaultMapperRegistry } from '../../../imports/src/mappers.ts';
import { webCryptoDigest } from '../../../imports/src/jcs.ts';
import { syntheticPng } from '../../../projects/fakes/index.ts';
import { createImportsDouble } from './imports-bridge-double.ts';

const png = (name: string, seed = 1) => ({ name, mediaType: 'image/png' as const, bytes: syntheticPng(seed, 14, 9) });

describe('durable pickSource', () => {
  it('builds a stable hq.files v1 source: one source ID, file-name keys, owned rights, original name provenance', async () => {
    const source = importSourceFromFiles([png('Home.png'), png('settings screen.PNG', 2)]);
    assert.deepEqual([source.kind, source.version, source.sourceId], ['hq.files', 1, LOCAL_FILES_SOURCE_ID]);
    assert.deepEqual(source.items.map((item) => [item.key, item.title, item.provenance]),
      [['Home.png', 'Home', { originalName: 'Home.png' }], ['settings screen.PNG', 'settings screen', { originalName: 'settings screen.PNG' }]]);
    for (const item of source.items) {
      assert.deepEqual(item.rights, { basis: 'owned', holder: 'Owner' });
      assert.equal(item.rights, LOCAL_FILES_RIGHTS);
      assert.equal(item.payload.kind, 'png');
    }
    // The shape is exactly what the built-in mapper accepts.
    const mapped = await defaultMapperRegistry().resolve(source.kind, source.version);
    assert.equal(mapped.ok, true);
    if (mapped.ok) assert.equal((await mapped.mapper.map(source, webCryptoDigest)).ok, true);
  });

  it('gives the same keys and item digests for the same files, a new digest for changed bytes, and copies the bytes', async () => {
    const digests = async (names: string[], seed: number) => {
      const source = importSourceFromFiles(names.map((name) => png(name, seed)));
      const mapped = await defaultMapperRegistry().resolve('hq.files', 1);
      if (!mapped.ok) throw new Error('mapper');
      const result = await mapped.mapper.map(source, webCryptoDigest);
      if (!result.ok) throw new Error('map');
      return result.items.map((item) => [item.key, item.itemDigest] as const);
    };
    const first = await digests(['a.png', 'b.png'], 1);
    assert.deepEqual(await digests(['a.png', 'b.png'], 1), first, 're-picking the same files is the same source');
    assert.deepEqual((await digests(['a.png', 'b.png'], 2)).map(([key]) => key), first.map(([key]) => key));
    assert.notEqual((await digests(['a.png', 'b.png'], 2))[0]![1], first[0]![1], 'changed bytes under the same name change the item');
    const original = png('a.png');
    const source = importSourceFromFiles([original]);
    original.bytes[0] = 0;
    assert.equal((source.items[0]!.payload as { bytes: Uint8Array }).bytes[0], 137, 'the source owns its bytes');
  });

  it('normalizes names to NFC and refuses names that cannot be keys or that repeat', () => {
    assert.equal(importSourceFromFiles([png('café.png')]).items[0]!.key, 'café.png');
    for (const [names, reason] of [[['a.png', 'a.png'], 'duplicate-name'], [['x'.repeat(161)], 'invalid-name'], [['bad\u0007.png'], 'invalid-name'], [['   '], 'invalid-name']] as const) {
      assert.throws(() => importSourceFromFiles(names.map((name) => png(name))), (error) => {
        assert.ok(error instanceof DesignOperationError);
        assert.deepEqual([error.kind, error.reason, error.operation, error.outcome], ['invalid', reason, 'imports.pick', 'no-effect']);
        return true;
      });
    }
    assert.equal(importSourceFromFiles([png('.png')]).items[0]!.title, '.png');
  });

  it('returns the source for a pick, null for a cancel or an empty pick', async () => {
    const double = createImportsDouble();
    const pickSource = createImportsPickSource(double.transport);
    assert.equal(await pickSource(), null);
    double.setPick({ status: 'picked', files: [] });
    assert.equal(await pickSource(), null);
    double.setPick({ status: 'picked', files: [png('home.png')] });
    const source = await pickSource();
    assert.deepEqual(source?.items.map((item) => item.key), ['home.png']);
    assert.deepEqual(double.calls.map((call) => [call.route, call.params]), [['import.pick', {}], ['import.pick', {}], ['import.pick', {}]]);
  });

  it('rejects a refused pick with a typed failure that keeps the picker reason, for every reason the picker has', async () => {
    const double = createImportsDouble();
    const pickSource = createImportsPickSource(double.transport);
    const expected: Record<string, string> = {
      unavailable: 'unavailable', 'invalid-selection': 'invalid', 'too-many-files': 'too-large', 'not-regular-file': 'invalid', 'file-too-large': 'too-large',
      'total-too-large': 'too-large', 'invalid-png': 'invalid', 'file-changed': 'stale', 'read-limit': 'too-large',
    };
    for (const [reason, kind] of Object.entries(expected)) {
      double.setPick({ status: 'rejected', reason } as never);
      await assert.rejects(() => pickSource(), (error) => {
        assert.ok(error instanceof DesignOperationError);
        assert.deepEqual([error.kind, error.reason, error.operation, error.outcome], [kind, reason, 'imports.pick', 'no-effect']);
        const feedback = designFeedback(error);
        assert.match(feedback.meta, new RegExp(`^imports\\.pick · ${reason}$`, 'u'));
        assert.ok(error.description && !/\bundefined\b/u.test(error.description));
        return true;
      });
    }
    assert.equal(pickRejection('not-a-reason').reason, 'not-a-reason');
    assert.equal(pickRejection('not-a-reason').kind, 'unavailable');
  });

  it('classifies a disabled host, a lost transport and a malformed reply as no-effect reads, never as unknown', async () => {
    const double = createImportsDouble();
    const pickSource = createImportsPickSource(double.transport);
    const outcomes: [unknown, string, string | undefined][] = [
      [{ ok: false, kind: 'unavailable', reason: 'disabled' }, 'disabled', 'disabled'],
      [{ ok: false, kind: 'unavailable' }, 'unavailable', undefined],
      [{ ok: true, value: { status: 'picked', files: [{ name: 'a.png', mediaType: 'image/jpeg', bytes: new Uint8Array() }] } }, 'unavailable', undefined],
      [{ ok: true, value: { status: 'other' } }, 'unavailable', undefined],
    ];
    for (const [reply, kind, reason] of outcomes) {
      double.failWith((route) => route === 'import.pick' ? reply : undefined);
      await assert.rejects(() => pickSource(), (error) => error instanceof DesignOperationError && error.kind === kind && error.reason === reason && error.outcome === 'no-effect');
    }
    double.failWith((route) => { if (route === 'import.pick') throw new Error('IPC channel closed'); });
    await assert.rejects(() => pickSource(), (error) => error instanceof DesignOperationError && error.kind === 'unavailable' && error.outcome === 'no-effect');
  });
});
