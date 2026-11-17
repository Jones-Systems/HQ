/**
 * Deterministic PNG thumbnails for imported images (B3 backend contract, section 12).
 *
 * The Projects thumbnail port refuses a preview over `DEFAULT_LIMITS.maxThumbnailBytes` (2 MiB). An accepted PNG larger
 * than that is therefore downsampled here, in the renderer, with no dependency, no canvas and no native call:
 *
 *  - Decode: the PNG subset real captures use (8-bit grey, RGB, palette, grey+alpha and RGBA; no interlace), streamed
 *    through the platform `DecompressionStream`. Peak memory is two scanlines plus the bin accumulators, whatever the
 *    source height. Every chunk CRC is verified, and inflated output is bounded to exactly what the header promises.
 *  - Resample: exact integer box averaging in premultiplied alpha, so a transparent pixel never tints its neighbours.
 *  - Encode: 8-bit RGBA with filter 0 and zlib *stored* blocks written by hand. No compressor is involved, so the bytes
 *    (and their digest) are identical on every platform and engine version. A 512 x 512 result is 1,049,236 bytes.
 *
 * `pngThumbnail` never throws. `null` means "no thumbnail" for any reason: an unsupported variant, a damaged file, a
 * ceiling, or an unavailable inflater. Callers keep the import and simply link no thumbnail.
 *
 * Renderer-safe: only web globals (`ReadableStream`, `DecompressionStream`) and no Node builtin.
 */
import { DEFAULT_LIMITS } from '../../projects/src/controller.ts';

export interface PngThumbnailLimits {
  /** Longest side of the thumbnail in pixels. A source already within it keeps its size. */
  readonly maxSide: number;
  /** Source pixels (width x height) this module will decode. */
  readonly maxSourcePixels: number;
  /** Largest encoded thumbnail in bytes. */
  readonly maxBytes: number;
}

export interface PngThumbnailOptions extends Partial<PngThumbnailLimits> {
  /** Zlib inflate of the concatenated IDAT data, streamed. Injected in tests. */
  readonly inflate?: (parts: readonly Uint8Array[]) => AsyncIterable<Uint8Array>;
}

export interface PngThumbnail {
  readonly bytes: Uint8Array;
  readonly w: number;
  readonly h: number;
}

export const PNG_THUMBNAIL_DEFAULTS: PngThumbnailLimits = Object.freeze({
  maxSide: 512,
  maxSourcePixels: 50_000_000,
  maxBytes: DEFAULT_LIMITS.maxThumbnailBytes,
});

const MAX_SOURCE_SIDE = 32_768;
/** Keeps the bin accumulators bounded whatever options a caller passes (2048 x 2048 bins). */
const MAX_TARGET_SIDE = 2048;
const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const;
const STORED_BLOCK = 65_535;

