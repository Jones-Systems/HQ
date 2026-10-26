import assert from 'node:assert/strict';
import { createServer, request } from 'node:http';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { canonical, closedRoute } from './http.mjs';
import { until } from '../runtime.mjs';

// Only the response is faulted. All state and replay decisions belong to Planner.
export async function startPlanner(runtime, repo, observe = () => {}) {
  const directory = join(runtime.root, 'planner');
  await mkdir(directory, { mode: 0o700 });
  const database = join(directory, 'planning.sqlite3');
  const ledger = [], processes = [], pending = new Set();
  let upstream, child, dropCreate = false, log = '';
  observe({ ledger, processes, get log() { return log; } });
  runtime.own('Planner proxy upstream requests', async () => {
    for (const active of pending) active.destroy(new Error('Fixture closing'));
  });
  async function launch() {
    let output = '';
    const started = runtime.spawn('python3', ['-m', 'planning', '--data', database, '--host', '127.0.0.1', '--port', '0'], {
      cwd: join(repo, 'services/planner'), stdio: ['ignore', 'pipe', 'pipe'],
      env: { PATH: process.env.PATH, HOME: directory, TMPDIR: directory, PYTHONDONTWRITEBYTECODE: '1', PYTHONUNBUFFERED: '1' },
    });
    child = started;
    processes.push({ pid: started.pid, database });
    started.stdout.on('data', data => { output = (output + data).slice(-8000); });
    started.stderr.on('data', data => { log = (log + data).slice(-16000); });
    upstream = await until(() => {
      if (started.exitCode !== null || started.signalCode !== null || started.launchError) throw new Error(`Planner startup failed: ${log}`);
      return /http:\/\/127\.0\.0\.1:\d+\//.exec(output)?.[0];
    }, 'owned Planner URL');
    const response = await fetch(new URL('api/version', upstream), { signal: AbortSignal.timeout(5000) });
    assert.equal(response.status, 200);
    assert.ok(Number.isSafeInteger((await response.json()).state_version));
  }
  await launch();
  const server = createServer((req, res) => {
    void (async () => {
      const chunks = []; let size = 0;
      for await (const chunk of req) {
        size += chunk.length;
        if (size > 352 * 1024) throw new Error('Planner fixture body limit');
        chunks.push(chunk);
      }
      const bytes = Buffer.concat(chunks);
      const body = bytes.length ? JSON.parse(bytes.toString('utf8')) : null;
      const entry = { count: ledger.length + 1, method: req.method, path: req.url,
        body: canonical(body), bodyUtf8: bytes.toString('utf8'), requestId: req.headers['x-request-id'] ?? body?.request_id ?? null };
      ledger.push(entry);
      if (!closedRoute('work', req.method, req.url)) { entry.status = 404; res.writeHead(404); res.end(); return; }
      const target = new URL(req.url, upstream);
      const headers = { ...req.headers, host: target.host, 'content-length': String(bytes.length) };
      delete headers['transfer-encoding'];
      const response = await new Promise((resolve, reject) => {
        const outgoing = request(target, { method: req.method, headers }, incoming => {
          const parts = []; let received = 0;
          incoming.on('data', part => {
            received += part.length;
            if (received > 8 * 1024 * 1024) incoming.destroy(new Error('Planner fixture response limit'));
            else parts.push(part);
          });
          incoming.once('error', reject);
          incoming.once('end', () => resolve({ status: incoming.statusCode, headers: incoming.headers, bytes: Buffer.concat(parts) }));
        });
        pending.add(outgoing);
        outgoing.once('close', () => pending.delete(outgoing));
        outgoing.once('error', reject);
        outgoing.setTimeout(5000, () => outgoing.destroy(new Error('Planner upstream timeout')));
        outgoing.end(bytes);
      });
      entry.status = response.status;
      entry.response = JSON.parse(response.bytes.toString('utf8'));
      if (dropCreate && req.method === 'POST' && req.url === '/api/items' && response.status === 201) {
        dropCreate = false; entry.responseLost = true; res.destroy(); return;
      }
      res.writeHead(response.status, response.headers); res.end(response.bytes);
    })().catch(error => { ledger.push({ error: error.message }); res.destroy(); });
  });
  const origin = await runtime.listen(server);
  return {
    origin, ledger, database, processes, get log() { return log; },
    loseNextCreateResponse() { assert.equal(dropCreate, false); dropCreate = true; },
    async state() {
      const response = await fetch(new URL('api/state', upstream), { signal: AbortSignal.timeout(5000) });
      assert.equal(response.status, 200); return response.json();
    },
    async restart() {
      await until(() => pending.size === 0, 'Planner proxy idle before restart');
      await runtime.stop(child);
      await launch();
    },
  };
}
