import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export const canonical = value => Array.isArray(value) ? '[' + value.map(canonical).join(',') + ']'
  : value !== null && typeof value === 'object' ? '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}' : JSON.stringify(value);
const modes = new Set(['normal', 'applied-but-response-lost', 'not-applied', 'malformed', 'unavailable', 'indeterminate']);
const id = '[A-Za-z0-9_-]{6,40}';
export function closedRoute(domain, method, path) {
  const routes = domain === 'work' ? [
    ['GET', /^\/api\/(state|version|export)$/], ['GET', new RegExp(`^/api/items/${id}(/history)?$`)],
    ['POST', /^\/api\/(items|requests\/replay)$/], ['PUT', /^\/api\/settings$/],
    ['PATCH', new RegExp(`^/api/items/${id}$`)], ['POST', new RegExp(`^/api/items/${id}/(move|archive|restore|reviewed)$`)],
  ] : [['GET', /^\/api\/workspace$/], ['GET', /^\/api\/sample\/[A-Za-z0-9_-]{1,100}$/],
    ['GET', new RegExp(`^/api/runs/${id}$`)], ['POST', /^\/api\/(content|brands|runs)$/]];
  return routes.some(([verb, pattern]) => method === verb && pattern.test(path));
}

// A scripted wire fixture, not a replacement Planner. Scripts supply exact service
// responses; only Planner's retained service records persist, never client intent.
export async function startFixture(runtime, domain, { reads = {}, recordsName = domain } = {}) {
  if (!['work', 'social'].includes(domain) || !/^[a-z-]+$/.test(recordsName)) throw new Error('Invalid fixture identity');
  const file = join(runtime.root, `${recordsName}-records.json`);
  let records = {};
  try { records = JSON.parse(await readFile(file, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const ledger = [], scripts = [];
  const socialState = structuredClone(reads['/api/workspace']?.body ?? { brands: [], content: [], runs: [], tools: [], csrf: 'synthetic-acceptance-token', features: [] });
  let queue = Promise.resolve();
  const server = createServer((req, res) => {
    const handle = async () => {
      let text = '', oversized = false;
      for await (const chunk of req) { text += chunk; if (Buffer.byteLength(text) > 352 * 1024) { oversized = true; break; } }
      let body = null;
      try { if (text) body = JSON.parse(text); } catch { body = { invalidJSON: true }; }
      const requestId = req.headers['x-request-id'] ?? body?.request_id ?? null;
      const entry = { method: req.method, path: req.url, body: canonical(body), requestId, count: ledger.length + 1 };
      ledger.push(entry);
      const send = (status, value, replayed = false) => {
        res.writeHead(status, { 'Content-Type': 'application/json', ...(replayed ? { 'X-Replayed': '1' } : {}) });
        res.end(JSON.stringify(value));
      };
      if (oversized) return send(413, { error: 'fixture_request_limit' });
      if (!closedRoute(domain, req.method, req.url)) return send(404, { error: 'fixture_closed_route' });
      const scripted = scripts[0];
      if (scripted && (scripted.method !== req.method || scripted.path !== req.url || (scripted.body !== undefined && canonical(scripted.body) !== entry.body))) {
        return send(409, { error: 'fixture_script_mismatch' });
      }
      const script = scripted ? scripts.shift() : { mode: 'normal' };
      const mutation = req.method !== 'GET' && req.url !== '/api/requests/replay';
      if (script.mode === 'unavailable' || script.mode === 'not-applied') return req.socket.destroy();
      if (domain === 'work' && req.url === '/api/requests/replay' && script.response === undefined) {
        const original = { method: body?.method, path: body?.path, body: body?.body_b64 };
        const retained = records[requestId];
        if (retained && canonical(retained.original) !== canonical(original)) return send(409, { error: 'request_id_reuse' });
        if (retained) return send(200, { outcome: 'replayed', status: retained.status, response: retained.body }, true);
        if (script.mode === 'indeterminate' || !Number.isSafeInteger(body?.sent_after_version)) return send(409, {
          error: 'replay_indeterminate', message: 'Read back before attempting another change.',
          sent_after_version: body?.sent_after_version ?? null, evicted_through_version: 0,
        });
        if (body?.mode === 'lookup') return send(200, { outcome: 'not_applied' });
        return send(503, { error: 'fixture_resend_requires_script' });
      }
      let response = script.response ?? (domain === 'social' && req.url === '/api/workspace' ? { status: 200, body: socialState } : reads[req.url]);
      if (domain === 'work' && req.method === 'GET' && !script.response && response) {
        response = structuredClone(response);
        const saved = Object.values(records).filter(record => record.status >= 200 && record.status < 300)
          .sort((a, b) => (a.body.state_version ?? 0) - (b.body.state_version ?? 0));
        for (const record of saved) {
          if (req.url === '/api/state') {
            if (record.body.item) {
              response.body.items = response.body.items.filter(item => item.id !== record.body.item.id);
              response.body.items.push(record.body.item);
            }
            if (record.body.settings) response.body.settings = record.body.settings;
          }
          if (['/api/state', '/api/version'].includes(req.url)) response.body.state_version = Math.max(response.body.state_version, record.body.state_version ?? 0);
        }
      }
      if (!response) return send(503, { error: 'fixture_unscripted_request' });
      if (domain === 'work' && mutation && requestId && response.status >= 200 && response.status < 300 && script.mode !== 'malformed') {
        const original = { method: req.method, path: req.url, body: Buffer.from(text).toString('base64') };
        const retained = records[requestId];
        if (retained) return canonical(retained.original) === canonical(original)
          ? send(retained.status, retained.body, true) : send(409, { error: 'request_id_reuse' });
        records[requestId] = { original, status: response.status, body: response.body };
        await writeFile(file, JSON.stringify(records));
      }
      if (domain === 'social' && mutation && response.status >= 200 && response.status < 300 && script.mode !== 'malformed') {
        const collection = { '/api/brands': 'brands', '/api/content': 'content', '/api/runs': 'runs' }[req.url];
        socialState[collection] = socialState[collection].filter(value => value.id !== response.body.id);
        socialState[collection].push(structuredClone(response.body));
      }
      if (domain === 'work' && req.url === '/api/requests/replay' && response.body?.outcome === 'applied_now') {
        records[requestId] = { original: { method: body.method, path: body.path, body: body.body_b64 },
          status: response.body.status, body: response.body.response };
        await writeFile(file, JSON.stringify(records));
      }
      if (script.mode === 'applied-but-response-lost') return req.socket.destroy();
      if (script.mode === 'malformed') { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end('{'); }
      send(response.status, response.body, response.replayed);
    };
    queue = queue.then(handle).catch(() => { req.socket.destroy(); });
  });
  runtime.own(`${domain} pending requests`, () => queue);
  const origin = await runtime.listen(server);
  return { origin, ledger, server, enqueue(script) {
    if (!modes.has(script.mode ?? 'normal') || !closedRoute(domain, script.method, script.path)) throw new Error('Invalid fixture script');
    scripts.push({ ...structuredClone(script), mode: script.mode ?? 'normal' });
  } };
}
