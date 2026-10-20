import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import type { ServiceResponse, SocialServiceRoute, WorkServiceRoute, WorkMutationCall } from '@hq/contracts/services';
import type { ServiceConfig } from './service-config.js';

export const CHANNELS = Object.freeze({ social: 'hq:svc:social', work: 'hq:svc:work', design: 'hq:svc:design', config: 'hq:svc:config', wiki: 'hq:svc:wiki' });
export const LIMITS = Object.freeze({ social: 2_000_000, work: 256 * 1024, replay: 352 * 1024, response: 2_000_000 });
const unavailable = (): ServiceResponse => ({ ok: false, kind: 'unavailable' });
export function record(v: unknown): v is Record<string, unknown> { return v !== null && typeof v === 'object' && !Array.isArray(v) && (Object.getPrototypeOf(v) === Object.prototype || Object.getPrototypeOf(v) === null); }
export function keys(p: Record<string, unknown>, required: readonly string[], optional: readonly string[] = []): boolean { return required.every(k => Object.hasOwn(p, k)) && Object.keys(p).every(k => required.includes(k) || optional.includes(k)); }
const id = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9_-]{6,40}$/.test(v);
const requestId = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9-]{8,64}$/.test(v);
const integer = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) >= 0;
/** JSON only: no silent undefined/NaN loss, cycles, custom serialization, or prototype objects. */
export function jsonValue(v: unknown, seen = new Set<object>()): boolean {
  if (v === null || typeof v === 'string' || typeof v === 'boolean') return true;
  if (typeof v === 'number') return Number.isFinite(v);
  if (typeof v !== 'object' || (!Array.isArray(v) && !record(v)) || seen.has(v)) return false;
  seen.add(v);
  const valid = (Array.isArray(v) ? Array.from(v) : Object.values(v)).every(x => jsonValue(x, seen));
  seen.delete(v); return valid;
}
interface Encoded { method: 'GET' | 'POST' | 'PATCH' | 'PUT'; path: string; body?: string; requestId?: string; loss: 'unavailable' | 'unknown' }
export const WORK_METHODS = { state: 'GET', version: 'GET', item: 'GET', history: 'GET', create: 'POST', patch: 'PATCH', move: 'POST', archive: 'POST', restore: 'POST', reviewed: 'POST', settings: 'PUT', replay: 'POST' } as const satisfies Record<WorkServiceRoute, string>;
export const SOCIAL_PATHS = { workspace: '/api/workspace', sample: '/api/sample/', run: '/api/runs/', saveContent: '/api/content', addBrand: '/api/brands', submitRun: '/api/runs' } as const satisfies Record<SocialServiceRoute, string>;
/** Fixed ordering recursively makes persisted originals independent of object insertion order. */
function canonical(v: unknown): string {
  if (Array.isArray(v)) return '[' + v.map(canonical).join(',') + ']';
  if (record(v)) return '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + canonical(v[k])).join(',') + '}';
  return JSON.stringify(v);
}
export function encodeWork(route: unknown, params: unknown): Encoded | null {
  if (typeof route !== 'string' || !Object.hasOwn(WORK_METHODS, route) || !record(params) || !jsonValue(params)) return null;
  const p = params;
  const method = WORK_METHODS[route as WorkServiceRoute];
  if (route === 'state' || route === 'version') return keys(p, []) ? { method: 'GET', path: `/api/${route}`, loss: 'unavailable' } : null;
  if (route === 'item' || route === 'history') return keys(p, ['id']) && id(p.id) ? { method: 'GET', path: `/api/items/${p.id}${route === 'history' ? '/history' : ''}`, loss: 'unavailable' } : null;
  if (!requestId(p.requestId)) return null;
  if (route === 'replay') {
    if (!keys(p, ['mode', 'requestId', 'original'], ['sentAfterVersion']) || !['lookup', 'resend'].includes(String(p.mode)) || (Object.hasOwn(p, 'sentAfterVersion') && !integer(p.sentAfterVersion)) || !record(p.original) || !keys(p.original, ['route', 'params']) || !record(p.original.params) || p.original.params.requestId !== p.requestId || !['create', 'patch', 'move', 'archive', 'restore', 'reviewed', 'settings'].includes(String(p.original.route))) return null;
    const original = encodeWork(p.original.route, p.original.params);
    if (!original?.body) return null;
    const body = JSON.stringify({ mode: p.mode, request_id: p.requestId, method: original.method, path: original.path, body_b64: Buffer.from(original.body).toString('base64'), ...(p.sentAfterVersion === undefined ? {} : { sent_after_version: p.sentAfterVersion }) });
    return Buffer.byteLength(body) <= LIMITS.replay ? { method: 'POST', path: '/api/requests/replay', body, loss: p.mode === 'lookup' ? 'unavailable' : 'unknown' } : null;
  }
  let path: string;
  let body: Record<string, unknown>;
  if (route === 'create' || route === 'settings') {
    const field = route === 'create' ? 'fields' : 'settings';
    if (!keys(p, ['requestId', field]) || !record(p[field])) return null;
    path = route === 'create' ? '/api/items' : '/api/settings'; body = { [field]: p[field] };
  } else {
    if (!id(p.id) || !integer(p.revision)) return null;
    const required = ['requestId', 'id', 'revision'];
    if (route === 'patch') {
      if (!keys(p, [...required, 'patch']) || !record(p.patch)) return null;
      path = `/api/items/${p.id}`; body = { revision: p.revision, patch: p.patch };
    } else if (route === 'move') {
      if (!keys(p, [...required, 'status'], ['after_id', 'before_id', 'place']) || typeof p.status !== 'string' || (p.after_id !== undefined && !id(p.after_id)) || (p.before_id !== undefined && !id(p.before_id)) || (p.place !== undefined && p.place !== 'top' && p.place !== 'bottom')) return null;
      path = `/api/items/${p.id}/move`; body = { revision: p.revision, status: p.status, ...('after_id' in p ? { after_id: p.after_id } : {}), ...('before_id' in p ? { before_id: p.before_id } : {}), ...('place' in p ? { place: p.place } : {}) };
    } else {
      if (!keys(p, required)) return null;
      path = `/api/items/${p.id}/${route}`; body = { revision: p.revision };
    }
  }
  const encoded = canonical(body);
  return Buffer.byteLength(encoded) <= LIMITS.work ? { method, path, body: encoded, requestId: p.requestId, loss: 'unknown' } : null;
}
// Type-level check: the replay original is the same closed mutation input, never raw JSON bytes.
export function encodeOriginal(call: WorkMutationCall): Encoded | null { return encodeWork(call.route, call.params); }
export function encodeSocial(route: unknown, p: unknown): Encoded | null {
  if (typeof route !== 'string' || !Object.hasOwn(SOCIAL_PATHS, route) || !record(p) || !jsonValue(p)) return null;
  let path = SOCIAL_PATHS[route as SocialServiceRoute];
  if (route === 'workspace') return keys(p, []) ? { method: 'GET', path, loss: 'unavailable' } : null;
  if (route === 'run') return keys(p, ['id']) && id(p.id) ? { method: 'GET', path: path + p.id, loss: 'unavailable' } : null;
  if (route === 'sample') return keys(p, ['tool']) && typeof p.tool === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(p.tool) ? { method: 'GET', path: path + p.tool, loss: 'unavailable' } : null;
  if (route === 'addBrand' && (!keys(p, ['name']) || typeof p.name !== 'string')) return null;
  if (route === 'submitRun' && (!keys(p, ['tool', 'input', 'is_example']) || typeof p.tool !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(p.tool) || !record(p.input) || typeof p.is_example !== 'boolean')) return null;
  if (route === 'saveContent') {
    if (!keys(p, ['title', 'body', 'brand_id', 'channel', 'planned_date', 'archived'], ['id', 'version']) || !['title', 'body', 'brand_id', 'channel', 'planned_date'].every(k => typeof p[k] === 'string') || !/^$|^\d{4}-\d{2}-\d{2}$/.test(p.planned_date as string) || (p.archived !== 0 && p.archived !== 1) || (('id' in p || 'version' in p) && (!id(p.id) || !integer(p.version)))) return null;
  }
  const body = canonical(p);
  return Buffer.byteLength(body) <= LIMITS.social ? { method: 'POST', path, body, loss: 'unknown' } : null;
}
export interface HttpCall extends Encoded { headers: Record<string, string> }
export type Transport = (url: URL, call: HttpCall) => Promise<ServiceResponse>;
/** Node HTTP has no ambient cookie jar and does not follow redirects. Whole-response deadline. */
export const sendHttp: Transport = (url, call) => new Promise<ServiceResponse>(resolve => {
  let sent = false, settled = false;
  const finish = (value: ServiceResponse) => { if (!settled) { settled = true; clearTimeout(timer); resolve(value); } };
  const fail = () => finish({ ok: false, kind: sent ? call.loss : 'unavailable' });
  let req: ReturnType<typeof httpRequest> | undefined;
  const timer = setTimeout(() => { fail(); req?.destroy(); }, call.method === 'GET' || (call.path === '/api/requests/replay' && call.loss === 'unavailable') ? 10_000 : 20_000);
  try {
  req = (url.protocol === 'https:' ? httpsRequest : httpRequest)(url, { method: call.method, headers: { ...call.headers, ...(call.body === undefined ? {} : { 'Content-Length': String(Buffer.byteLength(call.body)) }) } }, res => {
    sent = true;
    const chunks: Buffer[] = []; let length = 0;
    res.on('data', (chunk: Buffer) => {
      length += chunk.length;
      if (length > LIMITS.response) { fail(); res.destroy(); req?.destroy(); } else chunks.push(chunk);
    });
    res.on('error', fail); res.on('aborted', fail);
    res.on('end', () => {
      if (!res.complete) { fail(); return; }
      try {
        const text = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks));
        finish({ ok: true, status: res.statusCode!, body: text.length ? JSON.parse(text) : null, replayed: res.headers['x-replayed'] === '1' });
      } catch { fail(); }
    });
  });
  req.on('finish', () => { sent = true; });
  req.on('error', fail);
  req.end(call.body);
  } catch { fail(); }
}).catch(() => unavailable());
export function createServices(config: ServiceConfig, transport: Transport = sendHttp) {
  const tokens = new Map<string, string>();
  async function socialRequest(base: URL, encoded: Encoded, csrf?: string): Promise<ServiceResponse> {
    let response: ServiceResponse;
    try { response = await transport(new URL(encoded.path, base), { ...encoded, headers: { Accept: 'application/json', ...(encoded.body === undefined ? {} : { 'Content-Type': 'application/json', 'X-Workspace-Token': csrf! }) } }); }
    catch { return { ok: false, kind: encoded.loss }; }
    if (encoded.path === '/api/workspace' && response.ok && record(response.body)) {
      const { csrf: received, ...body } = response.body;
      if (response.status >= 200 && response.status < 300 && typeof received === 'string' && received.length > 0 && !/[\r\n]/.test(received)) tokens.set(base.origin, received);
      return { ...response, body };
    }
    return response;
  }
  return {
    async work(route: unknown, params: unknown): Promise<ServiceResponse> {
      try {
        const encoded = encodeWork(route, params), base = config.get('work');
        if (!encoded || !base) return unavailable();
        return await transport(new URL(encoded.path, base), { ...encoded, headers: { Accept: 'application/json', ...(encoded.body === undefined ? {} : { 'Content-Type': 'application/json', 'X-Planning-Request': '1', ...(encoded.requestId ? { 'X-Request-Id': encoded.requestId } : {}) }) } }).catch((): ServiceResponse => ({ ok: false, kind: encoded.loss }));
      } catch { return unavailable(); }
    },
    async social(route: unknown, params: unknown): Promise<ServiceResponse> {
      let encoded: Encoded | null, base: URL | null;
      try { encoded = encodeSocial(route, params); base = config.get('social'); } catch { return unavailable(); }
      if (!encoded || !base) return unavailable();
      if (encoded.body !== undefined && !tokens.has(base.origin)) {
        await socialRequest(base, { method: 'GET', path: '/api/workspace', loss: 'unavailable' });
        if (!tokens.has(base.origin)) return unavailable();
      }
      const response = await socialRequest(base, encoded, tokens.get(base.origin));
      if ((route === 'saveContent' || route === 'addBrand') && response.ok && response.status === 403 && record(response.body) && response.body.error === 'Reload the workspace before saving') {
        tokens.delete(base.origin);
        const refresh = await socialRequest(base, { method: 'GET', path: '/api/workspace', loss: 'unavailable' });
        if (!refresh.ok || refresh.status < 200 || refresh.status >= 300 || !tokens.has(base.origin)) return response;
        return socialRequest(base, encoded, tokens.get(base.origin));
      }
      return response;
    },
  };
}
/** Same-realm modules are not hard domain isolation; main-frame/origin checks reject other frames. */
export function allowedSender(event: { senderFrame: unknown; sender: unknown }, contents: { mainFrame: unknown }, builtUrl: string, developmentUrl: string | null): boolean {
  if (event.sender !== contents || !event.senderFrame || event.senderFrame !== contents.mainFrame) return false;
  try {
    const url = new URL((event.senderFrame as { url: string }).url);
    if (developmentUrl) return url.origin === new URL(developmentUrl).origin;
    url.hash = '';
    return url.href === builtUrl;
  } catch { return false; }
}
