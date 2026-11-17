import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { describe, it } from 'node:test';
import zlib from 'node:zlib';
import { INFLATE_SLICE_BYTES, PNG_THUMBNAIL_DEFAULTS, pngThumbnail, type PngThumbnail } from '../png-thumbnail.ts';
import { buildPng, noiseSamples, PNG_CHANNELS, pngChunkBytes, type BuiltPngColorType } from './imports-bridge-double.ts';

const sha = (bytes: Uint8Array) => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
const hex = (value: string) => Uint8Array.from(Buffer.from(value.replace(/\s+/gu, ''), 'hex'));

const GOLDEN_HEX = `89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489
  00000010494441547801010500faff00808080ff05840280142179f5
  0000000049454e44ae426082`;
const GOLDEN_DIGEST = 'sha256:8d8c506387e24dde92cffe9749532e8fc68fea4a1102396d027c49b11abbcd26';
const GOLDEN_SOURCE = Uint8Array.from([255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 255]);

/** Decodes a thumbnail with `node:zlib`, independent of the module: its size and RGBA pixels. */
function decodeThumbnail(bytes: Uint8Array): { w: number; h: number; rgba: Uint8Array; idatChunks: number } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  assert.deepEqual([...bytes.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const w = view.getUint32(16);
  const h = view.getUint32(20);
  assert.deepEqual([...bytes.subarray(24, 29)], [8, 6, 0, 0, 0], '8-bit RGBA, no interlace');
  const idat: Uint8Array[] = [];
  let at = 8;
  let types = '';
  while (at < bytes.length) {
    const length = view.getUint32(at);
    const type = Buffer.from(bytes.subarray(at + 4, at + 8)).toString('latin1');
    types += `${type} `;
    assert.equal(view.getUint32(at + 8 + length), zlib.crc32(bytes.subarray(at + 4, at + 8 + length)), `${type} CRC`);
    if (type === 'IDAT') idat.push(bytes.subarray(at + 8, at + 8 + length));
    at += 12 + length;
  }
  assert.equal(at, bytes.length);
  assert.equal(types.trim(), `IHDR IDAT IEND`);
  const raw = zlib.inflateSync(Buffer.concat(idat));
  assert.equal(raw.length, h * (1 + w * 4));
  const rgba = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y += 1) {
    assert.equal(raw[y * (1 + w * 4)], 0, 'filter 0 on every row');
    rgba.set(raw.subarray(y * (1 + w * 4) + 1, (y + 1) * (1 + w * 4)), y * w * 4);
  }
  return { w, h, rgba, idatChunks: idat.length };
}

/** Straightforward reference: expands to RGBA, then box-averages in premultiplied alpha with the documented rounding. */
function expectedRgba(samples: Uint8Array, w: number, h: number, colorType: BuiltPngColorType, tw: number, th: number,
  palette?: Uint8Array, trns?: Uint8Array): Uint8Array {
  const channels = PNG_CHANNELS[colorType];
  const pixel = (x: number, y: number): [number, number, number, number] => {
    const at = (y * w + x) * channels;
    switch (colorType) {
      case 0: return [samples[at]!, samples[at]!, samples[at]!, 255];
      case 2: return [samples[at]!, samples[at + 1]!, samples[at + 2]!, 255];
      case 3: { const i = samples[at]!; return [palette![i * 3]!, palette![i * 3 + 1]!, palette![i * 3 + 2]!, trns !== undefined && i < trns.length ? trns[i]! : 255]; }
      case 4: return [samples[at]!, samples[at]!, samples[at]!, samples[at + 1]!];
      default: return [samples[at]!, samples[at + 1]!, samples[at + 2]!, samples[at + 3]!];
    }
  };
  const out = new Uint8Array(tw * th * 4);
  for (let ty = 0; ty < th; ty += 1) {
    for (let tx = 0; tx < tw; tx += 1) {
      let count = 0n, sumA = 0n, sumR = 0n, sumG = 0n, sumB = 0n;
      for (let y = 0; y < h; y += 1) {
        if (Math.floor((y * th) / h) !== ty) continue;
        for (let x = 0; x < w; x += 1) {
          if (Math.floor((x * tw) / w) !== tx) continue;
          const [r, g, b, a] = pixel(x, y);
          count += 1n; sumA += BigInt(a); sumR += BigInt(r * a); sumG += BigInt(g * a); sumB += BigInt(b * a);
        }
      }
      const at = (ty * tw + tx) * 4;
      out[at + 3] = Number((2n * sumA + count) / (2n * count));
      if (sumA !== 0n) {
        out[at] = Number((2n * sumR + sumA) / (2n * sumA));
        out[at + 1] = Number((2n * sumG + sumA) / (2n * sumA));
        out[at + 2] = Number((2n * sumB + sumA) / (2n * sumA));
      }
    }
  }
  return out;
}

