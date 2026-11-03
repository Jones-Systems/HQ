import { expect, it, vi } from 'vitest';
import { boundedResponse, createMcpClient } from './wire';
it('initializes once and maps the closed tool result without retry', async () => {
  const requests: Record<string, unknown>[] = [];
  const fetcher = vi.fn(async (_url: unknown, init?: RequestInit) => {
    const request = JSON.parse(String(init?.body)); requests.push(request);
    if (request.method === 'notifications/initialized') return new Response(null, { status: 202 });
    return Response.json({ jsonrpc: '2.0', id: request.id, result: request.method === 'initialize' ? {} : { structuredContent: { state: 'absent' } } });
  });
  const client = createMcpClient({ base: 'https://example.com', token: async () => 'synthetic-token', unauthorized: vi.fn(), fetch: fetcher as typeof fetch });
  expect(await client.call('t3_thread_launch_lookup', { clientRequestId: 'key' })).toEqual({ state: 'absent' });
  expect(requests.map(request => request.method)).toEqual(['initialize', 'notifications/initialized', 'tools/call']);
  await client.call('t3_thread_launch_lookup', { clientRequestId: 'key' }); expect(fetcher).toHaveBeenCalledTimes(4);
});
it('invalidates authorization on 401 and makes no consent or retry call', async () => {
  const unauthorized = vi.fn(), fetcher = vi.fn(async () => new Response(null, { status: 401 }));
  const client = createMcpClient({ base: 'https://example.com', token: async () => 'synthetic', unauthorized, fetch: fetcher as typeof fetch });
  await expect(client.call('t3_project_list', {})).rejects.toThrow('needs-authorization'); expect(fetcher).toHaveBeenCalledTimes(1); expect(unauthorized).toHaveBeenCalledOnce();
});
it('bounds response bytes regardless of missing content-length', async () => { await expect(boundedResponse(new Response('a'.repeat(20)), 10)).rejects.toThrow('oversized'); });
