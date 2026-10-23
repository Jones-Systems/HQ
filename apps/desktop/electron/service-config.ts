import { readFile, mkdir, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import type { ServiceConfigStatus, ServiceDomain } from '@hq/contracts/services';

const rejected = (): ServiceConfigStatus => ({ configured: false, policy: 'rejected', transport: null });
const absent = (): ServiceConfigStatus => ({ configured: false, policy: 'ok', transport: null });
export function endpoint(value: unknown): URL | null {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    if (url.username || url.password || url.search || url.hash) return null;
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['127.0.0.1', '[::1]', 'localhost'].includes(url.hostname))) return null;
    return new URL(url.origin);
  } catch { return null; }
}
export function isDomain(value: unknown): value is ServiceDomain { return value === 'social' || value === 'work'; }
export interface ServiceConfig {
  get(domain: ServiceDomain): URL | null;
  status(domain: unknown): ServiceConfigStatus;
  set(input: unknown): Promise<ServiceConfigStatus>;
}
/** Endpoints exist only in main memory and its private userData file; status has no address. */
export async function openServiceConfig(root: string): Promise<ServiceConfig> {
  const path = join(root, 'service-config.json');
  let state: Partial<Record<ServiceDomain, string | null>> = {};
  try {
    const saved: unknown = JSON.parse(await readFile(path, 'utf8'));
    if (saved && typeof saved === 'object') for (const domain of ['social', 'work'] as const) {
      if (Object.hasOwn(saved, domain)) {
        const value = (saved as Record<string, unknown>)[domain];
        state[domain] = endpoint(value)?.origin ?? null;
      }
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') state = { social: null, work: null };
  }
  let queue = Promise.resolve();
  const status = (domain: unknown): ServiceConfigStatus => {
    if (!isDomain(domain)) return rejected();
    if (!Object.hasOwn(state, domain)) return absent();
    const url = endpoint(state[domain]);
    return url ? { configured: true, policy: 'ok', transport: url.protocol === 'https:' ? 'https' : 'loopback-http' } : rejected();
  };
  return {
    get: (domain) => endpoint(state[domain]), status,
    set(input) {
      let result: ServiceConfigStatus = rejected();
      const run = queue.then(async () => {
        if (!input || typeof input !== 'object' || Array.isArray(input)) return;
        const p = input as Record<string, unknown>;
        if (!isDomain(p.domain) || Object.keys(p).sort().join(',') !== 'baseUrl,domain') return;
        const domain = p.domain;
        const next = { ...state, [domain]: endpoint(p.baseUrl)?.origin ?? null };
        // Invalidate old config even when persistence fails; never silently keep an old target active.
        state[domain] = null;
        try {
          await mkdir(root, { recursive: true, mode: 0o700 });
          await writeFile(path + '.tmp', JSON.stringify(next), { mode: 0o600 });
          await rename(path + '.tmp', path);
          state = next;
          result = status(domain);
        } catch { /* Sanitized failure; no path or URL crosses IPC. */ }
      });
      queue = run.catch(() => {});
      return run.then(() => result);
    },
  };
}