const expectThumbnail = (value: PngThumbnail | null): PngThumbnail => {
  assert.ok(value !== null, 'a thumbnail was produced');
  return value;
};

describe('pngThumbnail: golden vector', () => {
  it('downsamples the 2x2 RGB source to exactly the 73-byte pinned file, with the pinned digest', async () => {
    const source = buildPng({ width: 2, height: 2, colorType: 2, samples: GOLDEN_SOURCE });
    const thumbnail = expectThumbnail(await pngThumbnail(source, { maxSide: 1 }));
    assert.deepEqual([thumbnail.w, thumbnail.h, thumbnail.bytes.length], [1, 1, 73]);
    assert.equal(Buffer.from(thumbnail.bytes).toString('hex'), Buffer.from(hex(GOLDEN_HEX)).toString('hex'));
    assert.equal(sha(thumbnail.bytes), GOLDEN_DIGEST);
    assert.deepEqual([...decodeThumbnail(thumbnail.bytes).rgba], [128, 128, 128, 255]);
  });

  it('has the documented defaults', () => {
    assert.deepEqual({ ...PNG_THUMBNAIL_DEFAULTS }, { maxSide: 512, maxSourcePixels: 50_000_000, maxBytes: 2 * 1024 * 1024 });
  });
});

describe('pngThumbnail: determinism and chunking', () => {
  const samples = noiseSamples(300 * 220 * 4, 5);
  const options = { width: 300, height: 220, samples };

  it('returns identical bytes for the same source, however the IDAT data is split', async () => {
    const one = expectThumbnail(await pngThumbnail(buildPng({ ...options, idatChunks: 1 }), { maxSide: 64 }));
    const again = expectThumbnail(await pngThumbnail(buildPng({ ...options, idatChunks: 1 }), { maxSide: 64 }));
    const many = expectThumbnail(await pngThumbnail(buildPng({ ...options, idatChunks: 41 }), { maxSide: 64 }));
    assert.deepEqual([...again.bytes], [...one.bytes]);
    assert.deepEqual([...many.bytes], [...one.bytes]);
    // The compression level of the source changes the source bytes but never the thumbnail.
    const stronger = expectThumbnail(await pngThumbnail(buildPng({ ...options, level: 9 }), { maxSide: 64 }));
    assert.deepEqual([...stronger.bytes], [...one.bytes]);
  });

  it('never changes or detaches the source bytes', async () => {
    const source = buildPng(options);
    const copy = new Uint8Array(source);
    expectThumbnail(await pngThumbnail(source, { maxSide: 64 }));
    assert.deepEqual([...source], [...copy]);
    assert.equal(source.byteLength, copy.byteLength, 'a detached buffer would read as empty');
  });

  it('matches an independent reference for the pixels', async () => {
    const thumbnail = expectThumbnail(await pngThumbnail(buildPng(options), { maxSide: 64 }));
    assert.deepEqual([thumbnail.w, thumbnail.h], [64, 46]);
    const decoded = decodeThumbnail(thumbnail.bytes);
    assert.deepEqual([...decoded.rgba], [...expectedRgba(samples, 300, 220, 6, 64, 46)]);
  });
});

