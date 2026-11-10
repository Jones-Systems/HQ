import type { FetchPort } from '../../jones-code/wire.js';
import { GenerationError, requireGeneration } from './types.js';

async function abortable<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted();
  let abort: () => void = () => {};
  const aborted = new Promise<never>((_resolve, reject) => {
    abort = () => reject(new GenerationError('transport_unavailable'));
    signal.addEventListener('abort', abort, { once: true });
  });
  try { return await Promise.race([operation, aborted]); }
  finally { signal.removeEventListener('abort', abort); }
}
export async function boundedBytes(response: Response, maximum: number, signal: AbortSignal): Promise<Uint8Array> {
  const length = response.headers.get('content-length');
  if (length !== null && /^\d+$/.test(length) && BigInt(length) > BigInt(maximum)) {
    void response.body?.cancel().catch(() => {});
    throw new GenerationError('response_too_large');
  }
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const part = await abortable(reader.read(), signal);
      if (part.done) break;
      size += part.value.byteLength;
      requireGeneration(size <= maximum, 'response_too_large');
      chunks.push(part.value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return bytes;
  } finally {
    // Do not let a stalled remote cancellation extend the request deadline.
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
export function createGenerationHttp(origin: string, fetcher: FetchPort, timeoutMs: number) {
  return {
    async get(path: string, maximum: number, pinned = false): Promise<Uint8Array> {
      const signal = AbortSignal.timeout(timeoutMs);
      try {
        const response = await abortable(fetcher(origin + path, { method: 'GET', redirect: 'error', credentials: 'omit',
          cache: 'no-store', signal }), signal);
        if (response.status !== 200 || response.redirected) {
          void response.body?.cancel().catch(() => {});
          throw new GenerationError(pinned && response.status === 404 ? 'generation_missing' : 'http_status');
        }
        return await boundedBytes(response, maximum, signal);
      } catch (error) {
        if (error instanceof GenerationError) throw error;
        throw new GenerationError('transport_unavailable');
      }
    }
  };
}
