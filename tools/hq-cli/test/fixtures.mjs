export const date = (overrides = {}) => ({ id: 'date0001', kind: 'target', precision: 'day', value: '2026-11-01', time: null, end_time: null, tz: null, note: '', ...overrides });
export const item = (overrides = {}) => ({ id: 'item0001', revision: 3, title: 'Synthetic task', kind: 'idea', status: 'inbox', motivation: null, horizon: null, priority: null, area: null, notes: '', next_steps: [], references: [], dates: [], position: -1024, is_example: false, created_at: '2026-10-20T12:00:00Z', updated_at: '2026-10-20T13:00:00Z', archived_at: null, reviewed_at: null, ...overrides });
export const state = (overrides = {}) => ({ state_version: 8, server_time: '2026-11-01T03:30:00Z', settings: { default_tz: 'America/New_York', week_start: 'sun', stale_days: 21 }, items: [], ...overrides });
export const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
export function harness(routes, extra = {}) {
  const calls = [];
  const deps = { env: { HQ_PLANNER_URL: 'http://127.0.0.1:3210' }, clock: () => new Date('2026-11-01T03:30:00Z'), fetch: async (url, options) => {
    calls.push({ url, options });
    const route = new URL(url).pathname;
    if (!(route in routes)) throw new Error('Unexpected route');
    return typeof routes[route] === 'function' ? routes[route](url, options) : json(routes[route]);
  }, ...extra };
  return { calls, deps };
}