describe('pngThumbnail: scanline filters', () => {
  for (const colorType of [0, 2, 4, 6] as const) {
    it(`decodes filters 1-4 to the same pixels as filter 0 (colour type ${colorType})`, async () => {
      const [width, height] = [37, 29];
      const samples = noiseSamples(width * height * PNG_CHANNELS[colorType], 11 + colorType);
      const base = expectThumbnail(await pngThumbnail(buildPng({ width, height, colorType, samples, filter: 0 }), { maxSide: 10 }));
      for (const filter of [1, 2, 3, 4] as const) {
        const filtered = expectThumbnail(await pngThumbnail(buildPng({ width, height, colorType, samples, filter }), { maxSide: 10 }));
        assert.deepEqual([...filtered.bytes], [...base.bytes], `filter ${filter}`);
      }
    });
  }
});

describe('pngThumbnail: colour types and alpha', () => {
  const cases: { name: string; colorType: BuiltPngColorType }[] = [
    { name: 'grey', colorType: 0 }, { name: 'RGB', colorType: 2 }, { name: 'grey+alpha', colorType: 4 }, { name: 'RGBA', colorType: 6 },
  ];
  for (const { name, colorType } of cases) {
    it(`${name} matches the reference`, async () => {
      const [width, height] = [53, 41];
      const samples = noiseSamples(width * height * PNG_CHANNELS[colorType], 3 + colorType);
      const thumbnail = expectThumbnail(await pngThumbnail(buildPng({ width, height, colorType, samples }), { maxSide: 8 }));
      assert.deepEqual([thumbnail.w, thumbnail.h], [8, 6]);
      assert.deepEqual([...decodeThumbnail(thumbnail.bytes).rgba], [...expectedRgba(samples, width, height, colorType, 8, 6)]);
    });
  }

  it('palette with tRNS: indexed colours and per-index alpha, missing entries opaque', async () => {
    const palette = Uint8Array.from([255, 0, 0, 0, 255, 0, 0, 0, 255, 10, 20, 30]);
    const trns = Uint8Array.from([0, 128]);
    const [width, height] = [9, 7];
    const samples = Uint8Array.from({ length: width * height }, (_, i) => (i * 7 + 3) % 4);
    const thumbnail = expectThumbnail(await pngThumbnail(buildPng({ width, height, colorType: 3, samples, palette, trns }), { maxSide: 3 }));
    assert.deepEqual([thumbnail.w, thumbnail.h], [3, 2]);
    assert.deepEqual([...decodeThumbnail(thumbnail.bytes).rgba], [...expectedRgba(samples, width, height, 3, 3, 2, palette, trns)]);
    // Without tRNS every entry is opaque.
    const opaque = expectThumbnail(await pngThumbnail(buildPng({ width, height, colorType: 3, samples, palette }), { maxSide: 3 }));
    assert.deepEqual([...decodeThumbnail(opaque.bytes).rgba], [...expectedRgba(samples, width, height, 3, 3, 2, palette)]);
    assert.ok(decodeThumbnail(opaque.bytes).rgba.every((value, i) => i % 4 !== 3 || value === 255));
  });

  it('a fully transparent bin is (0,0,0,0), whatever colour its pixels carry', async () => {
    const thumbnail = expectThumbnail(await pngThumbnail(buildPng({ width: 2, height: 1, colorType: 6, samples: Uint8Array.from([200, 100, 50, 0, 1, 2, 3, 0]) }), { maxSide: 1 }));
    assert.deepEqual([...decodeThumbnail(thumbnail.bytes).rgba], [0, 0, 0, 0]);
  });

  it('averages in premultiplied alpha: a transparent red pixel beside an opaque blue one yields blue, not purple', async () => {
    const thumbnail = expectThumbnail(await pngThumbnail(buildPng({ width: 2, height: 1, colorType: 6, samples: Uint8Array.from([255, 0, 0, 0, 0, 0, 255, 255]) }), { maxSide: 1 }));
    // Alpha averages to 127.5 -> 128; colour is the alpha-weighted mean, so it is pure blue.
    assert.deepEqual([...decodeThumbnail(thumbnail.bytes).rgba], [0, 0, 255, 128]);
  });
});

