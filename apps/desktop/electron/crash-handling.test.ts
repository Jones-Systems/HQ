import { mkdtemp, readFile, rm, stat, writeFile, mkdir, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { attachRendererRecovery, createCrashLog, describeError } from './crash-handling';

let userData: string;
const logFile = () => join(userData, 'logs', 'main.log');
const lines = async (file = logFile()) => (await readFile(file, 'utf8')).trim().split('\n').map(line => JSON.parse(line) as Record<string, unknown>);
const fixedNow = () => new Date('2026-11-10T12:00:00.000Z');
beforeEach(async () => { userData = await mkdtemp(join(tmpdir(), 'hq-crash-log-')); });
afterEach(async () => { await rm(userData, { recursive: true, force: true }); });

it('creates logs/main.log owner-only and appends one JSON line per event', async () => {
  const log = createCrashLog(userData, { now: fixedNow });
  log.record('child-process-gone', { type: 'GPU', reason: 'crashed', exitCode: 139 });
  log.record('unhandledRejection', describeError(new TypeError('boom')));
  if (process.platform !== 'win32') expect((await stat(logFile())).mode & 0o777).toBe(0o600);
  const [first, second] = await lines();
  expect(first).toEqual({ time: '2026-11-10T12:00:00.000Z', event: 'child-process-gone', type: 'GPU', reason: 'crashed', exitCode: 139 });
  expect(second).toMatchObject({ event: 'unhandledRejection', name: 'TypeError', message: 'boom' });
});

it('tightens an existing wider log file to 0600', async () => {
  if (process.platform === 'win32') return;
  await mkdir(join(userData, 'logs'));
  await writeFile(logFile(), '');
  await chmod(logFile(), 0o644);
  createCrashLog(userData).record('uncaughtException', {});
  expect((await stat(logFile())).mode & 0o777).toBe(0o600);
});

it('rotates at the cap, keeps exactly one previous file and never exceeds the cap', async () => {
  const log = createCrashLog(userData, { maxBytes: 600, now: fixedNow });
  for (let index = 0; index < 40; index += 1) log.record('unhandledRejection', { message: `event ${index} ${'x'.repeat(60)}` });
  const current = await stat(logFile()), previous = await stat(`${logFile()}.1`);
  expect(current.size).toBeLessThanOrEqual(600);
  expect(previous.size).toBeLessThanOrEqual(600);
  if (process.platform !== 'win32') expect(previous.mode & 0o777).toBe(0o600);
  await expect(stat(`${logFile()}.2`)).rejects.toThrow();
  const recent = await lines();
  expect(recent.at(-1)?.message).toContain('event 39');
  expect((await lines(`${logFile()}.1`)).at(-1)?.message).toContain(`event ${39 - recent.length}`);
});

it('keeps a single oversized event within the cap', async () => {
  const log = createCrashLog(userData, { maxBytes: 600 });
  log.record('uncaughtException', describeError(new Error('y'.repeat(5000))));
  expect((await stat(logFile())).size).toBeLessThanOrEqual(600);
  expect((await lines())[0]?.event).toBe('uncaughtException');
});

it('formats errors without secrets, request bodies or arbitrary properties', () => {
  const error = Object.assign(new Error('POST https://user:hunter2@api.example.test/v1/items?token=abc123#frag failed: Authorization: Bearer sk-live-0123456789abcdefghijklmnopqrstuvwxyz password=opensesame\nsecond line'), {
    code: 'ECONNRESET', body: '{"note":"private request body"}', config: { headers: { cookie: 'session=1' } },
  });
  const described = describeError(error);
  const text = JSON.stringify(described);
  expect(described).toMatchObject({ name: 'Error', code: 'ECONNRESET' });
  expect(Object.keys(described).sort()).toEqual(['code', 'message', 'name', 'stack']);
  for (const secret of ['hunter2', 'abc123', 'frag', 'sk-live', 'opensesame', 'private request body', 'session=1']) expect(text).not.toContain(secret);
  expect(described.message).toContain('https://[redacted]@api.example.test/v1/items?[redacted]');
  expect(described.message).not.toMatch(/[\n\r]/);
  expect(describeError({ body: 'private', password: 'x' })).toEqual({ kind: 'object', name: 'Object' });
  expect(describeError(undefined)).toEqual({ kind: 'undefined' });
  expect(describeError('api_key=shh then failed')).toEqual({ kind: 'string', message: 'api_key=[redacted] then failed' });
});

it('never throws when the log cannot be written', () => {
  const log = createCrashLog(join(userData, 'missing', '\0invalid'));
  expect(() => log.record('uncaughtException', {})).not.toThrow();
});

it('offers Reload after a renderer crash and reloads only when chosen', async () => {
  const listeners: ((event: unknown, details: { reason: string; exitCode: number }) => void)[] = [];
  let reloads = 0, closes = 0, prompts = 0, choice = 0;
  const window = {
    isDestroyed: () => false, close: () => { closes += 1; },
    webContents: { on: (_name: string, listener: (typeof listeners)[number]) => { listeners.push(listener); }, isDestroyed: () => false, reload: () => { reloads += 1; } },
  };
  const dialog = { showMessageBox: async (_window: unknown, options: { buttons?: string[] }) => { prompts += 1; expect(options.buttons?.[0]).toBe('Reload'); return { response: choice, checkboxChecked: false }; } };
  attachRendererRecovery(window as never, createCrashLog(userData, { now: fixedNow }), dialog as never);
  const settle = () => new Promise(resolve => setTimeout(resolve, 0));
  listeners[0]?.({}, { reason: 'clean-exit', exitCode: 0 }); await settle();
  expect(prompts).toBe(0);
  listeners[0]?.({}, { reason: 'crashed', exitCode: 11 }); listeners[0]?.({}, { reason: 'crashed', exitCode: 11 }); await settle();
  expect([prompts, reloads, closes]).toEqual([1, 1, 0]);
  choice = 1; listeners[0]?.({}, { reason: 'oom', exitCode: 1 }); await settle();
  expect([prompts, reloads, closes]).toEqual([2, 1, 1]);
  expect((await lines()).map(line => line.reason)).toEqual(['crashed', 'crashed', 'oom']);
});
