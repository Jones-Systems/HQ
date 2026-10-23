/**
 * Minimal PNG codec for fixtures and runtime pixel evidence (test-only).
 * encode: RGBA8, stored (uncompressed) deflate, browser-safe, no dependencies.
 * decode: RGB8/RGBA8, non-interlaced, all five filters; inflate is injected
 * (node:zlib in Node) so this file stays dependency-free.
 */
const SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const byte of bytes) c = CRC_TABLE[(c ^ byte) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function u32(value: number): number[] { return [(value >>> 24) & 255, (value >>> 16) & 255, (value >>> 8) & 255, value & 255]; }

function chunk(type: string, data: Uint8Array): number[] {
  const typed = new Uint8Array([...type].map((c) => c.charCodeAt(0)).concat([...data]));
  return [...u32(data.length), ...typed, ...u32(crc32(typed))];
}

export function encodePng(width: number, height: number, rgba: Uint8Array): Uint8Array {
  const raw = new Uint8Array(height * (width * 4 + 1));
  for (let y = 0; y < height; y += 1) raw.set(rgba.subarray(y * width * 4, (y + 1) * width * 4), y * (width * 4 + 1) + 1);
  const deflate: number[] = [0x78, 0x01];
  for (let offset = 0; offset < raw.length || offset === 0; offset += 65535) {
    const block = raw.subarray(offset, offset + 65535);
    const last = offset + 65535 >= raw.length ? 1 : 0;
    deflate.push(last, block.length & 255, block.length >>> 8, ~block.length & 255, (~block.length >>> 8) & 255, ...block);
  }
  let a = 1; let b = 0;
  for (const byte of raw) { a = (a + byte) % 65521; b = (b + a) % 65521; }
  deflate.push(...u32(((b << 16) | a) >>> 0));
  const header = new Uint8Array([...u32(width), ...u32(height), 8, 6, 0, 0, 0]);
  return new Uint8Array([...SIGNATURE, ...chunk('IHDR', header), ...chunk('IDAT', new Uint8Array(deflate)), ...chunk('IEND', new Uint8Array())]);
}

export interface DecodedPng { readonly width: number; readonly height: number; readonly rgba: Uint8Array }

export function decodePng(bytes: Uint8Array, inflate: (data: Uint8Array) => Uint8Array): DecodedPng {
  if (!SIGNATURE.every((value, index) => bytes[index] === value)) throw new Error('not a PNG');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 8; let width = 0; let height = 0; let channels = 0;
  const idat: Uint8Array[] = [];
  while (offset < bytes.length) {
    const length = view.getUint32(offset);
    const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
    const data = bytes.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      width = view.getUint32(offset + 8); height = view.getUint32(offset + 12);
      const depth = data[8]; const colour = data[9]; const interlace = data[12];
      if (depth !== 8 || (colour !== 2 && colour !== 6) || interlace !== 0) throw new Error('unsupported PNG format');
      channels = colour === 6 ? 4 : 3;
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    offset += 12 + length;
  }
  const joined = new Uint8Array(idat.reduce((sum, part) => sum + part.length, 0));
  let position = 0;
  for (const part of idat) { joined.set(part, position); position += part.length; }
  const raw = inflate(joined);
  const stride = width * channels;
  const pixels = new Uint8Array(height * stride);
  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)];
    for (let x = 0; x < stride; x += 1) {
      const value = raw[y * (stride + 1) + 1 + x]!;
      const left = x >= channels ? pixels[y * stride + x - channels]! : 0;
      const up = y > 0 ? pixels[(y - 1) * stride + x]! : 0;
      const upLeft = y > 0 && x >= channels ? pixels[(y - 1) * stride + x - channels]! : 0;
      let predictor = 0;
      if (filter === 1) predictor = left;
      else if (filter === 2) predictor = up;
      else if (filter === 3) predictor = (left + up) >> 1;
      else if (filter === 4) {
        const p = left + up - upLeft; const pa = Math.abs(p - left); const pb = Math.abs(p - up); const pc = Math.abs(p - upLeft);
        predictor = pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft;
      } else if (filter !== 0) throw new Error(`bad filter ${filter}`);
      pixels[y * stride + x] = (value + predictor) & 255;
    }
  }
  if (channels === 4) return { width, height, rgba: pixels };
  const rgba = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i += 1) { rgba.set(pixels.subarray(i * 3, i * 3 + 3), i * 4); rgba[i * 4 + 3] = 255; }
  return { width, height, rgba };
}

/** Synthetic "capture": four flat quadrants. Known bytes, no private data. */
export const CAPTURE_COLOURS = [[255, 59, 48], [52, 199, 89], [10, 132, 255], [255, 255, 255]] as const;

export function captureFixture(width = 64, height = 40): Uint8Array {
  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const colour = CAPTURE_COLOURS[(y < height / 2 ? 0 : 2) + (x < width / 2 ? 0 : 1)]!;
      rgba.set([...colour, 255], (y * width + x) * 4);
    }
  }
  return encodePng(width, height, rgba);
}

export function pngDataUrl(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return `data:image/png;base64,${btoa(binary)}`;
}
