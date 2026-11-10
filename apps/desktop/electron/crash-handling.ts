import { closeSync, constants, fchmodSync, mkdirSync, openSync, renameSync, statSync, writeSync } from 'node:fs';
import { join } from 'node:path';
import type { App, BrowserWindow, Dialog } from 'electron';

export type CrashFields = Readonly<Record<string, string | number | undefined>>;
export interface CrashLog { record(event: string, fields: CrashFields): void }

const DEFAULT_MAX_BYTES = 1024 * 1024;
const APPEND_FLAGS = constants.O_WRONLY | constants.O_CREAT | constants.O_APPEND | (constants.O_NOFOLLOW ?? 0);

/**
 * Appends one JSON line per event to `<userData>/logs/main.log` (0600). Before a write would pass
 * `maxBytes`, the file becomes `main.log.1`, replacing any older copy. Writes are synchronous so a
 * line lands before Electron's fatal handling, and a failed write is dropped rather than thrown.
 */
export function createCrashLog(userData: string, options: { readonly maxBytes?: number; readonly now?: () => Date } = {}): CrashLog {
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES, now = options.now ?? (() => new Date());
  const directory = join(userData, 'logs'), file = join(directory, 'main.log');
  return {
    record(event, fields) {
      try {
        const time = now().toISOString();
        let line = `${JSON.stringify({ time, event: clean(event, 64), ...fields })}\n`;
        if (Buffer.byteLength(line) > maxBytes) line = `${JSON.stringify({ time, event: clean(event, 64), truncated: true })}\n`;
        mkdirSync(directory, { recursive: true, mode: 0o700 });
        let size = 0;
        try { size = statSync(file).size; } catch { /* First write creates the file. */ }
        if (size > 0 && size + Buffer.byteLength(line) > maxBytes) renameSync(file, `${file}.1`);
        const descriptor = openSync(file, APPEND_FLAGS, 0o600);
        try { fchmodSync(descriptor, 0o600); writeSync(descriptor, line); }
        finally { closeSync(descriptor); }
      } catch { /* Logging must never become a second failure. */ }
    },
  };
}

/** Removes credentials in URLs, auth headers, secret-named assignments and long opaque tokens. */
function clean(text: string, limit: number): string {
  return text
    .replace(/\b([a-z][a-z0-9+.-]*:\/\/)[^\s/@]*@/gi, '$1[redacted]@')
    .replace(/(\b[a-z][a-z0-9+.-]*:\/\/[^\s?#]*)[?#]\S*/gi, '$1?[redacted]')
    .replace(/\b(bearer|basic)\s+[^\s,;]+/gi, '$1 [redacted]')
    .replace(/\b(authorization|proxy-authorization|cookie|set-cookie|[a-z_-]*token|secret|password|passwd|api[-_]?key|access[-_]?key|session)(["']?\s*[:=]\s*)(?!\[redacted\])("[^"]*"|'[^']*'|[^\s,;&]+)/gi, '$1$2[redacted]')
    .replace(/[A-Za-z0-9+_=-]{32,}/g, '[redacted]')
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .slice(0, limit);
}

/** Describes a thrown value by name, code, message and stack frames only; other properties may hold request bodies. */
export function describeError(value: unknown): Record<string, string> {
  if (value instanceof Error) {
    const described: Record<string, string> = { name: clean(value.name, 80) };
    const code = (value as { code?: unknown }).code;
    if (typeof code === 'string' || typeof code === 'number') described.code = clean(String(code), 80);
    described.message = clean(value.message, 400);
    const frames = (value.stack ?? '').split('\n').map(frame => frame.trim()).filter(frame => frame.startsWith('at ')).slice(0, 6);
    if (frames.length > 0) described.stack = clean(frames.join(' | '), 1200);
    return described;
  }
  if (typeof value === 'string') return { kind: 'string', message: clean(value, 400) };
  if (typeof value === 'object' && value !== null) return { kind: 'object', name: clean(value.constructor?.name ?? 'null-prototype', 80) };
  return { kind: typeof value };
}

/**
 * `uncaughtExceptionMonitor` observes without replacing Electron's default fatal handling.
 * The `unhandledRejection` listener intentionally keeps the app running.
 */
export function registerCrashLogging(target: NodeJS.Process, app: Pick<App, 'on'>, log: CrashLog): void {
  target.on('uncaughtExceptionMonitor', (error, origin) => { log.record('uncaughtException', { origin, ...describeError(error) }); });
  target.on('unhandledRejection', reason => { log.record('unhandledRejection', describeError(reason)); });
  app.on('child-process-gone', (_event, details) => {
    log.record('child-process-gone', { type: details.type, reason: details.reason, exitCode: details.exitCode, name: clean(details.name ?? details.serviceName ?? '', 80) || undefined });
  });
}

/** After an unexpected renderer exit, logs it and offers one Reload prompt per window at a time. */
export function attachRendererRecovery(window: BrowserWindow, log: CrashLog, prompt: Pick<Dialog, 'showMessageBox'>): void {
  let prompting = false;
  window.webContents.on('render-process-gone', (_event, details) => {
    if (details.reason === 'clean-exit') return;
    log.record('render-process-gone', { reason: details.reason, exitCode: details.exitCode });
    if (prompting || window.isDestroyed()) return;
    prompting = true;
    void prompt.showMessageBox(window, {
      type: 'error', buttons: ['Reload', 'Close window'], defaultId: 0, cancelId: 1, noLink: true,
      message: 'This HQ window stopped unexpectedly.', detail: `Reason: ${details.reason}. Choose Reload to reopen it.`,
    }).then(({ response }) => {
      if (window.isDestroyed()) return;
      if (response === 0 && !window.webContents.isDestroyed()) window.webContents.reload();
      else if (response !== 0) window.close();
    }, error => { log.record('render-process-gone', { reason: 'prompt-failed', ...describeError(error) }); })
      .finally(() => { prompting = false; });
  });
}
