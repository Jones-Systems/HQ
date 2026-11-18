import { describe, expect, it, vi } from 'vitest';
import { SOCIAL_SERVICE_ROUTES, type SocialServiceParams, type SocialServiceTransport } from '@hq/contracts/services';
import type { SocialServiceTransport as ModuleTransport } from '../../../modules/social/live/transport';
import { createServices, encodeSocial, LIMITS, type Transport } from './services';
import type { ServiceConfig } from './service-config';

// Compile-time boundary: the desktop transport accepts the module's full closed route set.
const moduleTransport = (shared: SocialServiceTransport): ModuleTransport => shared;
void moduleTransport;
const source = { name: 'Example', kind: 'feed-items', file_name: 'feed.json', text: '[]', as_of: '' } as const;
const hash = 'a'.repeat(64);
const run = { tool: 'x-studio', input: {}, is_example: true, source_ids: ['source01'] };
const cases = [
  ['setBrandProject', { id: 'default', project_id: 'project-example' }, '/api/brands/default/project', { project_id: 'project-example' }],
  ['source', { id: 'source01' }, '/api/sources/source01', undefined],
  ['saveSource', source, '/api/sources', source],
  ['archiveSource', { id: 'source01', archived: 1 }, '/api/sources/source01/archive', { archived: 1 }],
  ['publishingConnect', { channel: 'X', label: 'Example' }, '/api/publishing/connections', { channel: 'X', label: 'Example' }],
  ['publishingDisconnect', { id: 'connect1' }, '/api/publishing/connections/connect1/disconnect', {}],
  ['publishingRequest', { draft_id: 'draft001', draft_version: 1, connection_id: 'connect1' }, '/api/publishing/requests', { draft_id: 'draft001', draft_version: 1, connection_id: 'connect1' }],
  ['publishingCancel', { id: 'request1' }, '/api/publishing/requests/request1/cancel', {}],
  ['publishingApprove', { id: 'request1', content_sha256: hash }, '/api/publishing/requests/request1/approve', { content_sha256: hash }],
  ['submitRun', run, '/api/runs', run],
] as const;
const config: ServiceConfig = { get: () => new URL('http://127.0.0.1'), status: () => ({ configured: true, policy: 'ok', transport: 'loopback-http' }), set: async () => ({ configured: true, policy: 'ok', transport: 'loopback-http' }) };
const ok = (body: unknown, status = 200) => ({ ok: true as const, status, body, replayed: false });
const refused = ok({ error: 'Reload the workspace before saving' }, 403);
const unavailable = { ok: false, kind: 'unavailable' };

