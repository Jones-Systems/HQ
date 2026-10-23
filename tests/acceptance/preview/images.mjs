import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { deflateSync } from 'node:zlib';

// Synthetic image-heavy page for scaled-capture rows. Each photo is large enough that Chromium may
// defer its decode, and carries a solid landmark block whose colour a capture must reproduce.
const crcTable = Int32Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
const crc = bytes => { let c = -1; for (const byte of bytes) c = crcTable[(c ^ byte) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; };
function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length), name = Buffer.from(type, 'latin1');
  out.writeUInt32BE(data.length, 0); name.copy(out, 4); data.copy(out, 8);
  out.writeUInt32BE(crc(Buffer.concat([name, data])), 8 + data.length);
  return out;
}
/** Deterministic photo-like RGB PNG: smooth gradients with seeded grain and a central landmark block. */
export function photo(width, height, seed, landmark) {
  const row = width * 3 + 1, raw = Buffer.alloc(row * height);
  let state = seed >>> 0;
  const next = () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state >>> 24; };
  const [bx, by, bw, bh] = [Math.round(width * 0.375), Math.round(height * 0.375), Math.round(width * 0.25), Math.round(height * 0.25)];
  for (let y = 0; y < height; y++) {
    raw[y * row] = 0;
    for (let x = 0; x < width; x++) {
      const at = y * row + 1 + x * 3;
      if (x >= bx && x < bx + bw && y >= by && y < by + bh) { raw[at] = landmark[0]; raw[at + 1] = landmark[1]; raw[at + 2] = landmark[2]; continue; }
      const grain = next() >> 3;
      raw[at] = (40 + (x * 150) / width + 30 * Math.sin((y + seed) / 37) + grain) & 255;
      raw[at + 1] = (60 + (y * 120) / height + 25 * Math.cos((x - seed) / 53) + grain) & 255;
      raw[at + 2] = (90 + ((x + y) * 80) / (width + height) + grain) & 255;
    }
  }
  const header = Buffer.alloc(13); header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(raw, { level: 1 })), chunk('IEND', Buffer.alloc(0))]);
}
export const imageLandmarks = [[200, 40, 60], [40, 180, 90], [50, 70, 210], [220, 190, 40]];
/** CSS px centres of the four photo cells in a 1024×720 viewport (scroll 0). */
export const imageCentres = [[262, 250], [762, 250], [262, 570], [762, 570]];
const page = ({ kind, decoding }) => {
  const attribute = decoding === 'none' ? '' : ` decoding="${decoding}"`;
  const cell = index => kind === 'background'
    ? `<div class="cell" style="background-image:url(/photo/${index}.png)"></div>`
    : `<img class="cell" src="/photo/${kind === 'small' ? 'small-' : ''}${index}.png" alt="Synthetic photo ${index + 1}" width="480" height="300"${attribute}>`;
  return `<!doctype html><html><head><meta charset="utf-8"><title>Synthetic image-heavy page</title><style>*{box-sizing:border-box}html,body{margin:0;background:rgb(246,241,234);color:rgb(40,36,32);font:16px/1.4 Georgia,serif}header{height:100px;padding:28px 22px;font-size:28px}main{display:grid;grid-template-columns:480px 480px;gap:20px;padding:0 22px}.cell{display:block;width:480px;height:300px;background-size:cover}p{margin:18px 22px;max-width:900px}</style></head><body><header>Synthetic portfolio</header><main>${[0, 1, 2, 3].map(cell).join('')}</main><p>${'Static synthetic copy for capture coherence. '.repeat(20)}</p></body></html>`;
};
export function createImageFixture() {
  const photos = new Map();
  const bytes = name => {
    if (!photos.has(name)) {
      const small = name.startsWith('small-'), index = Number(name.replace('small-', ''));
      photos.set(name, small ? photo(240, 150, 11 + index, imageLandmarks[index]) : photo(1600, 1000, 11 + index, imageLandmarks[index]));
    }
    return photos.get(name);
  };
  return (req, res) => {
    const url = new URL(req.url, 'http://fixture');
    const image = /^\/photo\/((?:small-)?[0-3])\.png$/.exec(url.pathname);
    if (image) { res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'max-age=3600' }); res.end(bytes(image[1])); return; }
    if (url.pathname !== '/images') { res.writeHead(404); res.end(); return; }
    const kind = ['img', 'background', 'small'].includes(url.searchParams.get('kind')) ? url.searchParams.get('kind') : 'img';
    const decoding = ['async', 'sync', 'auto', 'none'].includes(url.searchParams.get('decoding')) ? url.searchParams.get('decoding') : 'async';
    res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(page({ kind, decoding }));
  };
}
const digestOf = bytes => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
/**
 * Native row on the image page (viewport 1024×720 at DPR 1, scroll 0). At each scaled placement every
 * capture is accepted with one digest at full viewport resolution, shows each photo's landmark, and leaves
 * the fitted view and the page's metrics as they were. A compositor-only change between the two screenshots
 * is still refused as pixels-unstable. `d` supplies the runner's own host, page and pixel access.
 */
