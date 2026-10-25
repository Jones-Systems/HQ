import { expect, it } from 'vitest';
import { createGenerationConsumer } from './index.js';
import type { GenerationBinding, RefreshResult } from './index.js';

it('rejects invalid public construction synchronously before any source or storage effects', () => {
  const binding: GenerationBinding = { origin: 'http://127.0.0.1:43210', publisherId: 'public-publisher', hostId: 'public-host', rootId: 'public-root',
    bindingRevision: 'public-revision', scopeDigest: 'a'.repeat(64), consistencyMode: 'observed-files-v1' };
  const fetcher = async (): Promise<Response> => { throw Error('construction must not fetch'); };
  for (const origin of ['https://127.0.0.1:43210', 'http://localhost:43210', 'http://[::1]:43210', 'http://127.0.0.1:43210/path',
    'http://127.0.0.1:43210?query', 'http://user@127.0.0.1:43210'])
    expect(() => createGenerationConsumer({ storeRoot: '/synthetic-unused-store', binding: { ...binding, origin }, fetch: fetcher })).toThrow(TypeError);
  expect(() => createGenerationConsumer({ storeRoot: 'relative', binding, fetch: fetcher })).toThrow(TypeError);
  for (const timeoutMs of [0, -1, 0.5, NaN, 2_147_483_648])
    expect(() => createGenerationConsumer({ storeRoot: '/synthetic-unused-store', binding, timeoutMs, fetch: fetcher })).toThrow(TypeError);
  const consumer = createGenerationConsumer({ storeRoot: '/synthetic-unused-store', binding, fetch: fetcher });
  const refresh: () => Promise<RefreshResult> = consumer.refresh;
  expect(typeof refresh).toBe('function');
});