// ------------------------------------------------------------------------------ checksums

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(parts: readonly Uint8Array[]): number {
  let crc = 0xffffffff;
  for (const part of parts) for (let i = 0; i < part.length; i += 1) crc = CRC_TABLE[(crc ^ part[i]!) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function adler32(bytes: Uint8Array): number {
  let a = 1;
  let b = 0;
  // 5552 is the largest block for which the sums cannot overflow 32 bits before the modulo.
  for (let start = 0; start < bytes.length; start += 5552) {
    const end = Math.min(start + 5552, bytes.length);
    for (let i = start; i < end; i += 1) { a += bytes[i]!; b += a; }
    a %= 65_521;
    b %= 65_521;
  }
  return ((b << 16) | a) >>> 0;
}

// ------------------------------------------------------------------------------ parse

interface Header {
  readonly width: number;
  readonly height: number;
  readonly colorType: 0 | 2 | 3 | 4 | 6;
  readonly channels: number;
}

interface Parsed extends Header {
  /** RGBA per palette index (colour type 3 only). */
  readonly palette: Uint8Array | null;
  readonly idat: readonly Uint8Array[];
}

const CHANNELS: Readonly<Record<number, number>> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

const chunkType = (bytes: Uint8Array, at: number): string => String.fromCharCode(bytes[at]!, bytes[at + 1]!, bytes[at + 2]!, bytes[at + 3]!);

/** Parses the supported subset. Returns `null` for anything else, including damage. */
function parsePng(source: Uint8Array, maxSourcePixels: number): Parsed | null {
  if (source.length < 8 + 25 + 12) return null;
  for (let i = 0; i < 8; i += 1) if (source[i] !== SIGNATURE[i]) return null;
  const view = new DataView(source.buffer, source.byteOffset, source.byteLength);
  let header: Header | null = null;
  let paletteRgb: Uint8Array | null = null;
  let trns: Uint8Array | null = null;
  const idat: Uint8Array[] = [];
  let idatDone = false;
  let ended = false;
  let at = 8;
  let first = true;
  while (!ended) {
    if (at + 12 > source.length) return null;
    const length = view.getUint32(at);
    const end = at + 12 + length;
    if (length > 0x7fffffff || end > source.length) return null;
    const type = chunkType(source, at + 4);
    const data = source.subarray(at + 8, at + 8 + length);
    if (crc32([source.subarray(at + 4, at + 8), data]) !== view.getUint32(at + 8 + length)) return null;
    if (first && type !== 'IHDR') return null;
    first = false;
    if (type === 'IHDR') {
      if (header !== null || length !== 13) return null;
      const width = view.getUint32(at + 8);
      const height = view.getUint32(at + 12);
      const [depth, colorType, compression, filter, interlace] = [data[8]!, data[9]!, data[10]!, data[11]!, data[12]!];
      if (width < 1 || height < 1 || width > MAX_SOURCE_SIDE || height > MAX_SOURCE_SIDE || width * height > maxSourcePixels) return null;
      if (depth !== 8 || !(colorType in CHANNELS) || compression !== 0 || filter !== 0 || interlace !== 0) return null;
      header = { width, height, colorType: colorType as Header['colorType'], channels: CHANNELS[colorType]! };
    } else if (header === null) {
      return null;
    } else if (type === 'PLTE') {
      if (paletteRgb !== null || idat.length > 0 || length === 0 || length % 3 !== 0 || length > 768) return null;
      // A palette is never allowed with grey colour types.
      if (header.colorType === 0 || header.colorType === 4) return null;
      paletteRgb = data;
    } else if (type === 'tRNS') {
      // Colour keys on grey and RGB are not supported; alpha colour types may not carry one.
      if (header.colorType !== 3 || trns !== null || idat.length > 0 || paletteRgb === null || length > paletteRgb.length / 3) return null;
      trns = data;
    } else if (type === 'IDAT') {
      if (idatDone) return null;
      idat.push(data);
    } else if (type === 'IEND') {
      if (length !== 0) return null;
      ended = true;
    } else if ((type.charCodeAt(0) & 0x20) === 0) {
      // An unknown critical chunk changes how the image must be read.
      return null;
    }
    // IDAT chunks must be contiguous: any other chunk after the first one closes the run.
    if (type !== 'IDAT' && idat.length > 0) idatDone = true;
    at = end;
  }
  if (header === null || idat.length === 0) return null;
  let palette: Uint8Array | null = null;
  if (header.colorType === 3) {
    if (paletteRgb === null) return null;
    const entries = paletteRgb.length / 3;
    palette = new Uint8Array(entries * 4);
    for (let i = 0; i < entries; i += 1) {
      palette[i * 4] = paletteRgb[i * 3]!;
      palette[i * 4 + 1] = paletteRgb[i * 3 + 1]!;
      palette[i * 4 + 2] = paletteRgb[i * 3 + 2]!;
      palette[i * 4 + 3] = trns !== null && i < trns.length ? trns[i]! : 255;
    }
  }
  return { ...header, palette, idat };
}

// ------------------------------------------------------------------------------ inflate

async function* inflateWithPlatform(parts: readonly Uint8Array[]): AsyncGenerator<Uint8Array, void, undefined> {
  const input = new ReadableStream<Uint8Array<ArrayBuffer>>({
    start(controller) {
      for (const part of parts) controller.enqueue(part as Uint8Array<ArrayBuffer>);
      controller.close();
    },
  });
  const reader = input.pipeThrough(new DecompressionStream('deflate')).getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return;
      yield value;
    }
  } finally {
    // An early stop (more output than promised) must release the stream; a failure to cancel changes nothing.
    try { await reader.cancel(); } catch { /* already closed or errored */ }
  }
}

// ------------------------------------------------------------------------------ resample

/** `floor(numerator / denominator)` for non-negative integers below 2^53, immune to rounding in the division. */
function floorDiv(numerator: number, denominator: number): number {
  let q = Math.floor(numerator / denominator);
  if (q * denominator > numerator) q -= 1;
  else if ((q + 1) * denominator <= numerator) q += 1;
  return q;
}

