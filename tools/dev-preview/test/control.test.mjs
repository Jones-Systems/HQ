import assert from 'node:assert/strict';
import { request } from 'node:http';
import test, { after, before } from 'node:test';
import { createControlServer, perform } from '../control.mjs';
import { ROUTES } from '../steps.mjs';

const TOKEN = 't'.repeat(48);

/** A stand-in session that records calls and can be told to fail or stall. */
function fakeSession() {
  const calls = [];
  const log = (name, ...args) => { calls.push([name, ...args]); };
  const session = { calls, running: 0, maxRunning: 0, fail: null, gate: null };
  const op = name => async (...args) => {
    log(name, ...args);
    session.running += 1;
    session.maxRunning = Math.max(session.maxRunning, session.running);
    try {
      if (session.gate) await session.gate;
      if (session.fail) throw new Error(session.fail);
      return { called: name };
    } finally { session.running -= 1; }
  };
  for (const name of ['status', 'eval', 'shot', 'key', 'type', 'click', 'window', 'media', 'errors', 'restart', 'svc', 'ledger', 'log', 'openDomain', 'openSettings', 'wait', 'settle']) session[name] = op(name);
  return session;
}

let server;
let session;
let port;
const quits = [];
const failures = [];
const activity = [];

before(async () => {
  session = fakeSession();
  server = createControlServer(session, { token: TOKEN, onQuit: () => quits.push(Date.now()), onActivity: () => activity.push(1), onError: error => failures.push(error.message) });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  port = server.address().port;
});
after(() => { server.closeAllConnections(); server.close(); });

function call(route, { method = 'POST', body = {}, headers = {}, token = TOKEN, host = `127.0.0.1:${port}`, raw } = {}) {
  return new Promise((resolve, reject) => {
    const payload = raw ?? JSON.stringify(body);
    const req = request({ host: '127.0.0.1', port, path: `/${route}`, method, headers: {
      host, 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload),
      ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers,
    } }, res => {
      let text = '';
      res.on('data', chunk => { text += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, json: text ? JSON.parse(text) : null }));
    });
    req.on('error', reject);
    req.end(payload);
  });
}

test('requests without the right token are refused before anything runs', async () => {
  const before = session.calls.length;
  assert.equal((await call('status', { token: null })).status, 401);
  assert.equal((await call('status', { token: 'wrong' })).status, 401);
  assert.equal((await call('status', { token: TOKEN.slice(0, -1) })).status, 401);
  assert.equal(session.calls.length, before);
});

test('requests that do not look like our own client are refused', async () => {
  assert.equal((await call('status', { host: 'evil.example' })).status, 421);
  assert.equal((await call('status', { host: `127.0.0.1:${port + 1}` })).status, 421);
  assert.equal((await call('status', { headers: { origin: 'http://127.0.0.1' } })).status, 403, 'a browser page cannot drive the session');
  assert.equal((await call('status', { method: 'GET' })).status, 405);
  assert.equal((await call('status', { headers: { 'content-type': 'text/plain' } })).status, 415);
  assert.equal((await call('frobnicate')).status, 404);
});

test('bad JSON and invalid fields are 400s that do not reach the session', async () => {
  const before = session.calls.length;
  assert.equal((await call('eval', { raw: '{ nope' })).status, 400);
  const invalid = await call('click', { body: {} });
  assert.equal(invalid.status, 400);
  assert.equal(invalid.json.ok, false);
  assert.match(invalid.json.error.message, /needs text, selector or x and y/);
  assert.equal((await call('shot', { body: { name: '../escape' } })).status, 400);
  assert.equal(session.calls.length, before);
  assert.deepEqual(failures, [], 'a mistake in a request is not reported as a server failure');
});

test('valid requests reach the session with normalized arguments and reply with ok and value', async () => {
  const reply = await call('key', { body: { key: 'esc', mods: 'ctrl' } });
  assert.deepEqual(reply, { status: 200, json: { ok: true, value: { called: 'key' } } });
  assert.deepEqual(session.calls.at(-1), ['key', 'Escape', ['ctrl'], 1]);
  await call('domain', { body: { name: 'Work' } });
  assert.deepEqual(session.calls.at(-1), ['openDomain', 'Work']);
  await call('shot', { body: { name: 'a.png' } });
  assert.deepEqual(session.calls.at(-1), ['shot', 'a', { settle: true }]);
  await call('svc', { body: { down: true, target: 'work' } });
  assert.deepEqual(session.calls.at(-1), ['svc', true, 'work']);
  assert.ok(activity.length > 0, 'authenticated requests count as activity');
});

test('every route has a handler', async () => {
  const bodies = { eval: { expr: '1' }, shot: {}, key: { key: 'a' }, type: { text: 'x' }, click: { text: 'a' }, window: { reset: true }, media: { reset: true },
    svc: { down: false }, domain: { name: 'Work' }, wait: { ms: 1 } };
  for (const route of ROUTES.filter(name => name !== 'quit')) {
    const reply = await call(route, { body: bodies[route] ?? {} });
    assert.equal(reply.status, 200, `${route}: ${JSON.stringify(reply.json)}`);
  }
  await assert.rejects(async () => perform(session, 'nope', {}), /Unknown route/);
});

test('session failures are 500s carrying the message, and are reported to the owner', async () => {
  session.fail = 'boom from the app';
  try {
    const reply = await call('eval', { body: { expr: '1' } });
    assert.equal(reply.status, 500);
    assert.equal(reply.json.error.message, 'boom from the app');
  } finally { session.fail = null; }
  assert.deepEqual(failures, ['boom from the app']);
  assert.equal((await call('status')).status, 200, 'the server keeps serving');
});

test('requests run one at a time', async () => {
  let release;
  session.gate = new Promise(resolve => { release = resolve; });
  session.maxRunning = 0;
  const pending = [call('eval', { body: { expr: '1' } }), call('eval', { body: { expr: '2' } }), call('eval', { body: { expr: '3' } })];
  await new Promise(resolve => setTimeout(resolve, 100));
  session.gate = null;
  release();
  const replies = await Promise.all(pending);
  assert.ok(replies.every(reply => reply.status === 200));
  assert.equal(session.maxRunning, 1);
  assert.deepEqual(session.calls.filter(entry => entry[0] === 'eval').slice(-3).map(entry => entry[1]).sort(), ['1', '2', '3']);
});

test('quit replies first and only then asks the owner to shut down', async () => {
  const reply = await call('quit');
  assert.deepEqual(reply, { status: 200, json: { ok: true, value: 'bye' } });
  await new Promise(resolve => setTimeout(resolve, 50));
  assert.equal(quits.length, 1);
  assert.equal(session.calls.some(entry => entry[0] === 'quit'), false, 'quit is the owner\'s job, not the session\'s');
});

test('an oversized body is dropped without reaching the session', async () => {
  const before = session.calls.length;
  await assert.rejects(call('eval', { raw: JSON.stringify({ expr: 'x'.repeat(1024 * 1024 + 10) }) }));
  assert.equal(session.calls.length, before);
});
