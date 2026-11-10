import { join, resolve } from 'node:path';
import type { GenerationSourcesResult, GenerationSourceSnapshot } from '@hq/contracts/services';
import { jsonStore, type JsonStore } from '../jones-code/storage.js';
import { keys, record } from '../services.js';
import { createGenerationSources, GenerationSourceError, type GenerationSourceRecord, type GenerationSourcesApi } from './generation-sources.js';

// Share store identity so PR169's writer gate also covers separate host instances.
// This is main-process ownership, not a filesystem or cross-process lock.
const stores = new Map<string, JsonStore<GenerationSourceRecord>>();

export function createGenerationSourcesHost(options: {
  userData: string;
  /** Enabled is a synthetic-test seam only; production callers omit mode. */
  mode?: 'disabled' | 'enabled';
  generations?: GenerationSourcesApi;
}) {
  const mode = options.mode ?? 'disabled';
  let closed = false, serial = Promise.resolve();
  let opening: Promise<ReturnType<typeof createGenerationSources>> | undefined;
  let closing: Promise<void> | undefined;
  let owned: { path: string; store: JsonStore<GenerationSourceRecord> } | undefined;
  function ready() {
    return opening ??= (async () => {
      const generations = options.generations ?? await import('./generations/index.js');
      const directory = resolve(options.userData, 'sources');
      const path = join(directory, 'generation-sources.json');
      const store = stores.get(path) ?? jsonStore<GenerationSourceRecord>(directory, 'generation-sources.json');
      const writer = createGenerationSources({ store, generations,
        storeRootFor: id => join(directory, 'generations', id) });
      stores.set(path, store);
      owned = { path, store };
      return writer;
    })();
  }
  return {
    async call(route: unknown, params: unknown): Promise<GenerationSourcesResult<unknown>> {
      if (mode === 'disabled') return { ok: false, kind: 'unavailable', reason: 'disabled' };
      if (closed) return { ok: false, kind: 'unavailable', reason: 'writer_closed' };
      if (!record(params) || !(route === 'snapshot' && keys(params, [])
        || route === 'serving' && keys(params, ['sourceId']) && typeof params.sourceId === 'string'
        && /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.exec(params.sourceId)?.[0] === params.sourceId))
        return { ok: false, kind: 'invalid' };
      const next = serial.then(async (): Promise<GenerationSourcesResult<unknown>> => {
        try {
          const writer = await ready();
          if (route === 'serving') return { ok: true, value: await writer.serving(params.sourceId as string) };
          const snapshot = await writer.snapshot();
          const sources: GenerationSourceSnapshot[] = [];
          for (const source of snapshot.sources) {
            const serving = await writer.serving(source.sourceId);
            sources.push({ sourceId: source.sourceId, ownerState: source.ownerState,
              issuance: { state: source.issuance, reason: source.reason },
              served: serving.status === 'current' || serving.status === 'pending'
                ? { bindingRevision: serving.served.bindingRevision } : null,
              accepted: { bindingRevision: source.binding.bindingRevision } });
          }
          return { ok: true, value: sources };
        } catch (error) {
          return { ok: false, kind: 'unavailable', reason: error instanceof GenerationSourceError ? error.reason : 'record_unavailable' };
        }
      });
      serial = next.then(() => {}, () => {});
      return next;
    },
    close(): Promise<void> {
      if (!closing) {
        closed = true;
        closing = serial.then(async () => {
          if (opening) {
            // Failed construction owns no writer and must not release another host's store.
            const writer = await opening.catch(() => undefined);
            await writer?.close();
          }
          if (owned && stores.get(owned.path) === owned.store) stores.delete(owned.path);
        });
      }
      return closing;
    },
  };
}
