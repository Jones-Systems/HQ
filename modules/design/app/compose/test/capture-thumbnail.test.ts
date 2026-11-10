import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parsePreviewRef } from '../../../projects/src/content.ts';
import { DEFAULT_LIMITS } from '../../../projects/src/controller.ts';
import { createWorkspaceThumbnailPort } from '../thumbnail-port.ts';
import { captureThumbnailRef, type CaptureBlobReader } from '../capture-thumbnail.ts';
import { digestOf, png } from './content-fixtures.ts';

const readerFor = (bytes: Uint8Array | null, calls: string[] = []): CaptureBlobReader => async (digest) => { calls.push(digest); return bytes; };

describe('thumbnail for a saved live capture', () => {
  it('describes a stored PNG that hashes to the capture digest, with its real size and pixel dimensions', async () => {
    const bytes = png(3, 48, 30);
    const digest = digestOf(bytes);
    const calls: string[] = [];
    const ref = await captureThumbnailRef(readerFor(bytes, calls), digest);
    assert.deepEqual(ref, { digest, mediaType: 'image/png', bytes: bytes.byteLength, w: 48, h: 30 });
    assert.ok(parsePreviewRef(ref), 'a valid Projects PreviewRef');
    assert.deepEqual(calls, [digest], 'read by exact digest only');
  });

  it('resolves through the workspace thumbnail port exactly like any other thumbnail', async () => {
    const bytes = png(4);
    const digest = digestOf(bytes);
    const ref = (await captureThumbnailRef(readerFor(bytes), digest))!;
    const port = createWorkspaceThumbnailPort({ getBlob: async (requested) => (requested === digest ? bytes : null) });
    const fetched = await port.readThumbnail(ref, new AbortController().signal);
    assert.equal(fetched.mediaType, 'image/png');
    assert.deepEqual(fetched.bytes, bytes);
  });

  it('accepts a PNG exactly at the size limit and refuses one byte over', async () => {
    const bytes = png(5);
    const digest = digestOf(bytes);
    assert.ok(await captureThumbnailRef(readerFor(bytes), digest, bytes.byteLength));
    assert.equal(await captureThumbnailRef(readerFor(bytes), digest, bytes.byteLength - 1), undefined);
  });

  it('omits the thumbnail for a capture larger than the Projects thumbnail limit', async () => {
    // A real PNG header followed by padding: the size check comes first, so the rest need not decode.
    const big = new Uint8Array(DEFAULT_LIMITS.maxThumbnailBytes + 1);
    big.set(png(6).subarray(0, 64));
    assert.ok(big.byteLength > DEFAULT_LIMITS.maxThumbnailBytes, 'fixture really is over the limit');
    assert.equal(await captureThumbnailRef(readerFor(big), digestOf(big)), undefined);
  });

  it('omits it when the size cannot be known: no blob storage, nothing stored, or a read that fails', async () => {
    const digest = digestOf(png(7));
    assert.equal(await captureThumbnailRef(null, digest), undefined);
    assert.equal(await captureThumbnailRef(readerFor(null), digest), undefined);
    assert.equal(await captureThumbnailRef(async () => { throw new Error('storage lost'); }, digest), undefined);
    assert.equal(await captureThumbnailRef(readerFor(new Uint8Array(0)), digest), undefined);
  });

  it('never fakes one: wrong digest, malformed digest, damaged bytes or a different format yield nothing', async () => {
    const bytes = png(8);
    const digest = digestOf(bytes);
    assert.equal(await captureThumbnailRef(readerFor(bytes), digestOf(png(9))), undefined, 'bytes do not hash to the digest');
    assert.equal(await captureThumbnailRef(readerFor(bytes), 'some/path.png'), undefined);
    assert.equal(await captureThumbnailRef(readerFor(bytes), digest.toUpperCase()), undefined);
    const jpeg = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, ...new Array(40).fill(1)]);
    assert.equal(await captureThumbnailRef(readerFor(jpeg), digestOf(jpeg)), undefined);
    const truncated = bytes.slice(0, 20);
    assert.equal(await captureThumbnailRef(readerFor(truncated), digestOf(truncated)), undefined);
    const zeroWide = bytes.slice();
    new DataView(zeroWide.buffer).setUint32(16, 0);
    assert.equal(await captureThumbnailRef(readerFor(zeroWide), digestOf(zeroWide)), undefined);
  });
});
