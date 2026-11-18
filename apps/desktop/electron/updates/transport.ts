import { request } from 'node:https';
import { setTimeout as delay } from 'node:timers/promises';
import { API_ROOT, REPOSITORY_URL, UpdateFailure, checkAbort } from './contract.js';

export interface Transfer {
  readonly status: number;
  readonly headers: Readonly<Record<string, string | undefined>>;
  readonly body: AsyncIterable<Uint8Array>;
  close(): void;
}
export type Transport = (url: URL, signal: AbortSignal) => Promise<Transfer>;

export function allowedURL(url: URL, redirected = false): boolean {
  if (url.protocol !== 'https:' || url.username || url.password || url.port || url.hash) return false;
  if (url.href.startsWith(`${API_ROOT}/`) || url.href === API_ROOT) return !redirected;
  if (url.origin === 'https://github.com' && url.pathname.startsWith(`${new URL(REPOSITORY_URL).pathname}/releases/download/`)) return !url.search;
  return redirected && ['release-assets.githubusercontent.com', 'objects.githubusercontent.com'].includes(url.hostname);
}

export const nodeTransport: Transport = async (initial, signal) => {
  let target = initial;
  for (let redirect = 0; redirect <= 3; redirect++) {
    checkAbort(signal);
    if (!allowedURL(target, redirect > 0)) throw new UpdateFailure('provenance');
    const response = await new Promise<import('node:http').IncomingMessage>((resolve, reject) => {
      const req = request(target, {
        method: 'GET', signal, timeout: 15000,
        headers: { accept: 'application/json, application/octet-stream', 'user-agent': 'HQ-updater/1', 'x-github-api-version': '2022-11-28', 'accept-encoding': 'identity' },
      }, resolve);
      req.once('timeout', () => req.destroy(new UpdateFailure('network')));
      req.once('error', reject);
      req.end();
    });
    if ([301, 302, 303, 307, 308].includes(response.statusCode ?? 0)) {
      const location = response.headers.location;
      response.destroy();
      if (!location || redirect === 3 || target.hostname === 'api.github.com') throw new UpdateFailure('provenance');
      target = new URL(location, target);
      continue;
    }
    const headers = Object.fromEntries(Object.entries(response.headers).map(([key, value]) => [key, Array.isArray(value) ? value.join(',') : value]));
    return { status: response.statusCode ?? 0, headers, body: response, close: () => response.destroy() };
  }
  throw new UpdateFailure('network');
};

export async function requestOK(transport: Transport, url: URL, signal: AbortSignal): Promise<Transfer> {
  for (let attempt = 0; attempt < 3; attempt++) {
    checkAbort(signal);
    try {
      const response = await transport(url, signal);
      if (response.status >= 200 && response.status < 300) return response;
      response.close();
      if (response.status === 429 || response.status === 403 && response.headers['x-ratelimit-remaining'] === '0') throw new UpdateFailure('rate-limited');
      if (response.status >= 500) throw new UpdateFailure('network');
      throw new UpdateFailure('provenance');
    } catch (error) {
      checkAbort(signal);
      if (error instanceof UpdateFailure && error.code !== 'network') throw error;
      if (attempt === 2) throw new UpdateFailure('network');
      await delay(250 * 2 ** attempt, undefined, { signal });
    }
  }
  throw new UpdateFailure('network');
}

export function contentLength(response: Transfer, limit: number, expected?: number): number | null {
  if (response.headers['content-encoding'] && response.headers['content-encoding'] !== 'identity') throw new UpdateFailure('integrity');
  const raw = response.headers['content-length'];
  if (raw === undefined) return null;
  if (!/^(0|[1-9][0-9]*)$/.test(raw)) throw new UpdateFailure('integrity');
  const length = Number(raw);
  if (!Number.isSafeInteger(length) || length > limit || expected !== undefined && length !== expected) throw new UpdateFailure('integrity');
  return length;
}

export async function readBytes(transport: Transport, url: URL, limit: number, signal: AbortSignal, expected?: number): Promise<Buffer> {
  const response = await requestOK(transport, url, signal);
  try {
    const length = contentLength(response, limit, expected);
    const parts: Buffer[] = [];
    let size = 0;
    for await (const part of response.body) {
      checkAbort(signal);
      size += part.byteLength;
      if (size > limit || expected !== undefined && size > expected) throw new UpdateFailure('integrity');
      parts.push(Buffer.from(part));
    }
    checkAbort(signal);
    if (length !== null && size !== length || expected !== undefined && size !== expected) throw new UpdateFailure('integrity');
    return Buffer.concat(parts, size);
  } finally { response.close(); }
}
