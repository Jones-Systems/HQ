#!/usr/bin/env node
// Starts a long-running named HQ session with a loopback control API. See docs/dev-preview.md.
import { randomBytes } from 'node:crypto';
import { SERVE_HELP, parseServeArgs } from './args.mjs';
import { createControlServer } from './control.mjs';
import { fail, say } from './cli.mjs';
import { UsageError } from './config.mjs';
import { defaultShotsDir, isProcessAlive, readSessionFile, removeSessionFile, sessionPaths, SESSION_SCHEMA, writeSessionFile } from './files.mjs';
import { TOOL_REPO, startSession } from './session.mjs';

try {
  const options = parseServeArgs(process.argv.slice(2), { repo: TOOL_REPO });
  if (options.help) { process.stdout.write(SERVE_HELP); process.exit(0); }
  await serve(options);
} catch (error) { fail(error); }

async function serve(options) {
  const { file } = sessionPaths(options.repo, options.name);
  const existing = await readSessionFile(file).catch(() => null);
  if (existing && isProcessAlive(existing.pid)) {
    throw new UsageError(`Session "${options.name}" is already running (pid ${existing.pid}); use ctl.mjs, or run ctl.mjs quit first`);
  }
  if (existing) { say(`removing stale session file from pid ${existing.pid}`); await removeSessionFile(file, existing.pid); }

  const evidenceDir = options.out ?? `${defaultShotsDir(options.repo)}-${options.name}`;
  const session = await startSession({ ...options, evidenceDir, log: say });
  const token = randomBytes(24).toString('hex');
  let server;
  let idleTimer;
  let stopping;

  async function shutdown(reason) {
    if (stopping) return stopping;
    return stopping = (async () => {
      say(`stopping (${reason})`);
      clearTimeout(idleTimer);
      server?.closeAllConnections?.();
      server?.close();
      let code = 0;
      try {
        const result = await session.close();
        say(`closed: scratch removed=${result.rootAbsent}, children closed=${result.capturedChildrenClosed}, remaining=${result.remainingChildren}`);
      } catch (error) { say(`cleanup failed: ${error.stack ?? error}`); code = 1; }
      await removeSessionFile(file, process.pid).catch(() => {});
      process.exit(code);
    })();
  }

  const touch = () => {
    clearTimeout(idleTimer);
    if (options.idleMinutes > 0) idleTimer = setTimeout(() => shutdown(`idle for ${options.idleMinutes} minutes`), options.idleMinutes * 60_000);
  };
  server = createControlServer(session, { token, onActivity: touch, onQuit: () => shutdown('quit'), onError: error => say(`request failed: ${error.stack ?? error}`) });
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(signal, () => shutdown(signal));
  for (const event of ['uncaughtException', 'unhandledRejection']) process.on(event, error => { say(`${event}: ${error?.stack ?? error}`); shutdown(event); });

  let port;
  try {
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    ({ port } = server.address());
    await writeSessionFile(file, {
      schema: SESSION_SCHEMA, name: options.name, pid: process.pid, startedAt: session.info.startedAt,
      control: { host: '127.0.0.1', port, token }, evidenceDir, mode: options.mode, size: session.info.size, repoHead: session.info.repo.head,
    });
  } catch (error) {
    await session.close().catch(() => {});
    throw error;
  }
  touch();
  console.log(`READY name=${options.name} mode=${options.mode} size=${session.info.size} port=${port} pid=${process.pid} evidence=${evidenceDir} session=${file}`);
}
