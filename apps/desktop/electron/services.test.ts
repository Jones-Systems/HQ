import { afterEach, describe, expect, it, vi } from 'vitest';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { SOCIAL_SERVICE_ROUTES, WORK_SERVICE_ROUTES } from '@hq/contracts/services';
import { allowedSender, CHANNELS, createServices, encodeSocial, encodeWork, LIMITS, sendHttp, SOCIAL_PATHS, WORK_METHODS, type Transport } from './services';
import { endpoint, openServiceConfig, type ServiceConfig } from './service-config';

const dirs: string[] = [];
afterEach(async () => { vi.useRealTimers(); await Promise.all(dirs.splice(0).map(d => rm(d, { recursive: true, force: true }))); });
const config: ServiceConfig = { get: () => new URL('http://127.0.0.1'), status: () => ({ configured: true, policy: 'ok', transport: 'loopback-http' }), set: async () => ({ configured: true, policy: 'ok', transport: 'loopback-http' }) };
const ok = (body: unknown, status = 200) => ({ ok: true as const, status, body, replayed: false });
const original = { route: 'create' as const, params: { requestId: 'request-1234', fields: { title: 'Example', notes: 'é' } } };
const unavailable = { ok: false, kind: 'unavailable' };

it('closed route key sets and reserved Wiki channel; unknown route/params never send', async () => {
  expect(Object.keys(WORK_METHODS)).toEqual([...WORK_SERVICE_ROUTES]);
  expect(Object.keys(SOCIAL_PATHS)).toEqual([...SOCIAL_SERVICE_ROUTES]);
  expect(CHANNELS.wiki).toBe('hq:svc:wiki');
  const transport = vi.fn<Transport>(); const svc = createServices(config, transport);
  for (const [route, params] of [['delete', {}], ['state', { url: 'https://example.test' }], ['item', { id: '../bad' }], ['create', { ...original.params, header: 'x' }], ['create', { requestId: 'bad', fields: {} }], ['create', { ...original.params, fields: { bad: undefined } }]]) expect(await svc.work(route, params)).toEqual(unavailable);
  for (const [route, params] of [['other', {}], ['workspace', { token: 'secret' }], ['saveContent', { title: 'x', links: [] }], ['submitRun', { tool: 'tool', input: {}, is_example: true, requestId: 'invented' }]]) expect(await svc.social(route, params)).toEqual(unavailable);
  expect(transport).not.toHaveBeenCalled();
  expect(await createServices({ ...config, get: () => null }, transport).work('state', {})).toEqual(unavailable);
});
it('pins Work paths, bodies, headers and omits unsupplied move place', async () => {
  const transport = vi.fn<Transport>().mockResolvedValue(ok(null)); const svc = createServices(config, transport);
  const cases = [
    ['state', {}, 'GET', '/api/state', undefined], ['version', {}, 'GET', '/api/version', undefined],
    ['item', { id: 'item123' }, 'GET', '/api/items/item123', undefined], ['history', { id: 'item123' }, 'GET', '/api/items/item123/history', undefined],
    ['create', original.params, 'POST', '/api/items', { fields: original.params.fields }],
    ['patch', { requestId: 'request-1234', id: 'item123', revision: 1, patch: { title: 'New' } }, 'PATCH', '/api/items/item123', { revision: 1, patch: { title: 'New' } }],
    ['move', { requestId: 'request-1234', id: 'item123', revision: 1, status: 'active' }, 'POST', '/api/items/item123/move', { revision: 1, status: 'active' }],
    ...['archive', 'restore', 'reviewed'].map(route => [route, { requestId: 'request-1234', id: 'item123', revision: 1 }, 'POST', '/api/items/item123/' + route, { revision: 1 }]),
    ['settings', { requestId: 'request-1234', settings: { stale_days: 21 } }, 'PUT', '/api/settings', { settings: { stale_days: 21 } }],
  ];
  for (const [route, params, method, path, body] of cases) {
    await svc.work(route, params); const [url, call] = transport.mock.calls.at(-1)!;
    expect(url.pathname).toBe(path); expect(call.method).toBe(method);
    expect(call.body ? JSON.parse(call.body) : undefined).toEqual(body);
    expect(call.headers).toEqual(body ? { Accept: 'application/json', 'Content-Type': 'application/json', 'X-Planning-Request': '1', 'X-Request-Id': 'request-1234' } : { Accept: 'application/json' });
  }
});
it('replay preserves original bytes, exact key set, request ID equality, baseline and loss semantics', async () => {
  const transport = vi.fn<Transport>().mockResolvedValue(ok(null)); const svc = createServices(config, transport);
  await svc.work(original.route, original.params); const first = transport.mock.calls[0]![1];
  await svc.work('replay', { mode: 'resend', requestId: original.params.requestId, original, sentAfterVersion: 0 });
  const [url, replay] = transport.mock.calls[1]!; const body = JSON.parse(replay.body!);
  expect(url.pathname).toBe('/api/requests/replay'); expect(replay.method).toBe('POST');
  expect(replay.headers).toEqual({ Accept: 'application/json', 'Content-Type': 'application/json', 'X-Planning-Request': '1' });
  expect(Object.keys(body).sort()).toEqual(['mode', 'request_id', 'method', 'path', 'body_b64', 'sent_after_version'].sort());
  expect(Buffer.from(body.body_b64, 'base64').toString()).toBe(first.body); expect(body.sent_after_version).toBe(0);
  const lookup = encodeWork('replay', { mode: 'lookup', requestId: original.params.requestId, original })!;
  expect(lookup.loss).toBe('unavailable'); expect(JSON.parse(lookup.body!)).not.toHaveProperty('sent_after_version'); expect(replay.loss).toBe('unknown');
  expect(await svc.work('replay', { mode: 'resend', requestId: 'different-id', original })).toEqual(unavailable);
  expect(await svc.work('replay', { mode: 'lookup', requestId: original.params.requestId, original, sentAfterVersion: -1 })).toEqual(unavailable);
  expect(transport).toHaveBeenCalledTimes(2);
});
it('checks exact original and replay caps before sending, including multibyte inputs', () => {
  const overhead = Buffer.byteLength(encodeWork('create', { requestId: 'request-1234', fields: { title: '' } })!.body!);
  const params = { requestId: 'request-1234', fields: { title: 'a'.repeat(LIMITS.work - overhead) } };
  expect(Buffer.byteLength(encodeWork('create', params)!.body!)).toBe(256 * 1024);
  const replay = encodeWork('replay', { mode: 'resend', requestId: params.requestId, original: { route: 'create', params } });
  expect(Buffer.byteLength(replay!.body!)).toBeLessThanOrEqual(352 * 1024);
  params.fields.title += 'é'; expect(encodeWork('create', params)).toBeNull();
  expect(encodeWork('replay', { mode: 'lookup', requestId: params.requestId, original: { route: 'create', params } })).toBeNull();
  expect(encodeSocial('addBrand', { name: 'x'.repeat(2_000_000 - 11) })).not.toBeNull();
  expect(encodeSocial('addBrand', { name: 'x'.repeat(2_000_000 - 10) })).toBeNull();
});
it('Social strips csrf, obtains initial token, refreshes only exact rejection once, never resends submitRun', async () => {
  for (const route of ['addBrand', 'submitRun'] as const) {
    const rejection = ok({ error: 'Reload the workspace before saving' }, 403);
    const transport = vi.fn<Transport>().mockResolvedValueOnce(ok({ csrf: 'one', brands: [] })).mockResolvedValueOnce(rejection).mockResolvedValueOnce(ok({ csrf: 'two', brands: [] })).mockResolvedValueOnce(ok({ id: 'saved12' }));
    const svc = createServices(config, transport);
    const result = await svc.social(route, route === 'addBrand' ? { name: 'Example' } : { tool: 'x-studio', input: {}, is_example: true });
    expect(transport).toHaveBeenCalledTimes(route === 'submitRun' ? 2 : 4);
    expect(transport.mock.calls[1]![1].headers['X-Workspace-Token']).toBe('one');
    if (route === 'addBrand') { expect(transport.mock.calls[3]![1].headers['X-Workspace-Token']).toBe('two'); expect(result).toEqual(ok({ id: 'saved12' })); }
    else expect(result).toEqual(rejection);
  }
  const transport = vi.fn<Transport>().mockResolvedValue(ok({ csrf: 'never-render', brands: [] }));
  expect(await createServices(config, transport).social('workspace', {})).toEqual(ok({ brands: [] }));
});
it('Social non-token 403 never refreshes, failed refresh preserves original 403, lost retry is unknown', async () => {
  for (const error of ['Unrecognized host', 'Cross-origin request refused', 'Cross-site request refused']) {
    const transport = vi.fn<Transport>().mockResolvedValueOnce(ok({ csrf: 'one' })).mockResolvedValue(ok({ error }, 403));
    expect(await createServices(config, transport).social('addBrand', { name: 'Example' })).toEqual(ok({ error }, 403)); expect(transport).toHaveBeenCalledTimes(2);
  }
  const rejection = ok({ error: 'Reload the workspace before saving' }, 403);
  const transport = vi.fn<Transport>().mockResolvedValueOnce(ok({ csrf: 'one' })).mockResolvedValueOnce(rejection).mockResolvedValueOnce({ ok: false, kind: 'unavailable' });
  expect(await createServices(config, transport).social('addBrand', { name: 'Example' })).toEqual(rejection);
  const retry = vi.fn<Transport>().mockResolvedValueOnce(ok({ csrf: 'one' })).mockResolvedValueOnce(rejection).mockResolvedValueOnce(ok({ csrf: 'two' })).mockResolvedValue({ ok: false, kind: 'unknown' });
  expect(await createServices(config, retry).social('addBrand', { name: 'Example' })).toEqual({ ok: false, kind: 'unknown' }); expect(retry).toHaveBeenCalledTimes(4);
});
it('endpoint policy and persisted status expose neither origin nor URL', async () => {
  for (const value of ['https://example.test', 'http://localhost:9000', 'http://127.0.0.1:9000', 'http://[::1]:9000']) expect(endpoint(value)).not.toBeNull();
  for (const value of ['http://example.test', 'http://127.0.0.2', 'file:///x', 'https://user:pass@example.test', 'https://example.test?q=1']) expect(endpoint(value)).toBeNull();
  await mkdir('.t3/shared-host', { recursive: true });
  const root = await mkdtemp(join(process.cwd(), '.t3/shared-host/config-')); dirs.push(root);
  const cfg = await openServiceConfig(root); expect(cfg.status('social')).toEqual({ configured: false, policy: 'ok', transport: null });
  await cfg.set({ domain: 'social', baseUrl: 'https://example.test' });
  expect((await openServiceConfig(root)).status('social')).toEqual({ configured: true, policy: 'ok', transport: 'https' });
  expect(Object.keys(cfg.status('social')).sort()).toEqual(['configured', 'policy', 'transport']);
  await cfg.set({ domain: 'social', baseUrl: 'http://example.test' }); expect(cfg.get('social')).toBeNull(); expect(cfg.status('social').policy).toBe('rejected');
});
it('same-realm convention is not hard isolation: sender must be current main frame at exact app origin', () => {
  const frame = { url: 'file:///app/dist/index.html' }, contents = { mainFrame: frame };
  expect(allowedSender({ sender: contents, senderFrame: frame }, contents, frame.url, null)).toBe(true);
  expect(allowedSender({ sender: contents, senderFrame: { ...frame } }, contents, frame.url, null)).toBe(false);
  frame.url = 'https://foreign.test'; expect(allowedSender({ sender: contents, senderFrame: frame }, contents, 'file:///app/dist/index.html', null)).toBe(false);
  frame.url = 'http://127.0.0.1:5173/route'; expect(allowedSender({ sender: contents, senderFrame: frame }, contents, '', 'http://127.0.0.1:5173')).toBe(true);
});

