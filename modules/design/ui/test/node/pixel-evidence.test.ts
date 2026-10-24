import assert from 'node:assert/strict';
import { test } from 'node:test';
import { deflateSync, inflateSync } from 'node:zlib';
import { CAPTURE_COLOURS, captureFixture, decodePng, encodePng } from '../../harness/png.ts';
import { evaluate } from '../../harness/pixel-evidence.ts';

const inflate = (data: Uint8Array) => new Uint8Array(inflateSync(data));

test('the capture fixture encodes known bytes that decode back exactly', () => {
  const decoded = decodePng(captureFixture(64, 40), inflate);
  assert.equal(decoded.width, 64);
  assert.equal(decoded.height, 40);
  const at = (x: number, y: number) => [...decoded.rgba.subarray((y * 64 + x) * 4, (y * 64 + x) * 4 + 3)];
  assert.deepEqual(at(0, 0), [...CAPTURE_COLOURS[0]]);
  assert.deepEqual(at(63, 0), [...CAPTURE_COLOURS[1]]);
  assert.deepEqual(at(0, 39), [...CAPTURE_COLOURS[2]]);
  assert.deepEqual(at(63, 39), [...CAPTURE_COLOURS[3]]);
});

/** Build a compressed RGB PNG with a given filter on every row, as browsers emit. */
function rgbPng(width: number, height: number, pixel: (x: number, y: number) => [number, number, number], filter: number): Uint8Array {
  const stride = width * 3;
  const raw = new Uint8Array(height * (stride + 1));
  const plain = new Uint8Array(height * stride);
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) plain.set(pixel(x, y), y * stride + x * 3);
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = filter;
    for (let x = 0; x < stride; x += 1) {
      const left = x >= 3 ? plain[y * stride + x - 3]! : 0; const up = y > 0 ? plain[(y - 1) * stride + x]! : 0;
      const upLeft = y > 0 && x >= 3 ? plain[(y - 1) * stride + x - 3]! : 0;
      const p = left + up - upLeft; const pa = Math.abs(p - left); const pb = Math.abs(p - up); const pc = Math.abs(p - upLeft);
      const predictor = [0, left, up, (left + up) >> 1, pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft][filter]!;
      raw[y * (stride + 1) + 1 + x] = (plain[y * stride + x]! - predictor) & 255;
    }
  }
  const u32 = (v: number) => [(v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255];
  const crc = (bytes: readonly number[]) => {
    let c = ~0;
    for (const b of bytes) { c ^= b; for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; }
    return ~c >>> 0;
  };
  const chunk = (type: string, data: readonly number[]) => {
    const typed = [...type].map((c) => c.charCodeAt(0)).concat(data);
    return [...u32(data.length), ...typed, ...u32(crc(typed))];
  };
  return new Uint8Array([
    137, 80, 78, 71, 13, 10, 26, 10,
    ...chunk('IHDR', [...u32(width), ...u32(height), 8, 2, 0, 0, 0]), // 8-bit RGB
    ...chunk('IDAT', [...deflateSync(raw)]),
    ...chunk('IEND', []),
  ]);
}

test('decoder handles every PNG row filter on compressed RGB data', () => {
  for (const filter of [0, 1, 2, 3, 4]) {
    const png = rgbPng(9, 7, (x, y) => [x * 20, y * 30, (x * y) % 256], filter);
    const decoded = decodePng(png, inflate);
    for (let y = 0; y < 7; y += 1) for (let x = 0; x < 9; x += 1) {
      const i = (y * 9 + x) * 4;
      assert.deepEqual([...decoded.rgba.subarray(i, i + 4)], [x * 20, y * 30, (x * y) % 256, 255], `filter ${filter} at ${x},${y}`);
    }
  }
});

test('evaluate requires identical surfaces and changed chrome', () => {
  const make = (chrome: number) => decodePng(encodePng(20, 10, new Uint8Array(20 * 10 * 4).map((_, i) => {
    const x = (i >> 2) % 20;
    return i % 4 === 3 ? 255 : x < 10 ? chrome : 77;
  })), inflate);
  const regions = { dpr: 1, chrome: [{ name: 'bar', x: 0, y: 0, width: 10, height: 10 }], surfaces: [{ name: 'capture', x: 10, y: 0, width: 10, height: 10 }] };
  assert.equal(evaluate(make(240), make(20), regions).ok, true);
  assert.equal(evaluate(make(240), make(240), regions).ok, false, 'unchanged chrome fails');
  const tinted = decodePng(encodePng(20, 10, new Uint8Array(20 * 10 * 4).map((_, i) => (i % 4 === 3 ? 255 : 20))), inflate);
  assert.equal(evaluate(make(240), tinted, regions).ok, false, 'a recoloured surface fails');
});
