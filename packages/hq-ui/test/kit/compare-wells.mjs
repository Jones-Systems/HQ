// Compare preserved-well pixels across kit-page captures. Node standard library only.
//   node compare-wells.mjs <rects.json> <label>=<capture.png> ...
// rects.json: {"scale": 1, "corner": 5, "wells": {"id": [x, y, width, height]}, "controls": {"id": [x, y, width, height]}} in CSS px.
// Exits non-zero when any well differs between captures. Controls are expected to differ when the chrome scheme does.
import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { createHash } from 'node:crypto';

function decodePng(path) {
  const data = readFileSync(path);
  if (data.readUInt32BE(0) !== 0x89504e47) throw new Error(`${path}: not a PNG`);
  let offset = 8;
  let width = 0, height = 0, colorType = 0;
  const idat = [];
  while (offset < data.length) {
    const length = data.readUInt32BE(offset);
    const type = data.toString('latin1', offset + 4, offset + 8);
    const body = data.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      width = body.readUInt32BE(0); height = body.readUInt32BE(4);
      const bitDepth = body[8]; colorType = body[9];
      if (bitDepth !== 8 || ![2, 6].includes(colorType) || body[12] !== 0) throw new Error(`${path}: unsupported PNG layout`);
    } else if (type === 'IDAT') idat.push(body);
    else if (type === 'IEND') break;
    offset += 12 + length;
  }
  const channels = colorType === 6 ? 4 : 3;
  const stride = width * channels;
  const raw = inflateSync(Buffer.concat(idat));
  const pixels = Buffer.alloc(height * stride);
  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x += 1) {
      const a = x >= channels ? pixels[y * stride + x - channels] : 0;
      const b = y > 0 ? pixels[(y - 1) * stride + x] : 0;
      const c = x >= channels && y > 0 ? pixels[(y - 1) * stride + x - channels] : 0;
      let value = line[x];
      if (filter === 1) value += a;
      else if (filter === 2) value += b;
      else if (filter === 3) value += (a + b) >> 1;
      else if (filter === 4) { const p = a + b - c; const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); value += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      pixels[y * stride + x] = value & 0xff;
    }
  }
  return { width, height, channels, pixels };
}

/**
 * RGB bytes of a region, so alpha handling cannot hide a colour change. The four corner squares of side `corner`
 * are skipped: a rounded, clipped well shows the surrounding chrome there, which is not well content.
 */
function region(image, [x, y, w, h], scale, corner) {
  const [left, top, right, bottom] = [x, y, x + w, y + h].map((v) => Math.round(v * scale));
  const c = Math.round(corner * scale);
  const out = [];
  for (let row = top; row < bottom; row += 1) {
    for (let col = left; col < right; col += 1) {
      const inCornerX = col < left + c || col >= right - c;
      const inCornerY = row < top + c || row >= bottom - c;
      if (inCornerX && inCornerY) continue;
      const p = (row * image.width + col) * image.channels;
      out.push(image.pixels[p], image.pixels[p + 1], image.pixels[p + 2]);
    }
  }
  return Buffer.from(out);
}

const [rectsPath, ...captureArgs] = process.argv.slice(2);
const rects = JSON.parse(readFileSync(rectsPath, 'utf8'));
const captures = captureArgs.map((arg) => { const [label, path] = arg.split('='); return { label, image: decodePng(path) }; });
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex').slice(0, 12);
let failed = false;
const report = { captures: captures.map(({ label, image }) => ({ label, width: image.width, height: image.height })), wells: {}, controls: {} };
for (const [group, expectSame] of [['wells', true], ['controls', false]]) {
  for (const [id, rect] of Object.entries(rects[group] ?? {})) {
    const digests = Object.fromEntries(captures.map(({ label, image }) => [label, digest(region(image, rect, rects.scale ?? 1, rects.corner ?? 0))]));
    const identical = new Set(Object.values(digests)).size === 1;
    report[group][id] = { identical, digests };
    if (expectSame && !identical) failed = true;
  }
}
console.log(JSON.stringify(report, null, 2));
process.exitCode = failed ? 1 : 0;
