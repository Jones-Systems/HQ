/**
 * Automatic background refresh for the bridged Discovery environment.
 *
 * Discovery's service already owns a bounded loop (`startBackgroundRefresh`: one cycle at a time, the next scheduled
 * only after the current one ends, the first one full interval after arming, each source timed out). This module is
 * the production caller. It arms that loop only while a projects folder is enrolled, re-arms it when the folder is
 * replaced or forgotten (the bridged environment rebuilds its service then), and never refreshes on open.
 *
 * Nothing is stored here. A failed cycle leaves the cached catalog and its freshness stamps as the service keeps
 * them, so what the page shows is always the last successful read. Renderer-safe: no imports at runtime.
 */

export const DISCOVERY_AUTO_REFRESH = { intervalMs: 5 * 60_000, minIntervalMs: 60_000, maxIntervalMs: 60 * 60_000 } as const;

export interface DiscoveryAutoRefreshPolicy {
  /** `false` keeps the environment unscheduled. Default: enabled. */
  readonly enabled?: boolean;
  /** Time between the end of one cycle and the start of the next. Clamped to 1–60 minutes. */
  readonly intervalMs?: number;
}

/** The part of Discovery's service this module drives. */
export interface BackgroundRefreshService {
  startBackgroundRefresh(intervalMs: number): () => void;
  stopBackgroundRefresh(): void;
}

/** The structural subset of the bridged Discovery environment this module reads. */
export interface DiscoveryEnvLike {
  readonly service: BackgroundRefreshService;
  roots(): readonly unknown[];
  chooseRoot?: () => Promise<void>;
  forget?: () => Promise<void>;
}

export type AutoRefreshedDiscovery<E> = E & { stopAutoRefresh(): void };

/** The interval actually used: the default for a missing or non-finite value, otherwise clamped to 1–60 minutes. */
export function discoveryRefreshInterval(requested?: number): number {
  const { intervalMs, minIntervalMs, maxIntervalMs } = DISCOVERY_AUTO_REFRESH;
  const value = typeof requested === 'number' && Number.isFinite(requested) ? requested : intervalMs;
  return Math.min(maxIntervalMs, Math.max(minIntervalMs, value));
}

/** Decorates a bridged Discovery environment so its service refreshes in the background while a folder is enrolled. */
export function withDiscoveryAutoRefresh<E extends DiscoveryEnvLike>(env: E, policy: DiscoveryAutoRefreshPolicy = {}): AutoRefreshedDiscovery<E> {
  const interval = discoveryRefreshInterval(policy.intervalMs);
  let disposed = false;
  let armed: { readonly service: BackgroundRefreshService; readonly enrolled: boolean } | null = null;

  const disarm = () => {
    const current = armed;
    armed = null;
    if (!current) return;
    try { current.service.stopBackgroundRefresh(); } catch { /* the old service is already gone */ }
  };
  // Arms the live service by the arming rule: a folder is enrolled and the policy has not switched refresh off.
  const arm = () => {
    if (disposed) return;
    const service = env.service;
    const enrolled = env.roots().length > 0;
    if (policy.enabled !== false && enrolled) service.startBackgroundRefresh(interval);
    armed = { service, enrolled };
  };
  // After an enrollment change: only a different service or enrollment state moves the schedule. A rejected, cancelled
  // or busy operation leaves both alone, so a failed action never resets a running timer.
  const reconcile = () => {
    if (disposed) return;
    const enrolled = env.roots().length > 0;
    if (armed && armed.service === env.service && armed.enrolled === enrolled) return;
    disarm();
    arm();
  };
  const guarded = (operation: () => Promise<void>) => async (): Promise<void> => {
    try { await operation(); } finally { reconcile(); }
  };

  arm();
  const overrides: PropertyDescriptorMap = {
    stopAutoRefresh: { value: () => { disposed = true; disarm(); }, enumerable: true },
  };
  // The prototype chain keeps the environment's live `service` getter (it is rebuilt on choose and forget) and keeps
  // `'chooseRoot' in env` true for the view. Only the operations the environment has are overridden.
  if (typeof env.chooseRoot === 'function') overrides.chooseRoot = { value: guarded(() => env.chooseRoot!()), enumerable: true };
  if (typeof env.forget === 'function') overrides.forget = { value: guarded(() => env.forget!()), enumerable: true };
  return Object.create(env, overrides) as AutoRefreshedDiscovery<E>;
}

/**
 * Wraps the workspace's lazy `discoveryEnv()`. The same source promise always maps to the same decorated promise
 * (readers rely on `discoveryEnv() === discoveryEnv()`); a rebuilt source promise gets a fresh decoration and a
 * rejected one rejects with the same error.
 */
export function autoRefreshedDiscovery<E extends DiscoveryEnvLike>(source: () => Promise<E>, policy?: DiscoveryAutoRefreshPolicy): () => Promise<AutoRefreshedDiscovery<E>> {
  const decorated = new WeakMap<Promise<E>, Promise<AutoRefreshedDiscovery<E>>>();
  return () => {
    const promise = source();
    let result = decorated.get(promise);
    if (!result) {
      result = promise.then((env) => withDiscoveryAutoRefresh(env, policy));
      decorated.set(promise, result);
    }
    return result;
  };
}
