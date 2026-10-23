import { rmSync } from 'node:fs';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { json, item, state } from './fixtures.mjs';
export { json, item, state };
export const info = { state_version: 8, api: 2, features: ['items.batch_create', 'requests.replay'], request_retention: { max: 2000, evicted_through_version: 0 } };
export const clock = () => new Date('2026-11-01T03:30:00Z');
export function server(handler, version = info) {
  const calls = [];
  const deps = { env: { HQ_PLANNER_URL: 'http://127.0.0.1:3210' }, clock, fetch: async (url, options) => {
    const path = new URL(url).pathname;
    const call = { path, url, ...options, parsed: options.body ? JSON.parse(options.body) : undefined };
    calls.push(call);
    if (options.method === 'GET' && path === '/api/version') return typeof version === 'function' ? version(call) : json(version);
    if (options.method === 'GET' && path === '/api/state') return json(state());
    return handler(call, calls);
  } };
  return { deps, calls, writes: () => calls.filter(c => c.method !== 'GET') };
}
export function replay(overrides = {}) { return { schema: 'hq.planner.replay/v1', request_id: 'request-1234', method: 'POST', path: '/api/items', body_b64: Buffer.from('{"fields":{"title":"Synthetic"}}').toString('base64'), sent_after_version: 8, planner_url: 'http://127.0.0.1:3210', created_at: clock().toISOString(), ...overrides }; }
export const batchSpec = items => ({ schema: 'hq.planner.batch-create/v1', board: 'planner:main', items });
export async function scratch(t) {
  const root = await mkdtemp(resolve(dirname(fileURLToPath(import.meta.url)), '.writes-'));
  const interrupt = () => { rmSync(root, { recursive: true, force: true }); process.exit(130); };
  const terminate = () => { rmSync(root, { recursive: true, force: true }); process.exit(143); };
  process.once('SIGINT', interrupt); process.once('SIGTERM', terminate);
  t.after(async () => { await rm(root, { recursive: true, force: true }); process.removeListener('SIGINT', interrupt); process.removeListener('SIGTERM', terminate); });
  return { root, path: name => resolve(root, name), write: async (name, value) => { const path = resolve(root, name); await writeFile(path, JSON.stringify(value)); return path; }, read: async name => JSON.parse(await readFile(resolve(root, name), 'utf8')) };
}
export function itemReply(call, overrides = {}) { return json({ item: item({ ...(call.parsed?.fields ?? call.parsed?.patch), ...overrides }), state_version: 9 }); }
