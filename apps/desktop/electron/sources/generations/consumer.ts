import type { FetchPort } from '../../jones-code/wire.js';
import { sha256 } from './canonical-json.js';
import { createGenerationHttp } from './http.js';
import { fileRoute, manifestRoute, relativePath, rootRoute } from './paths.js';
import { GenerationStore } from './store.js';
import type { PointerSnapshot } from './store.js';
import { GenerationError, requireGeneration } from './types.js';
import type { FileResult, GenerationBinding, GenerationConsumer, GenerationIdentity, GenerationManifest, RefreshResult } from './types.js';
import { GENERATION_LIMITS, identityOf, parseHealth, parseRef, requiredFiles, validateBinding, validateManifest } from './wire.js';

export interface GenerationConsumerOptions { storeRoot: string; binding: GenerationBinding; fetch?: FetchPort; timeoutMs?: number }

export function createGenerationConsumer(options: GenerationConsumerOptions): GenerationConsumer {
  const binding = validateBinding(options.binding);
  const timeoutMs = options.timeoutMs ?? 20_000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 2_147_483_647) throw new TypeError('Invalid timeoutMs');
  const store = new GenerationStore(options.storeRoot);
  const http = createGenerationHttp(binding.origin, options.fetch ?? fetch, timeoutMs);
  const root = rootRoute(binding.rootId);
  let running: Promise<RefreshResult> | null = null;
  let queued: { promise: Promise<RefreshResult>; resolve: (result: RefreshResult) => void } | null = null;
  let lastGood: GenerationIdentity | null = null;

  async function snapshot(): Promise<PointerSnapshot> {
    const value = await store.snapshot(binding.rootId);
    lastGood = value.pointer?.generation ?? null;
    // A stored identity with a different binding is never served as this source.
    store.assertBinding(value, binding);
    return value;
  }
  async function refreshOnce(): Promise<RefreshResult> {
    try {
      const expected = await snapshot();
      const previous = expected.pointer?.generation ?? null;
      const ref = parseRef(await http.get(root + '/ref.json', 64 * 1024), binding, previous);
      const health = parseHealth(await http.get(root + '/health.json', 64 * 1024), binding, ref);
      const generation = identityOf(ref);
      const bytes = await http.get(manifestRoute(generation), GENERATION_LIMITS.manifestBytes, true);
      const manifest = validateManifest(bytes, ref, binding);
      const needed = new Set(requiredFiles(manifest));
      for (const item of manifest.files) {
        if (!needed.has(item.path)) continue;
        const retained = await store.readBlob(item);
        if (retained !== null) continue;
        const bytes = await http.get(fileRoute(generation, item.path), item.size, true);
        requireGeneration(bytes.length === item.size && sha256(bytes) === item.sha256, 'blob_mismatch');
        await store.putBlob(item, bytes);
      }
      if (previous && previous.epoch === generation.epoch && previous.sequence === generation.sequence
        && previous.manifestSha256 === generation.manifestSha256) {
        // Restore missing local metadata without manufacturing an activation.
        await store.putManifest(generation, bytes, binding);
        await store.confirmCurrent(expected, binding.rootId);
        return { status: 'current', generation, health };
      }
      await store.putManifest(generation, bytes, binding);
      await store.activate(expected, binding, generation);
      lastGood = generation;
      return { status: 'activated', generation, previous, health };
    } catch (error) {
      // Re-read after supersession so the hold identifies the actual last-good.
      if (!store.uncertain) {
        try { await snapshot(); } catch { /* Preserve the last proved identity. */ }
      }
      return { status: 'held', reason: store.uncertain ? 'store_uncertain'
        : error instanceof GenerationError ? error.reason : 'store_unavailable', lastGood };
    }
  }
  function start(resolveQueued?: (result: RefreshResult) => void): Promise<RefreshResult> {
    const promise = refreshOnce();
    running = promise;
    void promise.then(result => {
      resolveQueued?.(result);
      const next = queued;
      queued = null;
      running = null;
      if (next) start(next.resolve);
    });
    return promise;
  }
  async function localManifest(): Promise<GenerationManifest | null> {
    const value = await snapshot();
    return value.pointer ? store.manifest(value.pointer.generation, binding) : null;
  }
  return {
    refresh() {
      if (!running) return start();
      if (!queued) {
        let resolve: (result: RefreshResult) => void = () => {};
        const promise = new Promise<RefreshResult>(done => { resolve = done; });
        queued = { promise, resolve };
      }
      return queued.promise;
    },
    async current() {
      try { return (await snapshot()).pointer?.generation ?? null; }
      catch { return null; }
    },
    async manifest() {
      try { return await localManifest(); }
      catch { return null; }
    },
    async readFile(path): Promise<FileResult> {
      try { relativePath(path); }
      catch { return { ok: false, reason: 'invalid_path' }; }
      if (store.uncertain) return { ok: false, reason: 'store_uncertain' };
      try {
        const manifest = await localManifest();
        const item = manifest?.files.find(file => file.path === path);
        if (!item) return { ok: false, reason: 'not_in_generation' };
        const bytes = await store.readBlob(item);
        return bytes === null ? { ok: false, reason: 'unavailable' } : { ok: true, bytes, mediaType: item.media_type };
      } catch (error) {
        return { ok: false, reason: store.uncertain ? 'store_uncertain'
          : error instanceof GenerationError && error.reason === 'blob_mismatch' ? 'blob_mismatch' : 'unavailable' };
      }
    }
  };
}