describe('Social extension desktop boundary', () => {
  it('maps every route to its closed method/path/body and loss class without widening response caps', () => {
    for (const [route, params, path, body] of cases) {
      expect(SOCIAL_SERVICE_ROUTES).toContain(route);
      const encoded = encodeSocial(route, params)!;
      expect(encoded).toMatchObject({ path, method: body === undefined ? 'GET' : 'POST', loss: body === undefined ? 'unavailable' : 'unknown' });
      expect(encoded.body === undefined ? undefined : JSON.parse(encoded.body)).toEqual(body);
      expect(encoded.maxResponse).toBeUndefined();
      expect(encodeSocial(route, { ...params, endpoint: 'https://example.invalid' })).toBeNull();
      for (const key of Object.keys(params)) {
        if (key === 'source_ids') continue;
        const missing = { ...params } as Record<string, unknown>; delete missing[key];
        expect(encodeSocial(route, missing)).toBeNull();
      }
    }
    const mirror: SocialServiceParams['saveSource'] = source;
    expect(encodeSocial('saveSource', mirror)).not.toBeNull();
    expect(encodeSocial('setBrandProject', { id: 'brand001', project_id: null })?.body).toBe('{"project_id":null}');
    expect(encodeSocial('submitRun', { tool: 'x-studio', input: {}, is_example: true })?.body).not.toContain('source_ids');
  });

  it('rejects opaque path escapes, invalid types, closed enums and size violations before any HTTP or token read', async () => {
    const transport = vi.fn<Transport>(); const svc = createServices(config, transport);
    const invalid: [string, unknown][] = [];
    for (const [route, params] of cases) for (const key of ['id', 'draft_id', 'connection_id']) {
      if (!(key in params)) continue;
      for (const bad of ['../secret', 'a/bbbbb', 'id%2Fescape', 'https://example.invalid', 'abcde', 'a'.repeat(41), 123]) invalid.push([route, { ...params, [key]: bad }]);
    }
    for (const project_id of ['', ' padded', 'a'.repeat(161), '\u0085', 1, false]) invalid.push(['setBrandProject', { id: 'default', project_id }]);
    for (const change of [
      { name: '' }, { name: 'a'.repeat(121) }, { name: 1 }, { file_name: 'a'.repeat(256) }, { file_name: '../file.json' },
      { file_name: 'dir\\file.json' }, { file_name: '\u0085.json' }, { kind: 'other' }, { kind: null },
      { text: '' }, { text: 'é'.repeat(750_001) }, { text: '\ud800' }, { text: {} }, { as_of: null },
    ]) invalid.push(['saveSource', { ...source, ...change }]);
    for (const archived of [true, -1, 2, 0.5, '1']) invalid.push(['archiveSource', { id: 'source01', archived }]);
    for (const channel of ['General', 'Article', 'other', 1]) invalid.push(['publishingConnect', { channel, label: 'Example' }]);
    for (const label of ['', ' ', 'a'.repeat(81), null]) invalid.push(['publishingConnect', { channel: 'X', label }]);
    for (const draft_version of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, '1']) invalid.push(['publishingRequest', { draft_id: 'draft001', connection_id: 'connect1', draft_version }]);
    for (const content_sha256 of ['A'.repeat(64), 'g'.repeat(64), 'a'.repeat(63), 'a'.repeat(65), 'a'.repeat(64) + '\n', 1]) invalid.push(['publishingApprove', { id: 'request1', content_sha256 }]);
    for (const source_ids of [null, 'source01', ['../bad'], Array(21).fill('source01'), [1]]) invalid.push(['submitRun', { ...run, source_ids }]);
    for (const [route, params] of cases) invalid.push([route, { ...params, unknown: true }], [route, { ...params, bad: undefined }]);
    for (const [route, params] of invalid) {
      expect(encodeSocial(route, params), `${route}: invalid input`).toBeNull();
      expect(await svc.social(route, params)).toEqual(unavailable);
    }
    expect(transport).not.toHaveBeenCalled();
  });

  it('accepts inclusive UTF-16, UTF-8 and list limits while retaining the total request cap', () => {
    expect(encodeSocial('setBrandProject', { id: 'default', project_id: '😀'.repeat(80) })).not.toBeNull();
    expect(encodeSocial('saveSource', { ...source, name: 'a'.repeat(120), file_name: 'a'.repeat(255), text: 'é'.repeat(750_000) })).not.toBeNull();
    expect(encodeSocial('saveSource', { ...source, text: '\\'.repeat(1_500_000) })).toBeNull();
    expect(encodeSocial('publishingConnect', { channel: 'X', label: '😀'.repeat(40) })).not.toBeNull();
    expect(encodeSocial('publishingRequest', { draft_id: 'draft001', connection_id: 'connect1', draft_version: Number.MAX_SAFE_INTEGER })).not.toBeNull();
    expect(encodeSocial('submitRun', { ...run, source_ids: Array(20).fill('source01') })).not.toBeNull();
    expect(encodeSocial('submitRun', { ...run, input: { text: 'a'.repeat(LIMITS.social) } })).toBeNull();
  });

  it('allows exactly one exact-token refresh for content extensions and never replays execution', async () => {
    for (const [route, params, path, body] of cases) {
      if (body === undefined) continue;
      const execution = route === 'publishingApprove' || route === 'submitRun';
      const transport = vi.fn<Transport>().mockResolvedValueOnce(ok({ csrf: 'first' })).mockResolvedValueOnce(refused)
        .mockResolvedValueOnce(ok({ csrf: 'second' })).mockResolvedValueOnce(refused);
      const result = await createServices(config, transport).social(route, params);
      expect(result).toEqual(refused);
      expect(transport).toHaveBeenCalledTimes(execution ? 2 : 4);
      expect(transport.mock.calls[1]![0].pathname).toBe(path);
      if (!execution) {
        expect(transport.mock.calls[2]![0].pathname).toBe('/api/workspace');
        expect(transport.mock.calls[3]![1].body).toBe(transport.mock.calls[1]![1].body);
        expect(transport.mock.calls[3]![1].headers['X-Workspace-Token']).toBe('second');
      }
    }
  });

  it('does not retry unknown losses, non-token errors or an unsuccessful token refresh', async () => {
    for (const [route, params, , body] of cases) {
      for (const failure of [{ ok: false as const, kind: body === undefined ? 'unavailable' as const : 'unknown' as const }, ok({ error: 'Other refusal' }, 403), ok({ error: 'Reload the workspace before saving' }, 409)]) {
        const transport = vi.fn<Transport>();
        if (body !== undefined) transport.mockResolvedValueOnce(ok({ csrf: 'first' }));
        transport.mockResolvedValueOnce(failure);
        expect(await createServices(config, transport).social(route, params)).toEqual(failure);
        expect(transport).toHaveBeenCalledTimes(body === undefined ? 1 : 2);
      }
      const throwing = vi.fn<Transport>();
      if (body !== undefined) throwing.mockResolvedValueOnce(ok({ csrf: 'first' }));
      throwing.mockRejectedValueOnce(new Error('synthetic response loss'));
      expect(await createServices(config, throwing).social(route, params)).toEqual({ ok: false, kind: body === undefined ? 'unavailable' : 'unknown' });
      expect(throwing).toHaveBeenCalledTimes(body === undefined ? 1 : 2);
    }
    for (const refresh of [unavailable, ok({}, 200), ok({ csrf: 'ignored' }, 500)]) {
      const transport = vi.fn<Transport>().mockResolvedValueOnce(ok({ csrf: 'first' })).mockResolvedValueOnce(refused).mockResolvedValueOnce(refresh as Awaited<ReturnType<Transport>>);
      expect(await createServices(config, transport).social('archiveSource', { id: 'source01', archived: 0 })).toEqual(refused);
      expect(transport).toHaveBeenCalledTimes(3);
    }
  });
});