describe('actual loopback HTTP transport', () => {
  async function server(handler: Parameters<typeof createServer>[0]) {
    const srv = createServer(handler); await new Promise<void>(r => srv.listen(0, '127.0.0.1', r));
    const address = srv.address() as { port: number };
    return { url: new URL(`http://127.0.0.1:${address.port}`), close: async () => { srv.closeAllConnections(); await new Promise<void>((r, reject) => srv.close(e => e ? reject(e) : r())); } };
  }
  it('all HTTP statuses are ok:true; empty and replay headers preserved; redirects not followed, no cookies', async () => {
    const received: string[] = [];
    const srv = await server((req, res) => { received.push(req.url!); expect(req.headers.cookie).toBeUndefined(); const status = Number(req.url!.slice(1)); res.writeHead(status, { 'X-Replayed': '1', Location: '/200', 'Set-Cookie': 'secret=x' }); res.end(status === 204 ? '' : JSON.stringify({ status })); });
    try { for (const status of [200, 204, 302, 400, 403, 404, 409, 422, 500]) expect(await sendHttp(new URL('/' + status, srv.url), { method: 'GET', path: '', headers: {}, loss: 'unavailable' })).toEqual({ ok: true, status, body: status === 204 ? null : { status }, replayed: true }); expect(received).toHaveLength(9); } finally { await srv.close(); }
  });
  it('malformed, oversized and reset Work reads unavailable, writes unknown; Social reads unknown after send', async () => {
    for (const payload of ['not json', 'x'.repeat(LIMITS.response + 1), null]) {
      const srv = await server((_req, res) => { if (payload === null) res.destroy(); else res.end(payload); });
      try { for (const [method, loss] of [['GET', 'unavailable'], ['POST', 'unknown'], ['GET', 'unknown']] as const) expect(await sendHttp(srv.url, { method, path: '/', headers: {}, loss })).toEqual({ ok: false, kind: loss }); } finally { await srv.close(); }
    }
  });
  it('connection refused before send is unavailable even for writes', async () => {
    const srv = await server((_req, res) => res.end('{}')); const url = srv.url; await srv.close();
    expect(await sendHttp(url, { method: 'POST', path: '/', headers: {}, body: '{}', loss: 'unknown' })).toEqual(unavailable);
  });
  it('whole-response timeouts are 10s reads / 20s writes, with fake timers', async () => {
    for (const [method, path, loss, timeout] of [['GET', '/', 'unavailable', 10_000], ['POST', '/', 'unknown', 20_000], ['POST', '/api/requests/replay', 'unavailable', 10_000]] as const) {
      let arrived!: () => void; const incoming = new Promise<void>(r => { arrived = r; });
      const srv = await server(() => arrived());
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      try { const result = sendHttp(srv.url, { method, path, headers: {}, loss }); await incoming; await vi.advanceTimersByTimeAsync(timeout); expect(await result).toEqual({ ok: false, kind: loss }); } finally { vi.useRealTimers(); await srv.close(); }
    }
  });
});
it('transport rejection never retries and preserves write/replay uncertainty', async () => {
  const transport = vi.fn<Transport>().mockRejectedValue(new Error('lost'));
  const svc = createServices(config, transport);
  expect(await svc.work('create', original.params)).toEqual({ ok: false, kind: 'unknown' });
  expect(await svc.work('state', {})).toEqual(unavailable);
  expect(await svc.work('replay', { requestId: original.params.requestId, original, mode: 'lookup' })).toEqual(unavailable);
  expect(await svc.work('replay', { requestId: original.params.requestId, original, mode: 'resend' })).toEqual({ ok: false, kind: 'unknown' });
  expect(transport).toHaveBeenCalledTimes(4);
});
it('invalid outbound headers fail before send and clear the timeout', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  expect(await sendHttp(new URL('http://127.0.0.1:1'), { method: 'POST', path: '/', body: '{}', headers: { 'X-Workspace-Token': '\u1234' }, loss: 'unknown' })).toEqual(unavailable);
  expect(vi.getTimerCount()).toBe(0);
});
