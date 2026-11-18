import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
export const GALLERY_TITLE = 'Synthetic acceptance gallery page';
const encode = value => Buffer.from(JSON.stringify(value) + '\n');

// Relative URLs let the same immutable corpus work behind a later SSH forward.
export function galleryBytes() {
  const files = {
    'data/gallery-index.json': encode({ schema: 'gallery-index/v1', projects: [{ id: 'synthetic', name: 'Acceptance collection', sourceType: 'collection',
      entries: [{ id: 'page', title: GALLERY_TITLE, presentationType: 'website', launchHref: 'projects/synthetic/site/index.html' }] }] }),
    'projects/synthetic/data/collection.json': encode({ variations: [{ id: 'page', presentation: { type: 'website', url: 'site/index.html' } }] }),
  };
  const manifest = encode({ schema: 'gallery-registry-export/v1', algorithm: 'sha256', files: Object.fromEntries(Object.entries(files).map(([path, bytes]) => [path, sha256(bytes)])) });
  return { 'registry-export-manifest.json': manifest, ...files,
    'projects/synthetic/site/index.html': Buffer.from('<!doctype html><title>Synthetic gallery</title><p>Owned acceptance fixture.</p>\n') };
}

export async function writeGalleryCorpus(root, { signal } = {}) {
  // Never reuse a directory. Successful output belongs to the caller;
  // failed construction removes only the exact directory created here.
  signal?.throwIfAborted();
  await mkdir(root, { mode: 0o700 });
  const files = galleryBytes();
  try {
    for (const [path, bytes] of Object.entries(files)) {
      signal?.throwIfAborted();
      await mkdir(dirname(join(root, path)), { recursive: true });
      await writeFile(join(root, path), bytes, { flag: 'wx', mode: 0o600 });
    }
    signal?.throwIfAborted();
  } catch (error) {
    try { await rm(root, { recursive: true, force: true }); }
    catch (cleanup) { throw new AggregateError([error, cleanup], 'Gallery construction and cleanup failed', { cause: error }); }
    throw error;
  }
  return { root, files, digests: Object.fromEntries(Object.entries(files).map(([path, bytes]) => [path, sha256(bytes)])) };
}

export async function startGallery(runtime) {
  const corpus = await writeGalleryCorpus(join(runtime.root, 'gallery'));
  const ledger = [];
  let mode = 'normal';
  const server = createServer((req, res) => {
    void (async () => {
      const path = req.url?.slice(1);
      const entry = { count: ledger.length + 1, method: req.method, path: req.url, mode };
      ledger.push(entry);
      if (req.method !== 'GET' || !Object.hasOwn(corpus.files, path)) { entry.status = 404; res.writeHead(404); res.end(); return; }
      if (mode === 'unavailable') { entry.disconnected = true; res.destroy(); return; }
      let bytes = await readFile(join(corpus.root, path));
      if (mode === 'malformed' && path === 'registry-export-manifest.json') bytes = Buffer.from('{');
      if (mode === 'bad-digest' && path === 'data/gallery-index.json') bytes = Buffer.concat([bytes, Buffer.from(' ')]);
      entry.status = 200; entry.bytes = bytes.length; entry.sha256 = sha256(bytes);
      res.writeHead(200, { 'Content-Type': path.endsWith('.json') ? 'application/json' : 'text/html', 'Content-Length': bytes.length });
      res.end(bytes);
    })().catch(error => { ledger.push({ error: error.message }); res.destroy(); });
  });
  const origin = await runtime.listen(server);
  return { ...corpus, origin: origin + '/', ledger,
    setMode(next) {
      if (!['normal', 'bad-digest', 'malformed', 'unavailable'].includes(next)) throw new Error('Unknown gallery mode');
      mode = next;
    },
    async stop() {
      server.closeAllConnections();
      if (server.listening) await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    },
    async diskDigests() { return Object.fromEntries(await Promise.all(Object.keys(corpus.files).map(async path => [path, sha256(await readFile(join(corpus.root, path)))]))); },
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 4 || process.argv[2] !== '--write-corpus') throw new Error('Usage: remote-gallery.mjs --write-corpus <new-owned-directory>');
  const controller = new AbortController();
  const cancel = () => controller.abort(new Error('Gallery export cancelled'));
  process.on('SIGINT', cancel); process.on('SIGTERM', cancel);
  try {
    const corpus = await writeGalleryCorpus(resolve(process.argv[3]), { signal: controller.signal });
    console.log(JSON.stringify({ schema: 'hq.synthetic-gallery/v1', root: corpus.root, digests: corpus.digests, hostQualification: 'unmeasured', cleanupOwner: 'invoking operator' }, null, 2));
  } catch (error) {
    console.error(error.stack ?? error.message); process.exitCode = controller.signal.aborted ? 130 : 1;
  } finally { process.off('SIGINT', cancel); process.off('SIGTERM', cancel); }
}
