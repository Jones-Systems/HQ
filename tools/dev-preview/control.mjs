// The loopback control API in front of a session, plus the route -> session mapping that capture
// steps share. Requests need the session's bearer token, which only the 0600 session file holds.
import { createServer } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { UsageError } from './config.mjs';
import { ROUTES, normalizeRequest } from './steps.mjs';

const MAX_BODY = 1024 * 1024;

/** Runs one validated request against a session. `quit` is handled by the caller. */
export function perform(session, route, body) {
  switch (route) {
    case 'status': return session.status();
    case 'eval': return session.eval(body.expr);
    case 'shot': return session.shot(body.name, { settle: body.settle });
    case 'key': return session.key(body.key, body.mods, body.repeat);
    case 'type': return session.type(body.text);
    case 'click': return session.click(body);
    case 'window': return session.window(body);
    case 'media': return session.media(body);
    case 'errors': return session.errors(body);
    case 'restart': return session.restart();
    case 'svc': return session.svc(body.down, body.target);
    case 'ledger': return session.ledger();
    case 'log': return session.log();
    case 'domain': return session.openDomain(body.name);
    case 'settings': return session.openSettings();
    case 'wait': return session.wait(body);
    case 'settle': return session.settle({ timeout: body.timeout });
    default: throw new UsageError(`Unknown route "${route}"`);
  }
}

function sameToken(given, expected) {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * HTTP server (not yet listening) exposing `POST /<route>` with a JSON body.
 * Requests run one at a time. `onActivity` fires per authenticated request, `onQuit` after `quit` replies.
 */
export function createControlServer(session, { token, onQuit = () => {}, onActivity = () => {}, onError = () => {} }) {
  let queue = Promise.resolve();
  const send = (res, status, payload) => {
    const text = JSON.stringify(payload);
    res.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(text), 'cache-control': 'no-store' });
    res.end(text);
  };
  const refuse = (res, status, message) => send(res, status, { ok: false, error: { name: 'Refused', message } });

  const server = createServer((req, res) => {
    const { port } = server.address();
    const host = (req.headers.host ?? '').toLowerCase();
    if (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`) return refuse(res, 421, 'Unexpected Host header');
    if (req.headers.origin !== undefined) return refuse(res, 403, 'Browser requests are not accepted');
    const bearer = /^Bearer (.+)$/.exec(req.headers.authorization ?? '')?.[1] ?? '';
    if (!sameToken(bearer, token)) return refuse(res, 401, 'Missing or wrong token');
    if (req.method !== 'POST') return refuse(res, 405, 'Use POST');
    if (!(req.headers['content-type'] ?? '').toLowerCase().startsWith('application/json')) return refuse(res, 415, 'Send application/json');
    const route = new URL(req.url, 'http://127.0.0.1').pathname.slice(1);
    if (!ROUTES.includes(route)) return refuse(res, 404, `Unknown route "${route}"`);

    const chunks = [];
    let size = 0;
    req.on('data', chunk => {
      size += chunk.length;
      if (size > MAX_BODY) { req.destroy(); return; }
      chunks.push(chunk);
    });
    req.on('error', () => {});
    req.on('end', () => {
      if (size > MAX_BODY) return;
      onActivity();
      queue = queue.then(async () => {
        try {
          const text = Buffer.concat(chunks).toString('utf8');
          const body = normalizeRequest(route, text ? JSON.parse(text) : {});
          if (route === 'quit') { send(res, 200, { ok: true, value: 'bye' }); setImmediate(onQuit); return; }
          send(res, 200, { ok: true, value: await perform(session, route, body) ?? null });
        } catch (error) {
          const usage = error instanceof UsageError || error instanceof SyntaxError;
          if (!usage) onError(error);
          send(res, usage ? 400 : 500, { ok: false, error: { name: error.name, message: String(error.message).slice(0, 2000) } });
        }
      });
    });
  });
  return server;
}
