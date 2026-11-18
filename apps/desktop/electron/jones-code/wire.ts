import { record } from '../services.js';
export const MAX_WIRE_BYTES = 8 * 1024 * 1024;
export type FetchPort = typeof fetch;
export async function boundedResponse(response: Response, limit = MAX_WIRE_BYTES): Promise<string> {
  if (Number(response.headers.get('content-length')) > limit) { await response.body?.cancel(); throw Error('Response oversized'); }
  const reader = response.body?.getReader(); if (!reader) throw Error('Empty response');
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    for (;;) { const part = await reader.read(); if (part.done) break; size += part.value.length; if (size > limit) throw Error('Response oversized'); chunks.push(part.value); }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  return Buffer.concat(chunks).toString('utf8');
}
export interface McpClient { call(tool: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<unknown>; inspect?(): Promise<{ descriptor: unknown; tools: unknown }> }
export function createMcpClient(options: { base: string; token: () => Promise<string>; unauthorized: () => void; fetch?: FetchPort }): McpClient {
  const fetcher = options.fetch ?? fetch; let next = 0, session: string | null = null, ready: Promise<void> | undefined;
  async function rpc(method: string, params: unknown, notify = false, signal?: AbortSignal): Promise<unknown> {
    const id = ++next;
    const response = await fetcher(new URL('/mcp', options.base), { method: 'POST', redirect: 'error', signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(20000)]) : AbortSignal.timeout(20000),
      headers: { authorization: `Bearer ${await options.token()}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-protocol-version': '2025-03-26', ...(session ? { 'mcp-session-id': session } : {}) },
      body: JSON.stringify({ jsonrpc: '2.0', ...(notify ? {} : { id }), method, params }) });
    if (response.status === 401) { options.unauthorized(); await response.body?.cancel(); throw Error('needs-authorization'); }
    if (!response.ok) { await response.body?.cancel(); throw Error('MCP response unavailable'); }
    session = response.headers.get('mcp-session-id') ?? session;
    if (notify) { await response.body?.cancel(); return null; }
    const text = await boundedResponse(response);
    const candidates: unknown[] = response.headers.get('content-type')?.includes('text/event-stream')
      ? text.split(/\r?\n\r?\n/).flatMap(block => { const data = block.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => line.slice(5).trim()).join('\n'); return data ? [JSON.parse(data)] : []; }) : [JSON.parse(text)];
    const message = candidates.find(value => record(value) && value.id === id);
    if (!record(message) || message.error || !('result' in message)) throw Error('Malformed MCP result');
    return message.result;
  }
  async function initialize() {
    ready ??= rpc('initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'hq-design', version: '1' } }).then(() => rpc('notifications/initialized', {}, true)).then(() => {});
    await ready;
  }
  return { async inspect() {
    await initialize();
    const response = await fetcher(new URL('/.well-known/t3/environment', options.base), { redirect: 'error', signal: AbortSignal.timeout(20000) });
    if (!response.ok) { await response.body?.cancel(); throw Error('Descriptor unavailable'); }
    const descriptor: unknown = JSON.parse(await boundedResponse(response));
    return { descriptor, tools: await rpc('tools/list', {}) };
  }, async call(tool, args, signal) {
    await initialize();
    const result = await rpc('tools/call', { name: tool, arguments: args }, false, signal);
    if (!record(result)) throw Error('Malformed tool result');
    let value: unknown = result.structuredContent;
    if (value === undefined && Array.isArray(result.content)) {
      const block = result.content.find(v => record(v) && v.type === 'text' && typeof v.text === 'string');
      if (record(block)) value = JSON.parse(String(block.text));
    }
    if (value === undefined) throw Error('Malformed tool result');
    return value;
  } };
}
