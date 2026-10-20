// Thin fetch wrapper. Every mutation carries an X-Request-Id; re-sending the
// same id after a lost response is answered from the server's record instead
// of being applied twice, so "unconfirmed" changes can be retried safely.

const TIMEOUT_MS = 15000;

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

async function request(method, path, body, requestId) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const headers = { Accept: 'application/json' };
  const init = { method, headers, signal: controller.signal, credentials: 'same-origin', cache: 'no-store' };
  if (method !== 'GET') {
    headers['Content-Type'] = 'application/json';
    headers['X-Planning-Request'] = '1';
    if (requestId) headers['X-Request-Id'] = requestId;
    init.body = JSON.stringify(body || {});
  }
  let response;
  try {
    response = await fetch(path, init);
  } catch (err) {
    throw new NetworkError(err && err.name === 'AbortError'
      ? 'The planning server did not answer in time.'
      : 'The planning server could not be reached.');
  } finally {
    clearTimeout(timer);
  }
  let payload = null;
  try {
    payload = await response.json();
  } catch {
    if (response.ok) throw new NetworkError('The server answered with an unreadable response.');
  }
  if (!response.ok) throw new ApiError(response.status, payload);
  return payload;
}

export const api = {
  state: () => request('GET', '/api/state'),
  version: () => request('GET', '/api/version'),
  history: (id) => request('GET', `/api/items/${encodeURIComponent(id)}/history`),
  backups: () => request('GET', '/api/backups'),
  send: (method, path, body, requestId) => request(method, path, body, requestId),
};
