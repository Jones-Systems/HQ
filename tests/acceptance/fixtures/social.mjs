import assert from 'node:assert/strict';
import { createServer, request } from 'node:http';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { until } from '../runtime.mjs';

// Synthetic data, real repository service. No execution route is forwarded.
export async function startSocial(runtime, repo) {
  const directory = join(runtime.root, 'social');
  await mkdir(directory, { mode: 0o700 });
  const ledger = [], pending = new Set();
  let output = '', diagnostic = '', fault;
  const child = runtime.spawn('python3', ['-m', 'social_service', '--data', join(directory, 'data'), '--host', '127.0.0.1', '--port', '0'], {
    cwd: join(repo, 'services/social'), stdio: ['ignore', 'pipe', 'pipe'],
    env: { PATH: process.env.PATH, HOME: directory, TMPDIR: directory, PYTHONDONTWRITEBYTECODE: '1', PYTHONUNBUFFERED: '1' },
  });
  child.stdout.on('data', data => { output = (output + data).slice(-4096); });
  child.stderr.on('data', data => { diagnostic = (diagnostic + data).slice(-4096); });
  runtime.own('Social outgoing requests', async () => { for (const active of pending) active.destroy(); });
  const upstream = await until(() => {
    if (child.exitCode !== null || child.signalCode !== null || child.launchError) throw new Error(`Social startup failed: ${diagnostic}`);
    return /http:\/\/127\.0\.0\.1:\d+\//.exec(output)?.[0];
  }, 'owned Social URL');
  async function state() {
    const response = await fetch(new URL('api/workspace', upstream), { signal: AbortSignal.timeout(5000) });
    assert.equal(response.status, 200);
    const { csrf: _token, ...snapshot } = await response.json();
    return snapshot;
  }
  await state();
  const server = createServer((req, res) => {
    const entry = { count: ledger.length + 1, method: req.method, path: req.url };
    ledger.push(entry);
    void (async () => {
      const chunks = []; let size = 0;
      for await (const chunk of req) {
        size += chunk.length;
        if (size > 2_000_000) throw new Error('Social fixture body limit');
        chunks.push(chunk);
      }
      const bytes = Buffer.concat(chunks);
      const save = req.method === 'POST' && req.url === '/api/content';
      if (!(req.method === 'GET' && req.url === '/api/workspace') && !save) {
        entry.status = 404; res.writeHead(404); res.end('{}'); return;
      }
      if (save) entry.body = JSON.parse(bytes.toString('utf8'));
      if (save && fault === 'reject') {
        fault = undefined; entry.status = 422; entry.rejected = true;
        res.writeHead(422, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Synthetic rejection before save' })); return;
      }
      const target = new URL(req.url, upstream);
      const headers = { ...req.headers, host: target.host, 'content-length': String(bytes.length) };
      delete headers['transfer-encoding'];
      const response = await new Promise((resolve, reject) => {
        const outgoing = request(target, { method: req.method, headers }, incoming => {
          const parts = []; let received = 0;
          incoming.on('data', chunk => {
            received += chunk.length;
            if (received > 8 * 1024 * 1024) incoming.destroy(new Error('Social response limit'));
            else parts.push(chunk);
          });
          incoming.once('error', reject);
          incoming.once('end', () => resolve({ status: incoming.statusCode, bytes: Buffer.concat(parts) }));
        });
        pending.add(outgoing);
        outgoing.once('close', () => pending.delete(outgoing));
        outgoing.once('error', reject);
        outgoing.setTimeout(5000, () => outgoing.destroy(new Error('Social upstream timeout')));
        outgoing.end(bytes);
      });
      entry.status = response.status;
      if (save) entry.response = JSON.parse(response.bytes.toString('utf8'));
      if (save && fault === 'lose' && [200, 201].includes(response.status)) {
        fault = undefined; entry.responseLost = true; res.destroy(); return;
      }
      res.writeHead(response.status, { 'Content-Type': 'application/json' }); res.end(response.bytes);
    })().catch(error => { entry.error = error.message; res.destroy(); });
  });
  return {
    origin: await runtime.listen(server), ledger, state,
    armSave(mode) { assert.ok(['lose', 'reject'].includes(mode)); assert.equal(fault, undefined); fault = mode; },
    async stop() { await until(() => pending.size === 0, 'Social proxy idle'); await runtime.stop(child); },
  };
}
