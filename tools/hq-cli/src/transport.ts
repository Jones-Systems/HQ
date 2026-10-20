import { conforms, project } from './schema.ts';
import type { Schema } from './schema.ts';
export class CliError extends Error {
  code: string;
  exitCode: number;
  details: Record<string, unknown>;
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
  private async request(path: string, shape: Schema, signal: AbortSignal): Promise<any> {
    const response = await this.fetch(this.origin + path, { method: 'GET', headers: { Accept: 'application/json' }, redirect: 'manual', credentials: 'omit', signal });
    if (response.redirected || (response.status >= 300 && response.status < 400)) throw new CliError('redirect_refused', 'Planner redirects are not followed.', 6);
    if (response.status === 403 || response.status === 421) throw new CliError('access_refused', 'Planner access was refused.', 6, { http_status: response.status, hint: response.status === 421 ? 'Configure the service --allowed-host for the intended hostname.' : 'Check the service access policy.' });
    if (response.status >= 500) throw new CliError('service_unavailable', 'Planner service returned an error.', 6, { http_status: response.status });
    const length = response.headers.get('content-length');
    if (length !== null && (!/^\d+$/.test(length) || Number(length) > MAX_RESPONSE_BYTES)) throw new CliError('response_too_large', 'Planner response exceeds the 8 MiB read limit.', 6);
    if (!/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type') ?? '')) throw new CliError('bad_response', 'Planner response must be JSON.', 6);
    const reader = response.body?.getReader();
    if (!reader) throw new CliError('bad_response', 'Planner returned an empty response.', 6);
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > MAX_RESPONSE_BYTES) throw new CliError('response_too_large', 'Planner response exceeds the 8 MiB read limit.', 6);
        chunks.push(value);
      }
    } finally { void reader.cancel().catch(() => {}); }
    let body: unknown;
    try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new CliError('bad_response', 'Planner returned malformed JSON.', 6); }
    if (!response.ok) {
      if (response.status === 404) throw new CliError('not_found', 'Planner item or endpoint was not found.', 5);
      if (response.status === 400 || response.status === 422) throw new CliError('validation_error', 'Planner rejected the request.', 3, { http_status: response.status });
      throw new CliError('service_unavailable', 'Planner read was rejected.', 6, { http_status: response.status });
    }
    if (!conforms(shape, body, true)) throw new CliError('bad_response', 'Planner response has an invalid shape.', 6);
    return project(shape, body);
  }
}