function targetSize(w: number, h: number, maxSide: number): { tw: number; th: number } {
  const long = Math.max(w, h);
  if (long <= maxSide) return { tw: w, th: h };
  return { tw: Math.max(1, floorDiv(w * maxSide, long)), th: Math.max(1, floorDiv(h * maxSide, long)) };
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

/** Reverses a scanline filter in place. `row[0]` is the filter byte; pixel bytes start at 1. Returns false for an unknown filter. */
function unfilter(row: Uint8Array, prev: Uint8Array, bpp: number): boolean {
  const type = row[0]!;
  const length = row.length;
  switch (type) {
    case 0: return true;
    case 1: for (let i = 1 + bpp; i < length; i += 1) row[i] = (row[i]! + row[i - bpp]!) & 0xff; return true;
    case 2: for (let i = 1; i < length; i += 1) row[i] = (row[i]! + prev[i]!) & 0xff; return true;
    case 3:
      for (let i = 1; i < length; i += 1) row[i] = (row[i]! + (((i > bpp ? row[i - bpp]! : 0) + prev[i]!) >> 1)) & 0xff;
      return true;
    case 4:
      for (let i = 1; i < length; i += 1) row[i] = (row[i]! + paeth(i > bpp ? row[i - bpp]! : 0, prev[i]!, i > bpp ? prev[i - bpp]! : 0)) & 0xff;
      return true;
    default: return false;
  }
}

interface Bins {
  readonly count: Uint32Array;
  readonly a: Float64Array;
  readonly r: Float64Array;
  readonly g: Float64Array;
  readonly b: Float64Array;
}

/** Adds one unfiltered scanline to the bins of target row `ty`. */
function accumulate(row: Uint8Array, parsed: Parsed, columns: Uint32Array, bins: Bins, ty: number, tw: number): void {
  const { width, colorType, palette } = parsed;
  const base = ty * tw;
  for (let x = 0; x < width; x += 1) {
    let r: number; let g: number; let b: number; let a: number;
    switch (colorType) {
      case 0: r = g = b = row[1 + x]!; a = 255; break;
      case 2: r = row[1 + x * 3]!; g = row[2 + x * 3]!; b = row[3 + x * 3]!; a = 255; break;
      case 3: {
        const index = row[1 + x]! * 4;
        if (index >= palette!.length) throw new RangeError('palette index out of range');
        r = palette![index]!; g = palette![index + 1]!; b = palette![index + 2]!; a = palette![index + 3]!;
        break;
      }
      case 4: r = g = b = row[1 + x * 2]!; a = row[2 + x * 2]!; break;
      default: r = row[1 + x * 4]!; g = row[2 + x * 4]!; b = row[3 + x * 4]!; a = row[4 + x * 4]!;
    }
    const bin = base + columns[x]!;
    bins.count[bin]! += 1;
    bins.a[bin]! += a;
    bins.r[bin]! += r * a;
    bins.g[bin]! += g * a;
    bins.b[bin]! += b * a;
  }
}

async function downsample(parsed: Parsed, tw: number, th: number, inflate: NonNullable<PngThumbnailOptions['inflate']>): Promise<Uint8Array | null> {
  const { width, height, channels } = parsed;
  const rowLength = 1 + width * channels;
  const expected = height * rowLength;
  const columns = new Uint32Array(width);
  for (let x = 0; x < width; x += 1) columns[x] = floorDiv(x * tw, width);
  const cells = tw * th;
  const bins: Bins = { count: new Uint32Array(cells), a: new Float64Array(cells), r: new Float64Array(cells), g: new Float64Array(cells), b: new Float64Array(cells) };
  let prev = new Uint8Array(rowLength);
  let row = new Uint8Array(rowLength);
  let filled = 0;
  let received = 0;
  let y = 0;
  const finishRow = (): boolean => {
    if (!unfilter(row, prev, channels)) return false;
    accumulate(row, parsed, columns, bins, floorDiv(y * th, height), tw);
    y += 1;
    [prev, row] = [row, prev];
    filled = 0;
    return true;
  };
  const source = inflate(parsed.idat);
  for await (const chunk of source) {
    received += chunk.length;
    // A decompression bomb: more output than the header can account for.
    if (received > expected) return null;
    let at = 0;
    while (at < chunk.length) {
      const take = Math.min(rowLength - filled, chunk.length - at);
      row.set(chunk.subarray(at, at + take), filled);
      filled += take;
      at += take;
      if (filled === rowLength && !finishRow()) return null;
    }
  }
  if (received !== expected || y !== height) return null;

  const out = new Uint8Array(th * (1 + tw * 4));
  for (let ty = 0; ty < th; ty += 1) {
    const rowAt = ty * (1 + tw * 4);
    out[rowAt] = 0;
    for (let tx = 0; tx < tw; tx += 1) {
      const bin = ty * tw + tx;
      const count = bins.count[bin]!;
      const sumA = bins.a[bin]!;
      if (count === 0) return null;
      const at = rowAt + 1 + tx * 4;
      out[at + 3] = floorDiv(2 * sumA + count, 2 * count);
      if (sumA === 0) continue;
      out[at] = floorDiv(2 * bins.r[bin]! + sumA, 2 * sumA);
      out[at + 1] = floorDiv(2 * bins.g[bin]! + sumA, 2 * sumA);
      out[at + 2] = floorDiv(2 * bins.b[bin]! + sumA, 2 * sumA);
    }
  }
  return out;
}

// ------------------------------------------------------------------------------ encode

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i += 1) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32([out.subarray(4, 8), data]));
  return out;
}

