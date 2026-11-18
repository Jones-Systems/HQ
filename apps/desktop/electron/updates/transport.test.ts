import { expect, it, vi } from 'vitest';
import { allowedURL, readBytes, requestOK } from './transport.js';
import { API_ROOT } from './contract.js';
import { response, transport } from './fixtures.test-support.js';

it('pins public repository URLs and only permits bounded release CDN redirects', () => {
  expect(allowedURL(new URL(API_ROOT))).toBe(true);
  expect(allowedURL(new URL(`${API_ROOT}/releases?per_page=20`))).toBe(true);
  for (const url of ['http://api.github.com/repos/Jones-Systems/HQ', 'https://api.github.com/repos/other/HQ', 'https://user:secret@api.github.com/repos/Jones-Systems/HQ', 'https://github.com/other/HQ/releases/download/tag/a.zip', 'https://release-assets.githubusercontent.com/a']) expect(allowedURL(new URL(url))).toBe(false);
  expect(allowedURL(new URL('https://release-assets.githubusercontent.com/a?signature=public'), true)).toBe(true);
  expect(allowedURL(new URL('https://private.example/a'), true)).toBe(false);
});
it('rejects size overflow, truncation, content encoding and mismatched Content-Length', async () => {
  const url = new URL(API_ROOT), signal = new AbortController().signal;
  await expect(readBytes(transport(Buffer.from('1234')), url, 3, signal)).rejects.toMatchObject({ code: 'integrity' });
  await expect(readBytes(transport(Buffer.from('12')), url, 3, signal, 3)).rejects.toMatchObject({ code: 'integrity' });
  await expect(readBytes(transport(Buffer.from('123'), { 'content-length': '4' }), url, 8, signal)).rejects.toMatchObject({ code: 'integrity' });
  await expect(readBytes(transport(Buffer.from('123'), { 'content-encoding': 'gzip' }), url, 8, signal)).rejects.toMatchObject({ code: 'integrity' });
});
it('closes cancelled transfers and stops on rate limiting without repeated requests', async () => {
  const controller = new AbortController(), close = vi.fn();
  const transfer = { ...response(Buffer.alloc(0)), close, body: (async function* () { yield Buffer.from('a'); controller.abort(); yield Buffer.from('b'); })() };
  await expect(readBytes(async () => transfer, new URL(API_ROOT), 8, controller.signal)).rejects.toMatchObject({ code: 'cancelled' });
  expect(close).toHaveBeenCalledOnce();
  const limited = vi.fn(async () => response(Buffer.alloc(0), { 'x-ratelimit-remaining': '0' }, 403));
  await expect(requestOK(limited, new URL(API_ROOT), new AbortController().signal)).rejects.toMatchObject({ code: 'rate-limited' });
  expect(limited).toHaveBeenCalledOnce();
});
