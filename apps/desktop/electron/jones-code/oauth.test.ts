import { afterEach, expect, it, vi } from 'vitest';
import type { IncomingMessage, ServerResponse } from 'node:http';
const fake = vi.hoisted(() => ({ createServer: vi.fn() }));
vi.mock('node:http', () => ({ createServer: fake.createServer }));
import { authorizeJones, parseOAuthCallback } from './oauth';
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); fake.createServer.mockReset(); });
it('rejects malformed, multibyte, duplicate and wrong-issuer callback state without throwing', () => {
  const state = 'a'.repeat(43), issuer = 'https://example.com';
  for (const url of ['http://[invalid', `/callback?state=${'é'.repeat(43)}&iss=${issuer}&code=code`, `/callback?state=${state}&state=${state}&iss=${issuer}&code=code`, `/callback?state=${state}&iss=https://other.example&code=code`, '/callback?state=wrong']) {
    expect(() => parseOAuthCallback(url, 'GET', state, issuer)).not.toThrow(); expect(parseOAuthCallback(url, 'GET', state, issuer)).toBeNull();
  }
  expect(parseOAuthCallback(`/callback?state=${state}&iss=${issuer}&code=synthetic`, 'GET', state, issuer)).toEqual({ code: 'synthetic' });
  expect(parseOAuthCallback(`/callback?state=${state}&iss=${issuer}&error=denied`, 'GET', state, issuer)).toEqual({ error: true });
});

function authorizationFixture(stallToken = false) {
  vi.useFakeTimers();
  vi.spyOn(AbortSignal, 'timeout').mockImplementation(milliseconds => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(new DOMException('Synthetic request timeout', 'TimeoutError')), milliseconds);
    return controller.signal;
  });
  let onRequest!: (request: IncomingMessage, response: ServerResponse) => void;
  const server = {
    listening: false,
    once: vi.fn(),
    listen: vi.fn((_port: number, _host: string, done: () => void) => { server.listening = true; done(); }),
    address: () => ({ port: 12345 }),
    closeAllConnections: vi.fn(),
    close: vi.fn((done: () => void) => { server.listening = false; done(); }),
  };
  fake.createServer.mockImplementation(listener => { onRequest = listener; return server; });
  const tokenRequest = vi.fn(async (_url: unknown, options?: RequestInit): Promise<Response> => {
    const signal = options!.signal!;
    signal.throwIfAborted();
    if (stallToken) return await new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
    return Response.json({ access_token: 'synthetic-token', token_type: 'Bearer', expires_in: 3600 });
  });
  const fetcher = vi.fn<typeof fetch>(async (url, options) => {
    if (new URL(String(url)).pathname === '/oauth/mcp/register') return Response.json({ client_id: 'synthetic-client' });
    return await tokenRequest(url, options);
  });
  const openBrowser = vi.fn(async (_url: string) => {});
  const settled = vi.fn();
  const authorization = authorizeJones('https://example.com', openBrowser, fetcher).then(
    value => { settled('success'); return { value }; },
    error => { settled('error'); return { error }; },
  );
  function consent() {
    const url = new URL(openBrowser.mock.calls[0]![0]);
    const response = { setHeader: vi.fn(), end: vi.fn(), writeHead: vi.fn() };
    onRequest({ method: 'GET', url: `/callback?${new URLSearchParams({ state: url.searchParams.get('state')!, iss: 'https://example.com', code: 'synthetic-code' })}` } as IncomingMessage, response as unknown as ServerResponse);
    expect(response.end).toHaveBeenCalledWith('Authorization received. Return to HQ.');
  }
  function closed() { expect(server.closeAllConnections).toHaveBeenCalledOnce(); expect(server.close).toHaveBeenCalledOnce(); expect(server.listening).toBe(false); }
  return { authorization, openBrowser, tokenRequest, settled, consent, closed };
}
it('starts the token timeout only after consent that takes more than twenty seconds', async () => {
  const f = authorizationFixture();
  await vi.advanceTimersByTimeAsync(21000);
  expect(f.openBrowser).toHaveBeenCalledOnce(); expect(f.tokenRequest).not.toHaveBeenCalled(); expect(f.settled).not.toHaveBeenCalled();
  f.consent();
  expect(await f.authorization).toMatchObject({ value: { accessToken: 'synthetic-token', base: 'https://example.com' } });
  expect(f.tokenRequest).toHaveBeenCalledOnce(); f.closed();
});
it('still aborts a stalled token transport after twenty seconds', async () => {
  const f = authorizationFixture(true);
  await vi.advanceTimersByTimeAsync(0); f.consent();
  await vi.advanceTimersByTimeAsync(19999); expect(f.settled).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  expect(await f.authorization).toMatchObject({ error: { name: 'TimeoutError' } });
  expect(f.tokenRequest).toHaveBeenCalledOnce(); f.closed();
});
it('still expires browser consent after three minutes without a token request', async () => {
  const f = authorizationFixture();
  await vi.advanceTimersByTimeAsync(179999); expect(f.settled).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  expect(await f.authorization).toMatchObject({ error: { message: 'Authorization timed out' } });
  expect(f.tokenRequest).not.toHaveBeenCalled(); f.closed();
});
