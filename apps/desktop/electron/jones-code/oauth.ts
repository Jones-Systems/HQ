import { createServer } from 'node:http';
import { randomBytes, randomUUID, createHash, timingSafeEqual } from 'node:crypto';
import { boundedResponse, type FetchPort } from './wire.js';
import { record } from '../services.js';
export interface Credential { readonly accessToken: string; readonly expiresAt: number; readonly sessionLabel: string; readonly base: string }
export function parseOAuthCallback(requestUrl: string | undefined, method: string | undefined, state: string, issuer: string): { code: string } | { error: true } | null {
  try {
    const url = new URL(requestUrl ?? '/', 'http://127.0.0.1');
    const returned = url.searchParams.get('state') ?? '';
    const candidate = Buffer.from(returned), expected = Buffer.from(state);
    if (method !== 'GET' || url.pathname !== '/callback' || !/^[A-Za-z0-9_-]+$/.test(returned) || candidate.length !== expected.length || !timingSafeEqual(candidate, expected) || url.searchParams.getAll('state').length !== 1 || url.searchParams.get('iss') !== issuer) return null;
    const code = url.searchParams.get('code');
    return url.searchParams.has('error') || !code || code.length > 8192 ? { error: true } : { code };
  } catch { return null; }
}
export async function authorizeJones(base: string, openBrowser: (url: string) => Promise<void>, fetcher: FetchPort = fetch): Promise<Credential> {
  const verifier = randomBytes(32).toString('base64url'), state = randomBytes(32).toString('base64url');
  let resolveCode!: (code: string) => void, rejectCode!: (error: Error) => void;
  const code = new Promise<string>((resolve, reject) => { resolveCode = resolve; rejectCode = reject; });
  void code.catch(() => {});
  const server = createServer((request, response) => {
    const result = parseOAuthCallback(request.url, request.method, state, new URL(base).origin);
    if (!result) { response.writeHead(400).end('Invalid authorization response.'); return; }
    response.setHeader('Cache-Control', 'no-store'); response.setHeader('Content-Security-Policy', "default-src 'none'");
    if ('error' in result) { response.writeHead(400).end('Authorization declined. Return to HQ.'); rejectCode(Error('Authorization declined')); }
    else { response.end('Authorization received. Return to HQ.'); resolveCode(result.code); }
  });
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    const address = server.address(); if (!address || typeof address === 'string') throw Error('Loopback unavailable');
    const redirect = `http://127.0.0.1:${address.port}/callback`;
    const registered = await fetcher(new URL('/oauth/mcp/register', base), { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(20000), headers: { 'content-type': 'application/json' }, body: JSON.stringify({ client_name: 'HQ Design', redirect_uris: [redirect], token_endpoint_auth_method: 'none', grant_types: ['authorization_code'], response_types: ['code'] }) });
    if (!registered.ok) { await registered.body?.cancel(); throw Error('Client registration unavailable'); }
    const registration: unknown = JSON.parse(await boundedResponse(registered, 65536));
    if (!record(registration) || typeof registration.client_id !== 'string' || registration.client_id.length > 8192) throw Error('Invalid client registration');
    const url = new URL('/oauth/mcp/authorize', base);
    url.search = new URLSearchParams({ response_type: 'code', client_id: registration.client_id, redirect_uri: redirect, code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256', state, resource: new URL('/mcp', base).href, scope: 'orchestration:read orchestration:operate' }).toString();
    timeout = setTimeout(() => rejectCode(Error('Authorization timed out')), 180000);
    await openBrowser(url.href);
    const response = await fetcher(new URL('/oauth/mcp/token', base), { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(20000), headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'authorization_code', code: await code, redirect_uri: redirect, client_id: registration.client_id, code_verifier: verifier, resource: new URL('/mcp', base).href }) });
    if (!response.ok) { await response.body?.cancel(); throw Error('Token exchange unavailable'); }
    const token: unknown = JSON.parse(await boundedResponse(response, 65536));
    if (!record(token) || typeof token.access_token !== 'string' || token.access_token.length > 32768 || String(token.token_type).toLowerCase() !== 'bearer' || !Number.isSafeInteger(token.expires_in) || Number(token.expires_in) <= 0) throw Error('Invalid token response');
    return { accessToken: token.access_token, expiresAt: Date.now() + Number(token.expires_in) * 1000, sessionLabel: randomUUID(), base };
  } finally {
    if (timeout) clearTimeout(timeout);
    server.closeAllConnections();
    if (server.listening) await new Promise<void>(resolve => server.close(() => resolve()));
  }
}
