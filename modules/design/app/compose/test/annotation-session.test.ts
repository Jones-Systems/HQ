import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { DesignOperationError } from '../errors.ts';
import { alpha, dataUrl, digestOf, durableFixture, png, saveVersion } from './content-fixtures.ts';

describe('annotation session version selection', () => {
  it('defaults to the newest version with a stored capture and shows its verified bytes', async () => {
    const f = durableFixture();
    const older = png(1);
    const newer = png(2);
    await saveVersion(f, alpha, { id: 'v1', digest: f.store(older) });
    await saveVersion(f, alpha, { id: 'v2', digest: f.store(newer) });
    // The newest version names a capture whose bytes are not stored on this device.
    await saveVersion(f, alpha, { id: 'v3', digest: digestOf(png(3)) });
    const session = (await f.workspace.annotationSessionFor(alpha))!;
    assert.equal(session.selection, 'default');
    assert.equal(session.target.version, 'v2');
    assert.equal(session.target.captureUrl, dataUrl(newer));
    assert.equal(session.target.frame.captureDigest, digestOf(newer));
    assert.deepEqual(session.choices.map((choice) => choice.id), ['v3', 'v2', 'v1'], 'every annotatable version, newest first');
  });

  it('falls back to the newest version that names a capture when no bytes are stored, and says so', async () => {
    const f = durableFixture();
    await saveVersion(f, alpha, { id: 'v1', digest: digestOf(png(1)) });
    await saveVersion(f, alpha, { id: 'v2', digest: digestOf(png(2)) });
    const session = (await f.workspace.annotationSessionFor(alpha))!;
    assert.equal(session.target.version, 'v2');
    assert.equal(session.target.captureUrl, null);
    assert.equal(session.target.thumbnailUrl, null);
  });

  it('skips a stored capture whose bytes are damaged', async () => {
    const f = durableFixture();
    const good = png(1);
    await saveVersion(f, alpha, { id: 'v1', digest: f.store(good) });
    const damaged = digestOf(png(2));
    f.blobs.set(damaged, png(3));
    await saveVersion(f, alpha, { id: 'v2', digest: damaged });
    const session = (await f.workspace.annotationSessionFor(alpha))!;
    assert.equal(session.target.version, 'v1');
    assert.equal(session.target.captureUrl, dataUrl(good));
  });

  it('never anchors marks to a missing capture: versions without a digest are not offered, and none means no session', async () => {
    const f = durableFixture();
    assert.equal(await f.workspace.annotationSessionFor(alpha), null);
    await saveVersion(f, alpha, { id: 'v1' });
    f.contentEvents.notify(alpha.id);
    assert.equal(await f.workspace.annotationSessionFor(alpha), null);
    await saveVersion(f, alpha, { id: 'v2', digest: f.store(png(1)) });
    await saveVersion(f, alpha, { id: 'v3' });
    const session = (await f.workspace.annotationSessionFor(alpha))!;
    assert.equal(session.target.version, 'v2');
    assert.ok(session.target.frame.captureDigest.startsWith('sha256:'), 'never an empty digest');
    assert.deepEqual(session.choices.map((choice) => choice.id), ['v2']);
  });

  it('opens an explicitly chosen version, not the default', async () => {
    const f = durableFixture();
    const first = png(1);
    await saveVersion(f, alpha, { id: 'v1', digest: f.store(first) });
    await saveVersion(f, alpha, { id: 'v2', digest: f.store(png(2)) });
    const session = (await f.workspace.annotationSessionFor(alpha, { selection: 'v1' }))!;
    assert.equal(session.selection, 'explicit');
    assert.equal(session.target.version, 'v1');
    assert.equal(session.target.captureUrl, dataUrl(first));
    assert.equal(session.controller.snapshot.frame?.versionId, 'v1');
    assert.notEqual(await f.workspace.annotationSessionFor(alpha, { selection: 'v1' }), await f.workspace.annotationSessionFor(alpha));
  });

  it('does not infer lineage: a later version based on an earlier one does not change the default, and basedOn is not followed', async () => {
    const f = durableFixture();
    await saveVersion(f, alpha, { id: 'base', digest: f.store(png(1)) });
    await saveVersion(f, alpha, { id: 'derived', digest: f.store(png(2)), basedOn: 'base' });
    await saveVersion(f, alpha, { id: 'unrelated', digest: f.store(png(3)) });
    assert.equal((await f.workspace.annotationSessionFor(alpha))!.target.version, 'unrelated');
    assert.equal((await f.workspace.annotationSessionFor(alpha, { selection: 'derived' }))!.target.version, 'derived');
  });

  it('refuses an unknown version and a version without a capture with classifiable errors', async () => {
    const f = durableFixture();
    await saveVersion(f, alpha, { id: 'with-capture', digest: f.store(png(1)) });
    await saveVersion(f, alpha, { id: 'no-capture' });
    await assert.rejects(f.workspace.annotationSessionFor(alpha, { selection: 'missing' }), (error: unknown) =>
      error instanceof DesignOperationError && error.kind === 'not-found' && error.operation === 'annotations.open' && error.outcome === 'no-effect');
    await assert.rejects(f.workspace.annotationSessionFor(alpha, { selection: 'no-capture' }), (error: unknown) =>
      error instanceof DesignOperationError && error.kind === 'invalid' && error.reason === 'no-capture' && error.section === 'annotations');
  });

  it('keeps the route and the hash apart the way the live frame does', async () => {
    const f = durableFixture();
    await saveVersion(f, alpha, { id: 'v1', digest: f.store(png(1)), route: '/page?tab=2#open' });
    await saveVersion(f, alpha, { id: 'v2', digest: f.store(png(2)), route: '/plain' });
    const hashed = (await f.workspace.annotationSessionFor(alpha, { selection: 'v1' }))!.target.frame;
    assert.deepEqual([hashed.route, hashed.state], ['/page?tab=2', '#open']);
    const plain = (await f.workspace.annotationSessionFor(alpha, { selection: 'v2' }))!.target.frame;
    assert.deepEqual([plain.route, plain.state], ['/plain', '']);
  });

  it('keeps one controller per version across content changes so unsaved marks survive a refresh', async () => {
    const f = durableFixture();
    await saveVersion(f, alpha, { id: 'v1', digest: f.store(png(1)) });
    const before = (await f.workspace.annotationSessionFor(alpha))!;
    await saveVersion(f, alpha, { id: 'v2', digest: f.store(png(2)) });
    const moved = (await f.workspace.annotationSessionFor(alpha))!;
    assert.equal(moved.target.version, 'v2', 'the default follows the newest stored capture');
    const back = (await f.workspace.annotationSessionFor(alpha, { selection: 'v1' }))!;
    assert.equal(back.controller, before.controller);
  });
});
