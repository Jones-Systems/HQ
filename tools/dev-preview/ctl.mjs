#!/usr/bin/env node
// Command-line client for a session started by serve.mjs. Prints the JSON reply; exits nonzero on failure.
import { setTimeout as delay } from 'node:timers/promises';
import { CTL_HELP, parseCtlArgs } from './args.mjs';
import { fail, say } from './cli.mjs';
import { UsageError } from './config.mjs';
import { isProcessAlive, readSessionFile, removeSessionFile, sessionPaths } from './files.mjs';
import { TOOL_REPO } from './session.mjs';

const print = value => console.log(JSON.stringify(value, null, 2));

try {
  const options = parseCtlArgs(process.argv.slice(2), { repo: TOOL_REPO });
  if (options.help) { process.stdout.write(CTL_HELP); process.exit(0); }
  process.exitCode = await control(options);
} catch (error) { fail(error); }

async function control(options) {
  const { file } = sessionPaths(options.repo, options.session);
  const record = await readSessionFile(file);
  if (!record) throw new UsageError(`No session "${options.session}" under ${options.repo}/.t3/dev-preview. Start one: node tools/dev-preview/serve.mjs --repo ${options.repo}`);
  if (!isProcessAlive(record.pid)) {
    await removeSessionFile(file, record.pid);
    if (options.route === 'quit') { print({ ok: true, value: 'stale session file removed', stopped: true }); return 0; }
    throw new UsageError(`Session "${options.session}" is not running (pid ${record.pid} is gone); removed its stale session file`);
  }

  let reply;
  try {
    const response = await fetch(`http://${record.control.host}:${record.control.port}/${options.route}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${record.control.token}`, 'content-type': 'application/json' },
      body: JSON.stringify(options.body),
      signal: AbortSignal.timeout(options.maxTimeMs),
    });
    reply = await response.json();
  } catch (error) {
    print({ ok: false, error: { name: error.name, message: error.name === 'TimeoutError' ? `no reply within ${options.maxTimeMs / 1000}s` : error.message } });
    return 1;
  }

  if (options.route === 'quit' && reply.ok) {
    // `quit` replies before cleanup; wait so the caller can rely on the scratch being gone.
    const deadline = Date.now() + 60_000;
    while (isProcessAlive(record.pid) && Date.now() < deadline) await delay(200);
    reply.stopped = !isProcessAlive(record.pid);
    if (!reply.stopped) say(`session process ${record.pid} is still shutting down`);
  }
  if (options.raw && reply.ok && typeof reply.value === 'string') console.log(reply.value);
  else print(reply);
  return reply.ok ? 0 : 1;
}
