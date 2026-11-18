import type { WikiAdminParams } from '@hq/contracts/wiki-admin';

const invalid = () => ({ ok: false as const, kind: 'invalid' as const });
const ns = (value: unknown) => value === 'bl' || value === 'appdev';
const token = (value: unknown) => typeof value === 'string' && /^[a-f0-9-]{36}$/.test(value);
const revision = (value: unknown) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
export function validWikiAdminRequest(route: unknown, params: unknown): route is keyof WikiAdminParams {
  if (typeof route !== 'string' || typeof params !== 'object' || params === null || Array.isArray(params)) return false;
  const p = params as Record<string, unknown>;
  const exact = (...keys: string[]) => Object.keys(p).every(key => keys.includes(key));
  switch (route) {
    case 'status': case 'importProfile': case 'recheck': return exact();
    case 'chooseRepository': return exact('namespace', 'token') && ns(p.namespace) && (p.token === undefined || token(p.token));
    case 'saveSource': return exact('expectedRevision', 'token') && revision(p.expectedRevision) && token(p.token);
    case 'removeSource': return exact('expectedRevision', 'namespace', 'confirmed') && revision(p.expectedRevision) && ns(p.namespace) && p.confirmed === true;
    case 'reindex': return exact('namespace') && ns(p.namespace);
    default: return false;
  }
}

/** Native selection paths are appended only after the closed renderer request and sender pass validation. */
export function wikiAdminIpcHandler<E>(authorized: (event: E) => boolean, bridge: { admin(route: unknown, params: unknown, selectedPath?: string): Promise<unknown> }, choose: (kind: 'profile' | 'repository') => Promise<string | null>) {
  return async (event: E, route: unknown, params: unknown) => {
    if (!authorized(event)) return { ok: false, kind: 'unavailable' };
    if (!validWikiAdminRequest(route, params)) return invalid();
    try {
      if (route === 'importProfile' || route === 'chooseRepository') {
        const path = await choose(route === 'importProfile' ? 'profile' : 'repository');
        if (path === null) return { ok: true, value: null };
        return await bridge.admin(route, params, path);
      }
      return await bridge.admin(route, params);
    } catch { return { ok: false, kind: 'unavailable' }; }
  };
}