/** A zlib stream of stored (uncompressed) blocks: identical bytes on every platform. */
function zlibStored(raw: Uint8Array): Uint8Array {
  const blocks = Math.max(1, Math.ceil(raw.length / STORED_BLOCK));
  const out = new Uint8Array(2 + blocks * 5 + raw.length + 4);
  const view = new DataView(out.buffer);
  out[0] = 0x78;
  out[1] = 0x01;
  let at = 2;
  for (let start = 0, index = 0; index < blocks; index += 1, start += STORED_BLOCK) {
    const size = Math.min(STORED_BLOCK, raw.length - start);
    out[at] = index === blocks - 1 ? 1 : 0;
    view.setUint16(at + 1, size, true);
    view.setUint16(at + 3, ~size & 0xffff, true);
    out.set(raw.subarray(start, start + size), at + 5);
    at += 5 + size;
  }
  view.setUint32(at, adler32(raw));
  return out;
}

/** Exact byte length of `encodeRgba` for a `w` x `h` image: signature, IHDR, one IDAT of stored blocks, IEND. */
function encodedSize(w: number, h: number): number {
  const raw = h * (1 + w * 4);
  const blocks = Math.max(1, Math.ceil(raw / STORED_BLOCK));
  return 8 + 25 + (12 + 2 + blocks * 5 + raw + 4) + 12;
}

function encodeRgba(raw: Uint8Array, w: number, h: number): Uint8Array {
  const ihdr = new Uint8Array(13);
  const view = new DataView(ihdr.buffer);
  view.setUint32(0, w);
  view.setUint32(4, h);
  ihdr.set([8, 6, 0, 0, 0], 8);
  const parts = [Uint8Array.from(SIGNATURE), pngChunk('IHDR', ihdr), pngChunk('IDAT', zlibStored(raw)), pngChunk('IEND', new Uint8Array(0))];
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let at = 0;
  for (const part of parts) { out.set(part, at); at += part.length; }
  return out;
}

// ------------------------------------------------------------------------------ public

/**
 * The size `pngThumbnail` will produce for a `w` x `h` source: known from the header alone, before any decoding. Lets a
 * caller refuse early when the encoded thumbnail could not fit a budget.
 */
export function pngThumbnailSize(w: number, h: number, maxSide: number = PNG_THUMBNAIL_DEFAULTS.maxSide): { readonly w: number; readonly h: number; readonly bytes: number } | null {
  if (!validLimit(w, 1, MAX_SOURCE_SIDE) || !validLimit(h, 1, MAX_SOURCE_SIDE) || !validLimit(maxSide, 1, MAX_TARGET_SIDE)) return null;
  const { tw, th } = targetSize(w, h, maxSide);
  return { w: tw, h: th, bytes: encodedSize(tw, th) };
}

const validLimit = (value: number, min: number, max: number): boolean => Number.isSafeInteger(value) && value >= min && value <= max;

/** Never throws. `null` means "no thumbnail", for any reason. */
export async function pngThumbnail(source: Uint8Array, options: PngThumbnailOptions = {}): Promise<PngThumbnail | null> {
  try {
    const maxSide = options.maxSide ?? PNG_THUMBNAIL_DEFAULTS.maxSide;
    const maxSourcePixels = options.maxSourcePixels ?? PNG_THUMBNAIL_DEFAULTS.maxSourcePixels;
    const maxBytes = options.maxBytes ?? PNG_THUMBNAIL_DEFAULTS.maxBytes;
    if (!(source instanceof Uint8Array) || !validLimit(maxSide, 1, MAX_TARGET_SIDE) || !validLimit(maxSourcePixels, 1, Number.MAX_SAFE_INTEGER)
      || !validLimit(maxBytes, 1, Number.MAX_SAFE_INTEGER)) return null;
    const parsed = parsePng(source, maxSourcePixels);
    if (parsed === null) return null;
    const { tw, th } = targetSize(parsed.width, parsed.height, maxSide);
    // The stored encoding has a known size: refuse before decoding when it cannot fit.
    if (encodedSize(tw, th) > maxBytes) return null;
    const raw = await downsample(parsed, tw, th, options.inflate ?? inflateWithPlatform);
    if (raw === null) return null;
    const bytes = encodeRgba(raw, tw, th);
    return bytes.length <= maxBytes ? { bytes, w: tw, h: th } : null;
  } catch {
    return null;
  }
}
