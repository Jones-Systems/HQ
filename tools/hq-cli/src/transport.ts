import { conforms, project, errorSchema } from './schema.ts';
import type { Schema } from './schema.ts';
export class CliError extends Error {
  code: string;
  exitCode: number;
  details: Record<string, unknown>;
  effect: string = 'none';
  constructor(code: string, message: string, exitCode: number, details: Record<string, unknown> = {}) {
    super(message); this.code = code; this.exitCode = exitCode; this.details = details;
  }
}
export const usage = (message: string, field?: string) => new CliError('usage_error', message, 2, field ? { field } : {});
export function plannerURL(raw: string): string {
  let url: URL;
  try { url = new URL(raw); } catch { throw usage('Planner URL must be an absolute HTTP(S) origin.', 'planner_url'); }
  const loopback = url.hostname === 'localhost' || url.hostname === '[::1]' || /^127\.(\d{1,3}\.){2}\d{1,3}$/.test(url.hostname);
  if (/[\s\\?#]/.test(raw) || url.username || url.password || url.pathname !== '/' || (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback))) {
    throw usage('Planner URL requires HTTPS or loopback HTTP, an origin only, and no userinfo, query or fragment.', 'planner_url');
  }
  return url.origin;
}
export type ReadRoute = { kind: 'version' } | { kind: 'state' } | { kind: 'item'; id: string } | { kind: 'history'; id: string };
export type Fetch = (input: string, init: RequestInit) => Promise<Response>;
export const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
export class PlannerClient {
  origin: string;
  fetch: Fetch;
  timeoutMs: number;
  constructor(url: string | undefined, fetch: Fetch, timeoutMs = 10000) {
    if (!url) throw new CliError('unconfigured', 'Set --planner-url or HQ_PLANNER_URL to use Planner.', 6);
    this.origin = plannerURL(url); this.fetch = fetch; this.timeoutMs = timeoutMs;
  }
  async read(route: ReadRoute, shape: Schema): Promise<any> {
    let path: string;
    if (route.kind === 'state' || route.kind === 'version') path = `/api/${route.kind}`;
    else if ((route.kind === 'item' || route.kind === 'history') && /^[A-Za-z0-9_-]{6,40}$/.test(route.id)) path = `/api/items/${route.id}${route.kind === 'history' ? '/history' : ''}`;
    else throw usage('Invalid Planner read route.');
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new CliError('timeout', 'Planner read timed out; no write was sent.', 6)); }, this.timeoutMs); });
    try {
      return await Promise.race([this.request(path, shape, controller.signal), timeout]);
    } catch (error) {
      controller.abort();
      if (error instanceof CliError) throw error;
      const e = error as { code?: string; cause?: { code?: string } };
      const code = e?.cause?.code ?? e?.code;
      if (code === 'ECONNREFUSED') throw new CliError('connection_refused', 'Planner refused the connection.', 6);
      if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') throw new CliError('dns_failure', 'Planner name could not be resolved.', 6);
      throw new CliError('network_error', 'Planner read failed; no write was sent.', 6);
    } finally { clearTimeout(timer); }
  }
  async write(method: string, path: string, body: string, requestId: string | undefined, shape: Schema, noEffect = false): Promise<{ body: any; replayed: boolean }> {
    if (!isWriteRoute(method, path) && !(method === 'POST' && path === '/api/requests/replay')) throw usage('Unsupported write route.');
    if (path === '/api/requests/replay' ? requestId !== undefined : !requestId || !/^[A-Za-z0-9-]{8,64}$/.test(requestId)) throw usage('Invalid request ID placement.');
    if (Buffer.byteLength(body) > (path === '/api/requests/replay' ? 352 * 1024 : 256 * 1024)) throw usage('Request body exceeds the service limit.');
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const unknown = (code: string, message: string) => { const error = new CliError(code, message, noEffect ? 6 : 7); error.effect = noEffect ? 'none' : 'unknown'; return error; };
    const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(unknown('timeout', 'Planner request timed out.')); }, this.timeoutMs); });
    try { return await Promise.race([this.request(path, shape, controller.signal, { method, body, requestId, noEffect }), timeout]); }
    catch (error) {
      controller.abort();
      if (error instanceof CliError) throw error;
      const e = error as { code?: string; cause?: { code?: string } };
      const code = e?.cause?.code ?? e?.code;
      if (code === 'ECONNREFUSED') throw new CliError('connection_refused', 'Planner refused the connection before sending.', 6);
      if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') throw new CliError('dns_failure', 'Planner name could not be resolved; nothing was sent.', 6);
      throw unknown('network_error', 'Planner connection failed after the write may have been sent.');
    } finally { clearTimeout(timer); }
  }
  private async request(path: string, shape: Schema, signal: AbortSignal, mutation?: { method: string; body: string; requestId?: string; noEffect: boolean }): Promise<any> {
    const uncertain = (code: string, message: string, details: Record<string, unknown> = {}) => {
      const error = new CliError(code, message, mutation && !mutation.noEffect ? 7 : 6, details);
      if (mutation && !mutation.noEffect) error.effect = 'unknown';
      return error;
    };
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (mutation) { headers['Content-Type'] = 'application/json'; headers['X-Planning-Request'] = '1'; if (mutation.requestId) headers['X-Request-Id'] = mutation.requestId; }
    const response = await this.fetch(this.origin + path, { method: mutation?.method ?? 'GET', headers, redirect: 'manual', credentials: 'omit', signal, ...(mutation ? { body: mutation.body } : {}) });
    if (response.redirected || (response.status >= 300 && response.status < 400)) throw uncertain('redirect_refused', 'Planner redirects are not followed.');
    if (response.status === 403 || response.status === 421) throw new CliError('access_refused', 'Planner access was refused.', 6, { http_status: response.status, hint: response.status === 421 ? 'Configure the service --allowed-host for the intended hostname.' : 'Check the service access policy.' });
    if (response.status >= 500) throw uncertain('service_unavailable', 'Planner service returned an error.', { http_status: response.status });
    const length = response.headers.get('content-length');
    if (length !== null && (!/^\d+$/.test(length) || Number(length) > MAX_RESPONSE_BYTES)) throw uncertain('response_too_large', 'Planner response exceeds the 8 MiB read limit.');
    if (!/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type') ?? '')) throw uncertain('bad_response', 'Planner response must be JSON.');
    const reader = response.body?.getReader();
    if (!reader) throw uncertain('bad_response', 'Planner returned an empty response.');
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > MAX_RESPONSE_BYTES) throw uncertain('response_too_large', 'Planner response exceeds the 8 MiB read limit.');
        chunks.push(value);
      }
    } finally { void reader.cancel().catch(() => {}); }
    let body: any;
    try { body = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))); } catch { throw uncertain('bad_response', 'Planner returned malformed JSON.'); }
    if (!response.ok) {
      if (mutation) {
        if (!body || typeof body.error !== 'string' || typeof body.message !== 'string') throw uncertain('bad_response', 'Planner error response has an invalid shape.');
        const details: Record<string, unknown> = { http_status: response.status };
        for (const key of ['errors', 'current']) if (Object.hasOwn(body, key)) {
          const fieldShape = errorSchema.properties!.details.properties![key];
          if (!conforms(fieldShape, body[key], true)) throw uncertain('bad_response', 'Planner error details have an invalid shape.');
          details[key] = project(fieldShape, body[key]);
        }
        if (body.error === 'replay_indeterminate') {
          for (const key of ['sent_after_version', 'evicted_through_version']) if (Number.isSafeInteger(body[key]) && body[key] >= 0) details[key] = body[key];
          const error = new CliError('replay_indeterminate', 'Retention cannot prove the original outcome. Read back and ask before another change.', 7, details); error.effect = 'unknown'; throw error;
        }
        if (['revision_conflict', 'order_conflict', 'request_id_reused'].includes(body.error)) throw new CliError(body.error, body.message, 4, details);
        if (response.status === 404) throw new CliError('not_found', body.message, 5, details);
        if ([400, 413, 415, 422].includes(response.status)) throw new CliError('validation_error', body.message, 3, { ...details, original_code: body.error });
        throw uncertain('service_unavailable', 'Planner returned an unexpected rejection.', details);
      }
      if (response.status === 404) throw new CliError('not_found', 'Planner item or endpoint was not found.', 5);
      if (response.status === 400 || response.status === 422) throw new CliError('validation_error', 'Planner rejected the request.', 3, { http_status: response.status });
      throw new CliError('service_unavailable', 'Planner read was rejected.', 6, { http_status: response.status });
    }
    if (!conforms(shape, body, true)) throw uncertain('bad_response', 'Planner response has an invalid shape.');
    const projected = project(shape, body);
    return mutation ? { body: projected, replayed: response.headers.get('x-replayed') === '1' } : projected;
  }
}
export function isWriteRoute(method: string, path: string): boolean {
  if (method === 'POST' && ['/api/items', '/api/items/batch'].includes(path) || method === 'PUT' && path === '/api/settings') return true;
  if (method === 'PATCH') return /^\/api\/items\/[A-Za-z0-9_-]{6,40}$/.test(path);
  return method === 'POST' && /^\/api\/items\/[A-Za-z0-9_-]{6,40}\/(move|archive|restore|reviewed)$/.test(path);
}