describe('pngThumbnail: geometry', () => {
  it('4000x1000 becomes 512x128', async () => {
    const samples = new Uint8Array(4000 * 1000);
    for (let i = 0; i < samples.length; i += 1) samples[i] = (i * 31) & 0xff;
    const thumbnail = expectThumbnail(await pngThumbnail(buildPng({ width: 4000, height: 1000, colorType: 0, samples })));
    assert.deepEqual([thumbnail.w, thumbnail.h], [512, 128]);
    const decoded = decodeThumbnail(thumbnail.bytes);
    assert.deepEqual([decoded.w, decoded.h], [512, 128]);
  });

  it('1x32768 becomes 1x512', async () => {
    const thumbnail = expectThumbnail(await pngThumbnail(buildPng({ width: 1, height: 32_768, colorType: 0, samples: noiseSamples(32_768, 2) })));
    assert.deepEqual([thumbnail.w, thumbnail.h], [1, 512]);
  });

  it('a tall thin source never collapses a side to zero', async () => {
    const thumbnail = expectThumbnail(await pngThumbnail(buildPng({ width: 1, height: 2000, colorType: 0, samples: noiseSamples(2000, 4) }), { maxSide: 100 }));
    assert.deepEqual([thumbnail.w, thumbnail.h], [1, 100]);
    const wide = expectThumbnail(await pngThumbnail(buildPng({ width: 2000, height: 3, colorType: 0, samples: noiseSamples(6000, 4) }), { maxSide: 100 }));
    assert.deepEqual([wide.w, wide.h], [100, 1]);
  });

  it('a source already within the long-side limit keeps its size, and an opaque pixel is copied exactly', async () => {
    const samples = noiseSamples(300 * 200 * 3, 8);
    const thumbnail = expectThumbnail(await pngThumbnail(buildPng({ width: 300, height: 200, colorType: 2, samples })));
    assert.deepEqual([thumbnail.w, thumbnail.h], [300, 200]);
    const expected = new Uint8Array(300 * 200 * 4);
    for (let i = 0; i < 300 * 200; i += 1) expected.set([samples[i * 3]!, samples[i * 3 + 1]!, samples[i * 3 + 2]!, 255], i * 4);
    assert.deepEqual([...decodeThumbnail(thumbnail.bytes).rgba], [...expected], 'one source pixel per bin is exact');
  });

  it('the largest default thumbnail is 512x512 and 1,049,236 bytes, under the 2 MiB cap', async () => {
    const thumbnail = expectThumbnail(await pngThumbnail(buildPng({ width: 1024, height: 1024, colorType: 0, samples: noiseSamples(1024 * 1024, 6) })));
    assert.deepEqual([thumbnail.w, thumbnail.h, thumbnail.bytes.length], [512, 512, 1_049_236]);
    assert.ok(thumbnail.bytes.length <= PNG_THUMBNAIL_DEFAULTS.maxBytes);
  });
});

