// Thin fetch wrapper. Every mutation carries an X-Request-Id. A change whose
// response was lost is re-sent through POST /api/requests/replay with the
// exact original bytes and the state version read before the first send, so
// the server can answer from its record or prove the change was never applied
// instead of applying it twice (see the Planner API replay rules).

const TIMEOUT_MS = 15000;
// Imports and restores can legitimately take longer than an ordinary write.
const LONG_TIMEOUT_MS = 120000;
const LONG_PATHS = /^\/api\/(import(\/|$)|backups\/restore$)/;

// Targets POST /api/requests/replay accepts (server.py _replay_request).
const REPLAYABLE_ITEM = /^\/api\/items\/[A-Za-z0-9_-]{6,40}(\/(move|archive|restore|reviewed))?$/;

export function isReplayable(method, path) {
  if (method === 'POST' && (path === '/api/items' || path === '/api/items/batch')) return true;
  if (method === 'PUT' && path === '/api/settings') return true;
  const match = REPLAYABLE_ITEM.exec(path);
  if (!match) return false;
  return method === (match[1] ? 'POST' : 'PATCH');
}

export class ApiError extends Error {
  constructor(status, payload) {
    super((payload && payload.message) || `Request failed (${status}).`);
    this.status = status;
    this.code = payload && payload.error;
    this.payload = payload || {};
  }
}

/** The request may or may not have reached the server. */
export class NetworkError extends Error {
  constructor(message = 'The planning server could not be reached.') {
    super(message);
  }
}

async function request(method, path, bodyText, requestId) {
  const controller = new AbortController();
  // The timeout covers the body as well as the headers.
  const timer = setTimeout(() => controller.abort(), LONG_PATHS.test(path) ? LONG_TIMEOUT_MS : TIMEOUT_MS);
  const headers = { Accept: 'application/json' };
  const init = { method, headers, signal: controller.signal, credentials: 'same-origin', cache: 'no-store' };
  if (method !== 'GET') {
    headers['Content-Type'] = 'application/json';
    headers['X-Planning-Request'] = '1';
    if (requestId) headers['X-Request-Id'] = requestId;
    init.body = bodyText;
  }
  try {
    let response;
    try {
      response = await fetch(path, init);
    } catch (err) {
      throw new NetworkError(err && err.name === 'AbortError'
        ? 'The planning server did not answer in time.'
        : 'The planning server could not be reached.');
    }
    let payload = null;
    try {
      payload = await response.json();
    } catch {
      if (controller.signal.aborted) throw new NetworkError('The planning server did not answer in time.');
      if (response.ok) throw new NetworkError('The server answered with an unreadable response.');
    }
    if (!response.ok) throw new ApiError(response.status, payload);
    return payload;
  } finally {
    clearTimeout(timer);
  }
}

function base64(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

export const api = {
  state: () => request('GET', '/api/state'),
  version: () => request('GET', '/api/version'),
  history: (id) => request('GET', `/api/items/${encodeURIComponent(id)}/history`),
  backups: () => request('GET', '/api/backups'),
  send: (method, path, body, requestId) => request(method, path, JSON.stringify(body || {}), requestId),
  /** Send already-serialized body bytes, so a later replay can quote them exactly. */
  sendText: (method, path, bodyText, requestId) => request(method, path, bodyText, requestId),
  /**
   * Re-send a write whose outcome is unknown. Resolves to the original route's
   * response, whether the server replayed its record or applied it now.
   */
  async resend({ method, path, bodyText, requestId, sentAfterVersion }) {
    const envelope = { mode: 'resend', request_id: requestId, method, path, body_b64: base64(bodyText) };
    if (Number.isInteger(sentAfterVersion) && sentAfterVersion >= 0) envelope.sent_after_version = sentAfterVersion;
    const result = await request('POST', '/api/requests/replay', JSON.stringify(envelope), null);
    return result.response;
  },
};
