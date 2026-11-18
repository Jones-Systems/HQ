import { test } from 'node:test';
import assert from 'node:assert/strict';
import { base64Encode, previewDataUrl, previewImageType } from '../src/view-model.ts';
import { utf8 } from '../src/jcs.ts';

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0]);
const WEBP = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0x24, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x20]);

test('base64 matches the reference encoder for every length, including padding', () => {
  let seed = 7;
  for (let length = 0; length <= 40; length += 1) {
    const bytes = new Uint8Array(length).map(() => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed & 255; });
    assert.equal(base64Encode(bytes), Buffer.from(bytes).toString('base64'), `length ${length}`);
  }
  assert.equal(base64Encode(utf8('foobar')), 'Zm9vYmFy');
  assert.equal(base64Encode(utf8('fooba')), 'Zm9vYmE=');
  assert.equal(base64Encode(utf8('foob')), 'Zm9vYg==');
});

test('only png, jpeg and webp are allow-listed, whatever the case or parameters', () => {
  assert.equal(previewImageType('image/png'), 'image/png');
  assert.equal(previewImageType('image/jpeg'), 'image/jpeg');
  assert.equal(previewImageType('image/webp'), 'image/webp');
  assert.equal(previewImageType('IMAGE/PNG; charset=binary'), 'image/png');
  assert.equal(previewImageType('  image/webp '), 'image/webp');
  for (const other of ['image/svg+xml', 'image/gif', 'image/avif', 'image/jpg', 'image/*', 'text/html', 'application/octet-stream', 'text/plain', 'image/', '']) {
    assert.equal(previewImageType(other), null, other);
  }
});

test('a preview becomes a base64 data: URL that decodes back to the same bytes', () => {
  for (const [bytes, type] of [[PNG, 'image/png'], [JPEG, 'image/jpeg'], [WEBP, 'image/webp']] as const) {
    const url = previewDataUrl(bytes, type);
    assert.ok(url, type);
    assert.ok(url.startsWith(`data:${type};base64,`), 'a data: URL, never blob:');
    assert.deepEqual(new Uint8Array(Buffer.from(url.slice(url.indexOf(',') + 1), 'base64')), bytes);
  }
  assert.equal(previewDataUrl(PNG, 'IMAGE/PNG; charset=binary'), previewDataUrl(PNG, 'image/png'), 'the canonical type is written');
});

test('anything else stays a no-preview tile: other types, and bytes that do not match the declared type', () => {
  for (const type of ['image/svg+xml', 'image/gif', 'text/plain', 'application/octet-stream']) {
    assert.equal(previewDataUrl(PNG, type), null, `${type} is refused even with PNG bytes`);
  }
  assert.equal(previewDataUrl(utf8('synthetic-preview:host-laptop-fake-0'), 'image/png'), null, 'text labelled as an image is not an image');
  assert.equal(previewDataUrl(PNG, 'image/jpeg'), null, 'PNG bytes under a JPEG label');
  assert.equal(previewDataUrl(JPEG, 'image/webp'), null);
  assert.equal(previewDataUrl(new Uint8Array(), 'image/png'), null);
  assert.equal(previewDataUrl(utf8('<svg xmlns="http://www.w3.org/2000/svg"/>'), 'image/png'), null, 'SVG markup under a raster label');
  // RIFF without the WEBP form type is some other RIFF container.
  assert.equal(previewDataUrl(new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x41, 0x56, 0x45]), 'image/webp'), null);
});