export async function scaledImageCaptures(d, { placements = [{ x: 0, y: 0, width: 704, height: 495 }, { x: 0, y: 0, width: 942, height: 662 }], repeats = 6 } = {}) {
  const rows = [];
  for (const rect of placements) {
    await d.place(rect);
    await d.settle();
    const before = await d.page(), digests = new Set(), outcomes = [];
    for (let i = 0; i < repeats; i++) {
      const result = await d.capture();
      outcomes.push(result.ok ? result.value.captureDigest.slice(7, 19) : result.reason);
      assert.equal(result.ok, true, `Capture ${i + 1}/${repeats} at ${rect.width}×${rect.height} was refused: ${JSON.stringify({ result, outcomes })}`);
      const encoded = (await d.image(result.value.captureId)).split(',')[1], bytes = Buffer.from(encoded, 'base64');
      assert.equal(digestOf(bytes), result.value.captureDigest);
      assert.deepEqual([bytes.readUInt32BE(16), bytes.readUInt32BE(20)], [1024, 720]);
      if (i === 0) assert.deepEqual(await d.pixels(encoded, imageCentres), imageLandmarks.map(rgb => [...rgb, 255]), 'Every photo is present at full resolution');
      digests.add(result.value.captureDigest);
    }
    assert.equal(digests.size, 1, `Repeated captures differ: ${outcomes.join(',')}`);
    const view = await d.view();
    assert.deepEqual(view.bounds, view.fitted.bounds, 'The capture restores the fitted view');
    assert.deepEqual(await d.page(), before, 'Captures change no page metrics and fire no resize or media events');
    rows.push({ rect, view, outcomes });
  }
  // Positive control: the held screenshot pair still sees a compositor-only change made between its shots.
  const blobs = await d.blobWrites();
  await d.pauseAt('first-capture');
  const pending = d.capture(); pending.catch(() => {});
  try { await d.waitForPause(); await d.evaluate("document.querySelector('.cell').animate([{opacity:1},{opacity:0.25}],{duration:1,fill:'forwards'}).finished.then(()=>true)"); }
  finally { await d.resume(); await d.pauseAt(null); }
  const changed = await pending;
  assert.deepEqual([changed.ok, changed.reason], [false, 'pixels-unstable']);
  assert.equal(await d.blobWrites(), blobs, 'A refused capture writes nothing');
  await d.evaluate("(()=>{for(const a of document.getAnimations())a.cancel();return true})()");
  assert.equal((await d.capture()).ok, true, 'Capture anchors again once the page is still');
  return { rows, changed };
}
if (import.meta.url === `file://${process.argv[1]}`) {
  const server = createServer(createImageFixture());
  server.listen(0, '127.0.0.1', () => console.log(`http://127.0.0.1:${server.address().port}`));
}