describe('pngThumbnail: ceilings and refusals all return null, never throw', () => {
  const good = () => buildPng({ width: 20, height: 20, colorType: 2 });
  const isNull = async (name: string, source: Uint8Array, options?: Parameters<typeof pngThumbnail>[1]) =>
    assert.equal(await pngThumbnail(source, options), null, name);

  it('control: the unmodified fixture is accepted', async () => { expectThumbnail(await pngThumbnail(good())); });

  it('too many source pixels', async () => {
    await isNull('over the pixel ceiling', good(), { maxSourcePixels: 399 });
    expectThumbnail(await pngThumbnail(good(), { maxSourcePixels: 400 }));
  });

  it('unsupported variants', async () => {
    await isNull('interlaced', buildPng({ width: 20, height: 20, colorType: 2, interlace: 1 }));
    await isNull('16-bit', buildPng({ width: 20, height: 20, colorType: 2, depth: 16 }));
    await isNull('4-bit', buildPng({ width: 20, height: 20, colorType: 0, depth: 4 }));
    await isNull('1-bit', buildPng({ width: 20, height: 20, colorType: 0, depth: 1 }));
    await isNull('colour-key tRNS on grey', buildPng({ width: 20, height: 20, colorType: 0, trns: Uint8Array.from([0, 7]) }));
    await isNull('colour-key tRNS on RGB', buildPng({ width: 20, height: 20, colorType: 2, trns: Uint8Array.from([0, 1, 0, 2, 0, 3]) }));
    await isNull('unknown critical chunk', buildPng({ width: 20, height: 20, colorType: 2, extraChunks: [{ type: 'ABCD', data: new Uint8Array(0) }] }));
  });

  it('tolerates ancillary chunks it does not use', async () => {
    const text = new TextEncoder().encode('Comment\0synthetic');
    expectThumbnail(await pngThumbnail(buildPng({ width: 20, height: 20, colorType: 2, extraChunks: [{ type: 'tEXt', data: text }] })));
  });

  it('palette problems', async () => {
    const samples = new Uint8Array(20 * 20);
    await isNull('palette colour type without PLTE', buildPng({ width: 20, height: 20, colorType: 3, samples }));
    await isNull('index beyond the palette', buildPng({ width: 20, height: 20, colorType: 3, samples: samples.fill(5), palette: Uint8Array.from([1, 2, 3, 4, 5, 6]) }));
    await isNull('PLTE not a multiple of 3', buildPng({ width: 20, height: 20, colorType: 3, samples: new Uint8Array(400), palette: Uint8Array.from([1, 2, 3, 4]) }));
    await isNull('more tRNS entries than palette entries', buildPng({ width: 20, height: 20, colorType: 3, samples: new Uint8Array(400), palette: Uint8Array.from([1, 2, 3]), trns: Uint8Array.from([1, 2]) }));
  });

  it('damage', async () => {
    const source = good();
    const corrupt = new Uint8Array(source);
    corrupt[corrupt.length - 20] ^= 0xff; // inside the last IDAT chunk's data or CRC
    await isNull('bad chunk CRC', corrupt);
    const header = new Uint8Array(source);
    header[16] ^= 0x01; // IHDR width, CRC no longer matches
    await isNull('bad IHDR CRC', header);
    await isNull('truncated file (no IEND)', source.subarray(0, source.length - 12));
    await isNull('cut mid-chunk', source.subarray(0, source.length - 30));
    await isNull('missing IEND', buildPng({ width: 20, height: 20, colorType: 2, omitIend: true }));
    await isNull('truncated IDAT stream', buildPng({ width: 20, height: 20, colorType: 2, zlibTransform: (stream) => stream.subarray(0, Math.floor(stream.length / 2)) }));
    await isNull('inflated data longer than the header allows', buildPng({ width: 20, height: 20, colorType: 2, rawTransform: (raw) => Uint8Array.from([...raw, ...new Uint8Array(61)]) }));
    await isNull('inflated data shorter than the header requires', buildPng({ width: 20, height: 20, colorType: 2, rawTransform: (raw) => raw.subarray(0, raw.length - 61) }));
    await isNull('trailing garbage in the zlib stream', buildPng({ width: 20, height: 20, colorType: 2, zlibTransform: (stream) => Uint8Array.from([...stream, 1, 2, 3, 4, 5, 6, 7, 8]) }));
    await isNull('unknown filter type', buildPng({ width: 20, height: 20, colorType: 2, rawTransform: (raw) => { const out = new Uint8Array(raw); out[0] = 9; return out; } }));
    await isNull('IDAT chunks that are not contiguous', (() => {
      const split = buildPng({ width: 20, height: 20, colorType: 2, idatChunks: 2 });
      const firstIdat = 8 + 25;
      const firstEnd = firstIdat + 12 + new DataView(split.buffer).getUint32(firstIdat);
      const between = pngChunkBytes('tEXt', Uint8Array.from([65, 0, 66]));
      return Uint8Array.from([...split.subarray(0, firstEnd), ...between, ...split.subarray(firstEnd)]);
    })());
  });

  it('input that is not a PNG', async () => {
    await isNull('empty', new Uint8Array(0));
    await isNull('text', new TextEncoder().encode('not a png at all, just some text that is long enough to parse as a header'));
    await isNull('signature only', Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    await isNull('zeros', new Uint8Array(500));
    await isNull('not bytes', 'png' as unknown as Uint8Array);
  });

  it('options that are not valid limits', async () => {
    await isNull('zero side', good(), { maxSide: 0 });
    await isNull('fractional side', good(), { maxSide: 1.5 });
    await isNull('absurd side', good(), { maxSide: 100_000 });
    await isNull('zero bytes', good(), { maxBytes: 0 });
  });

  it('an inflater that throws, or fails part way, yields null', async () => {
    await isNull('throws at once', good(), { inflate: () => { throw new Error('no inflate here'); } });
    await isNull('rejects', good(), { inflate: async function* () { throw new Error('stream failed'); } });
    await isNull('fails after some data', good(), { inflate: async function* () { yield new Uint8Array(100); throw new Error('stream failed'); } });
    await isNull('ends early', good(), { inflate: async function* () { yield new Uint8Array(100); } });
  });

  it('stops a decompression bomb at the promised size', async () => {
    let pulled = 0;
    let closed = false;
    const inflate = () => ({
      [Symbol.asyncIterator]() {
        return {
          async next() { pulled += 1; return { done: false as const, value: new Uint8Array(1 << 20) }; },
          async return() { closed = true; return { done: true as const, value: undefined }; },
        };
      },
    });
    assert.equal(await pngThumbnail(good(), { inflate }), null);
    assert.equal(pulled, 1, 'the first oversized chunk ends the read');
    assert.equal(closed, true, 'and the stream is released');
  });

  it('the output must fit maxBytes', async () => {
    const source = buildPng({ width: 300, height: 200, colorType: 6 });
    assert.equal(await pngThumbnail(source, { maxBytes: 1000 }), null, 'refused before decoding');
    const thumbnail = expectThumbnail(await pngThumbnail(source, { maxBytes: 300 * 200 * 4 + 400 }));
    assert.ok(thumbnail.bytes.length <= 300 * 200 * 4 + 400);
  });

  it('an injected inflater sees every IDAT part, in order, without copying', async () => {
    const source = buildPng({ width: 20, height: 20, colorType: 2, idatChunks: 3 });
    let seen: readonly Uint8Array[] = [];
    const result = await pngThumbnail(source, { inflate: (parts) => { seen = parts; return (async function* () { yield zlib.inflateSync(Buffer.concat(parts)); })(); } });
    expectThumbnail(result);
    assert.equal(seen.length, 3);
    assert.ok(seen.every((part) => part.buffer === source.buffer), 'subarrays of the source, not copies');
  });
});

/**
 * A zlib stream that never ends: one literal zero, then `matches` copies of (length 258, distance 1) in a fixed-Huffman
 * block. Each match is 13 bits for 258 zero bytes, an expansion of about 159 times (dynamic codes reach deflate's ceiling
 * of about 1032). Built bit by bit, so a bomb of hundreds of megabytes costs under 2 MB and no compressor time.
 */
function zeroBomb(matches: number): Uint8Array {
  const out = new Uint8Array(2 + Math.ceil((3 + 8 + matches * 13) / 8));
  out[0] = 0x78; out[1] = 0x01;
  let bit = 16;
  const put = (value: number, length: number) => { // Huffman codes are packed most significant bit first.
    for (let i = length - 1; i >= 0; i -= 1, bit += 1) if (((value >> i) & 1) !== 0) out[bit >> 3]! |= 1 << (bit & 7);
  };
  put(0b0, 1); // BFINAL = 0
  put(0b1, 1); put(0b0, 1); // BTYPE = 01 (fixed), a value, so least significant bit first
  put(0b00110000, 8); // literal 0
  for (let i = 0; i < matches; i += 1) { put(0b11000101, 8); put(0b00000, 5); } // length code 285 (258), distance code 0 (1)
  return out;
}

/**
 * Swaps the global `DecompressionStream` for the real one behind a transparent wrapper that records every input write
 * it is fed. Inflation stays the platform's own; `pngThumbnail` gets no injected inflater.
 */
async function withObservedPlatformInflate<T>(run: (writes: number[]) => Promise<T>): Promise<T> {
  const Real = globalThis.DecompressionStream;
  const writes: number[] = [];
  class Observed {
    readonly readable: ReadableStream<Uint8Array<ArrayBuffer>>;
    readonly writable: WritableStream<Uint8Array<ArrayBuffer>>;
    constructor(format: CompressionFormat) {
      const real = new Real(format);
      const writer = real.writable.getWriter();
      this.readable = real.readable;
      this.writable = new WritableStream({
        write(chunk) { writes.push(chunk.length); return writer.write(chunk); },
        close() { return writer.close(); },
        abort(reason) { return writer.abort(reason); },
      });
    }
  }
  globalThis.DecompressionStream = Observed as unknown as typeof DecompressionStream;
  try { return await run(writes); } finally { globalThis.DecompressionStream = Real; }
}

const macrotasks = async (count: number) => { for (let i = 0; i < count; i += 1) await new Promise((resolve) => setTimeout(resolve, 0)); };
const sum = (values: readonly number[]) => values.reduce((total, value) => total + value, 0);

describe('pngThumbnail: the platform inflater is fed in bounded slices', () => {
  it('the zero bomb used below really inflates to zeros', () => {
    const prefix = zeroBomb(1000);
    const inflated = zlib.inflateSync(prefix, { finishFlush: zlib.constants.Z_SYNC_FLUSH });
    assert.ok(inflated.length >= 1 + 999 * 258, `inflated ${inflated.length} bytes`);
    assert.ok(inflated.every((value) => value === 0));
  });

  it('stops a single-IDAT zero bomb (about 258 MB inflated) after a few slices, with no injected inflater', async () => {
    const bomb = zeroBomb(1_000_000); // about 1.6 MB compressed, about 258 MB of zeros
    assert.ok(bomb.length > 1_600_000);
    const source = buildPng({ width: 20, height: 20, colorType: 2, zlibTransform: () => bomb });
    await withObservedPlatformInflate(async (writes) => {
      const started = Date.now();
      assert.equal(await pngThumbnail(source), null, 'more output than the header promises');
      const elapsed = Date.now() - started;
      const fed = sum(writes);
      assert.ok(writes.every((length) => length <= INFLATE_SLICE_BYTES), `every write is at most one slice: ${writes.join(', ')}`);
      assert.ok(fed <= 8 * INFLATE_SLICE_BYTES, `only a few slices of the ${bomb.length}-byte IDAT were fed (${fed} bytes)`);
      await macrotasks(5);
      assert.equal(sum(writes), fed, 'the input is cancelled: nothing more is fed afterwards');
      assert.ok(elapsed < 5000, `stopped promptly (${elapsed} ms)`);
    });
  });

  it('a normal single-IDAT image decodes through the platform in slices, identical to node:zlib', async () => {
    const source = buildPng({ width: 300, height: 220, colorType: 6, samples: noiseSamples(300 * 220 * 4, 21) });
    const idatLength = new DataView(source.buffer).getUint32(8 + 25);
    assert.ok(idatLength > 8 * INFLATE_SLICE_BYTES, 'large enough to need many slices');
    const viaZlib = expectThumbnail(await pngThumbnail(source, { maxSide: 64, inflate: (parts) => (async function* () { yield zlib.inflateSync(Buffer.concat(parts)); })() }));
    await withObservedPlatformInflate(async (writes) => {
      const viaPlatform = expectThumbnail(await pngThumbnail(source, { maxSide: 64 }));
      assert.deepEqual([...viaPlatform.bytes], [...viaZlib.bytes]);
      assert.equal(sum(writes), idatLength, 'every compressed byte was fed exactly once');
      assert.ok(writes.length >= Math.ceil(idatLength / INFLATE_SLICE_BYTES), `in slices (${writes.length} writes)`);
      assert.ok(writes.every((length) => length <= INFLATE_SLICE_BYTES));
    });
    assert.deepEqual([...decodeThumbnail(viaZlib.bytes).rgba], [...expectedRgba(noiseSamples(300 * 220 * 4, 21), 300, 220, 6, 64, 46)]);
  });

  it('slices span IDAT boundaries in order', async () => {
    const options = { width: 300, height: 220, colorType: 6 as const, samples: noiseSamples(300 * 220 * 4, 22) };
    const one = expectThumbnail(await pngThumbnail(buildPng({ ...options, idatChunks: 1 }), { maxSide: 50 }));
    // 7 parts of about 38 KB each: none a multiple of the slice size.
    const split = buildPng({ ...options, idatChunks: 7 });
    await withObservedPlatformInflate(async (writes) => {
      const many = expectThumbnail(await pngThumbnail(split, { maxSide: 50 }));
      assert.deepEqual([...many.bytes], [...one.bytes]);
      assert.ok(writes.every((length) => length <= INFLATE_SLICE_BYTES));
    });
  });
});

describe('pngThumbnail: yields to the event loop', () => {
  it('yields while checking and decoding a large image, and the bytes do not change', async () => {
    const source = buildPng({ width: 2048, height: 1024, colorType: 6, samples: noiseSamples(2048 * 1024 * 4, 31) });
    let yields = 0;
    const counted = expectThumbnail(await pngThumbnail(source, { yieldControl: async () => { yields += 1; await macrotasks(1); } }));
    // About 8.4 MB checked and about 8.4 MB decoded, at one yield per MiB of work.
    assert.ok(yields >= 14, `yielded ${yields} times`);
    const plain = expectThumbnail(await pngThumbnail(source));
    assert.deepEqual([...counted.bytes], [...plain.bytes]);
  });

  it('other tasks run while a large image decodes (the default yield is a macrotask)', async () => {
    const source = buildPng({ width: 2048, height: 1024, colorType: 6, samples: noiseSamples(2048 * 1024 * 4, 32) });
    // An injected inflater whose reads all resolve as microtasks, as queued platform reads do.
    const inflate = (parts: readonly Uint8Array[]) => (async function* () {
      const raw = zlib.inflateSync(Buffer.concat(parts));
      for (let at = 0; at < raw.length; at += 65_536) yield raw.subarray(at, at + 65_536);
    })();
    let ticks = 0;
    const timer = setInterval(() => { ticks += 1; }, 0);
    try {
      expectThumbnail(await pngThumbnail(source, { inflate }));
    } finally {
      clearInterval(timer);
    }
    assert.ok(ticks >= 2, `a timer ran ${ticks} times during decoding`);
  });

  it('the golden vector is unchanged with a yield after every step', async () => {
    const source = buildPng({ width: 2, height: 2, colorType: 2, samples: GOLDEN_SOURCE });
    const thumbnail = expectThumbnail(await pngThumbnail(source, { maxSide: 1, yieldControl: () => macrotasks(1) }));
    assert.equal(sha(thumbnail.bytes), GOLDEN_DIGEST);
  });

  it('a yield that rejects yields null, never a throw', async () => {
    const source = buildPng({ width: 2048, height: 1024, colorType: 0, samples: noiseSamples(2048 * 1024, 33) });
    assert.equal(await pngThumbnail(source, { yieldControl: () => Promise.reject(new Error('stopped')) }), null);
  });
});
