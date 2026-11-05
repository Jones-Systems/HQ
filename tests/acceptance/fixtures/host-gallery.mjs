import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { hostname } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRuntime } from '../runtime.mjs';
import { galleryBytes, sha256, startGallery } from './remote-gallery.mjs';

async function processGroupId() {
  let value;
  if (process.platform === 'linux') {
    const stat = await readFile('/proc/self/stat', 'utf8');
    value = stat.slice(stat.lastIndexOf(') ') + 2).split(' ')[2];
  } else {
    // A controller may launch us without detaching: PID is not proof of PGID.
    value = execFileSync('/bin/ps', ['-o', 'pgid=', '-p', String(process.pid)], {
      encoding: 'utf8', timeout: 5000, killSignal: 'SIGKILL', maxBuffer: 1024,
    }).trim();
  }
  assert.match(value ?? '', /^[1-9]\d*$/, 'Host process group must be observed');
  const pgid = Number(value);
  assert.ok(Number.isSafeInteger(pgid), 'Host process group must be a safe integer');
  return pgid;
}

// This control listener belongs only to the synthetic fixture, never HQ.
export async function serveHostGallery(parent, evidence, input = process.stdin) {
  const runtime = await createRuntime(parent);
  const report = { schema: 'hq-gallery-host/v1', runId: randomUUID(), host: hostname(), pid: process.pid,
    root: runtime.root };
  let gallery, finish, watchdog;
  const done = new Promise(resolve => { finish = resolve; });
  const cancel = () => finish('signal');
  const eof = () => finish('controller-closed');
  let mode = 'normal';
  try {
    process.on('SIGTERM', cancel); process.on('SIGINT', cancel);
    input.once('end', eof); input.resume();
    watchdog = setTimeout(() => finish('lifetime-exceeded'), 120000);
    report.pgid = await processGroupId();
    gallery = await startGallery(runtime);
    const snapshot = async () => ({ ...report, origin: gallery.origin, mode, ledger: gallery.ledger,
      digests: await gallery.diskDigests() });
    const control = createServer((req, res) => {
      void (async () => {
        const url = new URL(req.url, 'http://fixture');
        if (req.method === 'POST' && url.pathname === '/mode') {
          const next = url.searchParams.get('value');
          gallery.setMode(next); mode = next;
        } else if (req.method !== 'GET' || url.pathname !== '/snapshot') {
          res.writeHead(404); res.end(); return;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(await snapshot()));
      })().catch(error => { res.writeHead(500); res.end(JSON.stringify({ error: error.message })); });
    });
    report.controlOrigin = await runtime.listen(control);
    Object.assign(report, await snapshot());
    console.log(JSON.stringify({ event: 'ready', ...report }));
    report.termination = await done;
    Object.assign(report, await snapshot());
    if (report.termination === 'lifetime-exceeded') throw new Error('Host fixture lifetime exceeded');
  } catch (error) { report.error = error.stack ?? error.message; }
  finally {
    clearTimeout(watchdog);
    process.off('SIGTERM', cancel); process.off('SIGINT', cancel); input.off('end', eof); input.pause();
    if (gallery) {
      report.ledger = gallery.ledger;
      try { report.finalDigests = await gallery.diskDigests(); } catch (error) { report.digestError = error.message; }
    }
    try { report.cleanup = await runtime.close(); } catch (error) { report.cleanupError = error.message; }
    await writeFile(evidence, JSON.stringify(report, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    console.log(JSON.stringify({ event: 'closed', ...report }));
  }
  return report;
}

export async function bindHostGallery(path) {
  const binding = JSON.parse(await readFile(path, 'utf8'));
  assert.equal(binding.schema, 'hq-gallery-forward/v1');
  assert.notEqual(binding.host, hostname(), 'Gallery must run on a distinct host');
  for (const value of [binding.origin, binding.controlOrigin]) {
    const url = new URL(value);
    assert.equal(url.protocol, 'http:'); assert.equal(url.hostname, '127.0.0.1');
    assert.equal(url.username + url.password + url.search + url.hash, '');
  }
  const digests = Object.fromEntries(Object.entries(galleryBytes()).map(([path, bytes]) => [path, sha256(bytes)]));
  const observations = [];
  async function control(route, method = 'GET') {
    const response = await fetch(new URL(route, binding.controlOrigin), { method, signal: AbortSignal.timeout(5000) });
    assert.equal(response.status, 200, 'owned host control response');
    const snapshot = await response.json();
    for (const key of ['runId', 'host', 'pid', 'pgid']) assert.equal(snapshot[key], binding[key], `host binding ${key}`);
    assert.deepEqual(snapshot.digests, digests, 'actual remote disk digests');
    observations.push(snapshot); return snapshot;
  }
  const initial = await control('/snapshot');
  assert.equal(initial.mode, 'normal');
  const offset = initial.ledger.length;
  return { origin: binding.origin, digests, binding, observations, distinctHost: true,
    async readLedger() { return (await control('/snapshot')).ledger.slice(offset); },
    async diskDigests() { return (await control('/snapshot')).digests; },
    async setMode(mode) { await control('/mode?value=' + encodeURIComponent(mode), 'POST'); },
    async stop() { await this.setMode('unavailable'); },
    async restore() { await this.setMode('normal'); },
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 5 || process.argv[2] !== '--serve') throw new Error('Usage: host-gallery.mjs --serve <owned-scratch-parent> <new-report-file>');
  const report = await serveHostGallery(resolve(process.argv[3]), resolve(process.argv[4]));
  if (report.error || report.cleanupError || report.digestError) process.exitCode = 1;
}
