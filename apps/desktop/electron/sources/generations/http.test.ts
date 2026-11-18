import { expect, it, vi } from 'vitest';
import type { FetchPort } from '../../jones-code/wire.js';
import { createGenerationHttp } from './http.js';

it('uses unconditional GET with redirect rejection and preserves binary bytes', async () => {
  const fetcher = vi.fn<FetchPort>(async () => new Response(new Uint8Array([0xff, 0, 0xc3])));
  const http = createGenerationHttp('http://127.0.0.1:43210', fetcher, 1000);
  expect(await http.get('/fixed', 3)).toEqual(new Uint8Array([0xff, 0, 0xc3]));
  expect(fetcher).toHaveBeenCalledWith('http://127.0.0.1:43210/fixed', expect.objectContaining({
    method: 'GET', redirect: 'error', signal: expect.any(AbortSignal), credentials: 'omit', cache: 'no-store' }));
  expect(fetcher.mock.calls[0][1]?.headers).toBeUndefined();
});
it('holds for non-200 responses and distinguishes missing pinned generations', async () => {
  for (const status of [204, 304, 302, 401, 500]) {
    const http = createGenerationHttp('http://127.0.0.1:43210', async () => new Response(null, { status }), 1000);
    await expect(http.get('/fixed', 10)).rejects.toMatchObject({ reason: 'http_status' });
  }
  const http = createGenerationHttp('http://127.0.0.1:43210', async () => new Response(null, { status: 404 }), 1000);
  await expect(http.get('/fixed', 10, true)).rejects.toMatchObject({ reason: 'generation_missing' });
  await expect(http.get('/fixed', 10)).rejects.toMatchObject({ reason: 'http_status' });
});
it('enforces advertised and streamed caps including zero-byte declarations', async () => {
  for (const [response, cap] of [[new Response('abcd', { headers: { 'content-length': '4' } }), 3],
    [new Response('abcd'), 3], [new Response('x'), 0]] as const) {
    const http = createGenerationHttp('http://127.0.0.1:43210', async () => response, 1000);
    await expect(http.get('/fixed', cap)).rejects.toMatchObject({ reason: 'response_too_large' });
  }
  const http = createGenerationHttp('http://127.0.0.1:43210', async () => new Response(new Uint8Array()), 1000);
  expect(await http.get('/fixed', 0)).toEqual(new Uint8Array());
});
it('ends a stalled body at the request deadline and cancels its reader', async () => {
  const cancelled = vi.fn();
  const body = new ReadableStream<Uint8Array>({ pull() { return new Promise(() => {}); }, cancel: cancelled });
  const http = createGenerationHttp('http://127.0.0.1:43210', async () => new Response(body), 10);
  await expect(http.get('/fixed', 10)).rejects.toMatchObject({ reason: 'transport_unavailable' });
  expect(cancelled).toHaveBeenCalledOnce();
});
