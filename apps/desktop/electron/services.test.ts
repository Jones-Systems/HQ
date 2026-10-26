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
const socialMutations = [
  ['saveContent', { title: 'Draft', body: '', brand_id: '', channel: '', planned_date: '', archived: 0 }],
  ['addBrand', { name: 'Example' }],
  ['submitRun', { tool: 'x-studio', input: {}, is_example: true }],
] as const;
it.each([['workspace', {}], ['sample', { tool: 'x-studio' }], ['run', { id: 'run123' }]])('Social %s thrown transport is unavailable', async (route, params) => {
  const transport = vi.fn<Transport>().mockRejectedValue(new Error('lost after send'));
  expect(await createServices(config, transport).social(route, params)).toEqual(unavailable);
  expect(transport).toHaveBeenCalledTimes(1);
});
it.each(socialMutations)('Social %s initial token loss never sends a mutation', async (route, params) => {
  const transport = vi.fn<Transport>().mockRejectedValue(new Error('token GET lost'));
  expect(await createServices(config, transport).social(route, params)).toEqual(unavailable);
  expect(transport).toHaveBeenCalledTimes(1);
  expect(transport.mock.calls[0]![1]).toMatchObject({ method: 'GET', path: '/api/workspace', loss: 'unavailable' });
});
it.each(socialMutations)('Social %s mutation loss remains unknown with no resend', async (route, params) => {
  const transport = vi.fn<Transport>().mockResolvedValueOnce(ok({ csrf: 'one' })).mockRejectedValue(new Error('POST lost'));
  expect(await createServices(config, transport).social(route, params)).toEqual({ ok: false, kind: 'unknown' });
  expect(transport).toHaveBeenCalledTimes(2);
  expect(transport.mock.calls[1]![1].method).toBe('POST');
});
it.each(socialMutations.slice(0, 2))('Social %s failed refresh preserves original 403 without resend', async (route, params) => {
  const rejection = ok({ error: 'Reload the workspace before saving' }, 403);
  for (const failure of ['lost', 'non-2xx', 'no-token']) {
    const transport = vi.fn<Transport>().mockResolvedValueOnce(ok({ csrf: 'one' })).mockResolvedValueOnce(rejection);
    if (failure === 'lost') transport.mockRejectedValueOnce(new Error('refresh lost'));
    else transport.mockResolvedValueOnce(failure === 'non-2xx' ? ok({ csrf: 'invalid' }, 500) : ok({}));
    expect(await createServices(config, transport).social(route, params)).toEqual(rejection);
    expect(transport).toHaveBeenCalledTimes(3);
    expect(transport.mock.calls.map(([, call]) => call.method)).toEqual(['GET', 'POST', 'GET']);
    expect(transport.mock.calls[2]![1].loss).toBe('unavailable');
  }
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
  it('malformed, oversized and reset Work reads unavailable, writes unknown; Social reads unavailable after send', async () => {
    for (const payload of ['not json', 'x'.repeat(LIMITS.response + 1), null]) {
      const srv = await server((_req, res) => { if (payload === null) res.destroy(); else res.end(payload); });
      try {
        for (const [method, loss] of [['GET', 'unavailable'], ['POST', 'unknown']] as const) expect(await sendHttp(srv.url, { method, path: '/', headers: {}, loss })).toEqual({ ok: false, kind: loss });
        for (const [route, params, loss] of [['workspace', {}, 'unavailable'], ['sample', { tool: 'x-studio' }, 'unavailable'], ['run', { id: 'run123' }, 'unavailable'], ...socialMutations.map(([route, params]) => [route, params, 'unknown'])] as const) {
          const encoded = encodeSocial(route, params)!;
          expect(await sendHttp(new URL(encoded.path, srv.url), { ...encoded, headers: {} })).toEqual({ ok: false, kind: loss });
        }
      } finally { await srv.close(); }
    }
  });
  it.each([['workspace', {}], ['sample', { tool: 'x-studio' }], ['run', { id: 'run123' }]])('Social %s post-send timeout is unavailable', async (route, params) => {
    let arrived!: () => void; const incoming = new Promise<void>(r => { arrived = r; });
    const srv = await server(() => arrived());
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      const encoded = encodeSocial(route, params)!;
      const result = sendHttp(new URL(encoded.path, srv.url), { ...encoded, headers: {} });
      await incoming; await vi.advanceTimersByTimeAsync(10_000);
      expect(await result).toEqual(unavailable);
    } finally { vi.useRealTimers(); await srv.close(); }
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

it('Social saveContent allows only a null or exact-shaped planning slot on the existing route', () => {
  const draft = { title: 'Editorial plan', body: '', brand_id: 'default', channel: 'X', planned_date: '2026-10-22', archived: 0 };
  const slot = { start: '09:15', duration_minutes: 30, timezone: 'America/New_York' };
  for (const planning_slot of [null, slot]) {
    const encoded = encodeSocial('saveContent', { ...draft, planning_slot });
    expect(encoded).toMatchObject({ path: '/api/content', method: 'POST', loss: 'unknown' });
    expect(JSON.parse(encoded!.body!)).toEqual({ ...draft, planning_slot });
  }
  for (const planning_slot of [[], '09:15', {}, { ...slot, duration_minutes: '30' }, { ...slot, timezone: 3 }, { ...slot, end: '09:45' }]) {
    expect(encodeSocial('saveContent', { ...draft, planning_slot })).toBeNull();
  }
  expect(JSON.parse(encodeSocial('saveContent', draft)!.body!)).not.toHaveProperty('planning_slot');
});

describe('Social draft reference transport', () => {
  const draft = { title: 'Linked draft', body: '', brand_id: 'default', channel: 'X', planned_date: '', archived: 0 };
  const reference = (entityId = 'view-alpha') => ({
    version: 1, domain: 'design', projectId: 'project-alpha', kind: 'view', entityId, title: 'Saved view',
    returnDestination: { domain: 'design', destination: 'projects/view-alpha' },
    sourceRevision: 'revision-one', workspaceId: 'workspace-origin',
  });

  it('preserves legacy omission, explicit clearing, optimistic versions and planning slots', () => {
    const legacy = encodeSocial('saveContent', draft)!;
    expect(JSON.parse(legacy.body!)).toEqual(draft);
    expect(legacy.body).not.toContain('"links"');
    for (const links of [[], [reference()], Array.from({ length: 30 }, (_, n) => reference(`view-${n}`))]) {
      const params = { ...draft, id: 'draft12', version: 0, planning_slot: null, links };
      const encoded = encodeSocial('saveContent', params)!;
      expect(encoded).toMatchObject({ method: 'POST', path: '/api/content', loss: 'unknown' });
      expect(JSON.parse(encoded.body!)).toEqual(params);
    }
  });

  it('uses the existing envelope contract for every domain and optional provenance', () => {
    for (const domain of ['design', 'social', 'work', 'wiki']) {
      const { sourceRevision: _revision, workspaceId: _workspace, ...minimal } = reference();
      const link = { ...minimal, domain, returnDestination: { domain, destination: 'overview' } };
      expect(JSON.parse(encodeSocial('saveContent', { ...draft, links: [link] })!.body!).links).toEqual([link]);
    }
  });

  it('refuses invalid references and oversized lists before even fetching a CSRF token', async () => {
    const transport = vi.fn<Transport>();
    const svc = createServices(config, transport);
    const ref = reference();
    const invalid = [
      null, undefined, {}, 'links', [null], Array(1), Array.from({ length: 31 }, (_, n) => reference(`view-${n}`)),
      [{ ...ref, version: 2 }], [{ ...ref, domain: 'other' }], [{ ...ref, projectId: '' }],
      [{ ...ref, entityId: '' }], [{ ...ref, kind: '' }], [{ ...ref, title: ' bad title ' }],
      [{ ...ref, title: 'x'.repeat(301) }], [{ ...ref, workspaceId: '' }], [{ ...ref, sourceRevision: undefined }],
      [{ ...ref, extra: true }], [{ ...ref, returnDestination: { domain: 'design', destination: 'https://example.test' } }],
      [{ ...ref, returnDestination: { domain: 'design', destination: 'projects', token: 'forbidden' } }],
    ];
    for (const links of invalid) {
      const params = { ...draft, links };
      expect(encodeSocial('saveContent', params)).toBeNull();
      expect(await svc.social('saveContent', params)).toEqual(unavailable);
    }
    expect(encodeSocial('saveContent', { ...draft, links: [], unexpected: true })).toBeNull();
    expect(transport).not.toHaveBeenCalled();
  });

  it('keeps canonical nested bytes independent of property insertion order', () => {
    const ref = reference();
    const reversed = Object.fromEntries(Object.entries(ref).reverse());
    reversed.returnDestination = Object.fromEntries(Object.entries(ref.returnDestination).reverse());
    const params = { ...draft, links: [ref] };
    const reordered = Object.fromEntries(Object.entries({ ...draft, links: [reversed] }).reverse());
    expect(encodeSocial('saveContent', reordered)!.body).toBe(encodeSocial('saveContent', params)!.body);
  });

  it('applies the existing UTF-8 body cap including reference bytes', () => {
    const params = { ...draft, links: [reference()] };
    const overhead = Buffer.byteLength(encodeSocial('saveContent', params)!.body!);
    const atLimit = { ...params, body: 'a'.repeat(LIMITS.social - overhead) };
    expect(Buffer.byteLength(encodeSocial('saveContent', atLimit)!.body!)).toBe(LIMITS.social);
    expect(encodeSocial('saveContent', { ...atLimit, body: atLimit.body + 'é' })).toBeNull();
  });

  it('sends identical link/version bytes through the existing one-time token refresh', async () => {
    const params = { ...draft, id: 'draft12', version: 3, links: [reference()] };
    const rejection = ok({ error: 'Reload the workspace before saving' }, 403);
    const saved = ok({ id: 'draft12', version: 4, links: params.links });
    const transport = vi.fn<Transport>().mockResolvedValueOnce(ok({ csrf: 'first' }))
      .mockResolvedValueOnce(rejection).mockResolvedValueOnce(ok({ csrf: 'second' })).mockResolvedValueOnce(saved);
    expect(await createServices(config, transport).social('saveContent', params)).toEqual(saved);
    expect(transport.mock.calls.map(([, call]) => [call.method, call.path])).toEqual([
      ['GET', '/api/workspace'], ['POST', '/api/content'], ['GET', '/api/workspace'], ['POST', '/api/content'],
    ]);
    const first = transport.mock.calls[1]![1], retry = transport.mock.calls[3]![1];
    expect(first.body).toBe(encodeSocial('saveContent', params)!.body);
    expect(retry.body).toBe(first.body);
    expect(first.headers['X-Workspace-Token']).toBe('first');
    expect(retry.headers['X-Workspace-Token']).toBe('second');
    expect(JSON.parse(first.body!)).not.toHaveProperty('csrf');
  });

  it('never retries an uncertain save or an optimistic-version conflict carrying links', async () => {
    const params = { ...draft, id: 'draft12', version: 2, links: [reference()] };
    const conflict = ok({ error: 'Draft changed', version: 3 }, 409);
    for (const lost of [true, false]) {
      const transport = vi.fn<Transport>().mockResolvedValueOnce(ok({ csrf: 'token' }));
      if (lost) transport.mockRejectedValueOnce(new Error('response lost after POST'));
      else transport.mockResolvedValueOnce(conflict);
      expect(await createServices(config, transport).social('saveContent', params))
        .toEqual(lost ? { ok: false, kind: 'unknown' } : conflict);
      expect(transport).toHaveBeenCalledTimes(2);
      expect(JSON.parse(transport.mock.calls[1]![1].body!)).toEqual(params);
    }
  });
});
