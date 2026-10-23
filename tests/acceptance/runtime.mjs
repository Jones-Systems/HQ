import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

export async function createRuntime(parent) {
  await mkdir(parent, { recursive: true });
  const root = await mkdtemp(join(parent, 'run-'));
  const children = new Set();
  const resources = [];
  function own(label, cleanup) {
    if (closing) throw new Error('Runtime already closing');
    resources.push({ label, cleanup });
  }
  let closing;
  async function stop(child) {
    if (!children.has(child)) return;
    const signal = (name) => {
      try { process.kill(-child.pid, name); } catch (error) { if (error.code !== 'ESRCH') throw error; }
    };
    if (!child.pid) { await child.done; children.delete(child); return; }
    signal('SIGTERM');
    await Promise.race([child.done, delay(2000)]);
    signal('SIGKILL');
    await child.done;
    children.delete(child);
  }
  return {
    root,
    own,
    async listen(server) {
      const sockets = new Set();
      server.on('connection', socket => {
        sockets.add(socket);
        socket.once('close', () => sockets.delete(socket));
      });
      own('HTTP server and sockets', async () => {
        for (const socket of sockets) socket.destroy();
        if (server.listening) await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
      });
      await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', () => { server.off('error', reject); resolve(); });
      });
      return `http://127.0.0.1:${server.address().port}`;
    },
    spawn(command, args, options = {}) {
      if (closing) throw new Error('Runtime already closing');
      const child = spawn(command, args, { ...options, detached: true });
      child.done = new Promise((resolve) => {
        child.once('error', (error) => { child.launchError = error; resolve(); });
        child.once('close', resolve);
      });
      children.add(child);
      return child;
    },
    stop,
    close() {
      return closing ??= (async () => {
        const errors = [];
        for (const resource of [...resources].reverse()) {
          try { await resource.cleanup(); } catch (error) { errors.push(new Error(resource.label, { cause: error })); }
        }
        const results = await Promise.allSettled([...children].map(stop));
        errors.push(...results.filter(result => result.status === 'rejected').map(result => result.reason));
        try { await rm(root, { recursive: true, force: true }); } catch (error) { errors.push(error); }
        if (errors.length) throw new AggregateError(errors, 'Owned resource cleanup failed');
      })();
    },
  };
}

export async function until(probe, label, timeout = 20000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const result = await probe();
    if (result) return result;
    await delay(100);
  }
  throw new Error(`Timed out: ${label}`);
}

export async function connect(url, runtime) {
  const socket = new WebSocket(url);
  runtime?.own('CDP socket', async () => {
    if (socket.readyState === WebSocket.CLOSED) return;
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('CDP close timeout')), 2000);
      socket.addEventListener('close', () => { clearTimeout(timer); resolve(); }, { once: true });
      socket.close();
    });
  });
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });
  let sequence = 0;
  const pending = new Map();
  socket.addEventListener('message', ({ data }) => {
    const message = JSON.parse(data);
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    clearTimeout(request.timer);
    if (message.error) request.reject(new Error(message.error.message));
    else request.resolve(message.result);
  });
  socket.addEventListener('close', () => {
    for (const request of pending.values()) {
      clearTimeout(request.timer);
      request.reject(new Error('CDP connection closed'));
    }
    pending.clear();
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 10000);
    pending.set(id, { resolve, reject, timer });
    socket.send(JSON.stringify({ id, method, params }));
  });
  return {
    send,
    close: () => socket.close(),
    async evaluate(expression) {
      const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
      if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
      return result.result.value;
    },
  };
}

export function isolatedEnvironment(root, inherited = process.env) {
  const env = Object.fromEntries(Object.entries(inherited).filter(([key]) => !key.startsWith('HQ_')));
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.NODE_OPTIONS;
  return { ...env, HOME: join(root, 'home'), XDG_CONFIG_HOME: join(root, 'config'),
    XDG_CACHE_HOME: join(root, 'cache'), TMPDIR: '/tmp', HQ_USER_DATA_DIR: join(root, 'profile') };
}
