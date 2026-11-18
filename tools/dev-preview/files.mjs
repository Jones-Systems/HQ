// Names, paths and small on-disk records for the dev-preview tools. All session state lives under
// `<repo>/.t3/dev-preview/`, which the repository already ignores through `.t3/`.
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve, isAbsolute } from 'node:path';
import { UsageError } from './config.mjs';

export const STATE_DIR = '.t3/dev-preview';
export const SESSION_SCHEMA = 'hq-dev-preview-session/v1';
export const MANIFEST_SCHEMA = 'hq-dev-preview-capture/v1';
export const OWNER_FILE = '.owner.json';

export const stateDir = repo => join(repo, STATE_DIR);
export const scratchDir = repo => join(stateDir(repo), 'scratch');

export function validateSessionName(value) {
  if (typeof value !== 'string' || !/^[a-z0-9][a-z0-9_-]{0,39}$/i.test(value)) {
    throw new UsageError(`Invalid session name "${value}": use 1-40 letters, digits, "-" or "_"`);
  }
  return value;
}

/** A file stem for a screenshot; no separators, no leading dot, no "..", at most 80 characters. */
export function safeFileName(value) {
  const name = String(value ?? '').replace(/\.png$/i, '');
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(name) || name.includes('..')) {
    throw new UsageError(`Invalid file name "${value}": use letters, digits, ".", "_" or "-" (max 80), starting with a letter or digit`);
  }
  return name;
}

/** `base/name`, refusing any result that would leave `base`. */
export function resolveInside(base, name) {
  const root = resolve(base);
  const target = resolve(root, name);
  const path = relative(root, target);
  if (path === '' || path.startsWith('..') || isAbsolute(path)) throw new UsageError(`Path "${name}" escapes ${root}`);
  return target;
}

export function utcStamp(date = new Date()) {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
}

export const defaultShotsDir = (repo, date = new Date()) => join(stateDir(repo), 'shots', utcStamp(date));

export function sessionPaths(repo, name) {
  const dir = join(stateDir(repo), 'sessions', validateSessionName(name));
  return { dir, file: join(dir, 'session.json') };
}

/**
 * Prepares a screenshot output directory. A new or empty directory is fine, and so is one that an
 * earlier capture wrote (it has a manifest of ours). Anything else is refused rather than mixed into.
 */
export async function prepareOutputDir(dir) {
  const target = resolve(dir);
  let entries;
  try { entries = await readdir(target); }
  catch (error) {
    if (error.code === 'ENOENT') { await mkdir(target, { recursive: true }); return target; }
    if (error.code === 'ENOTDIR') throw new UsageError(`Output path ${target} is not a directory`);
    throw error;
  }
  if (entries.length === 0) return target;
  if (entries.includes('manifest.json')) {
    try {
      if (JSON.parse(await readFile(join(target, 'manifest.json'), 'utf8')).schema === MANIFEST_SCHEMA) return target;
    } catch { /* fall through to the refusal */ }
  }
  throw new UsageError(`Refusing to write into non-empty directory ${target}; pass a new --out`);
}

// ---- session record

export function validateSessionRecord(record) {
  const ok = record && typeof record === 'object' && record.schema === SESSION_SCHEMA
    && Number.isInteger(record.pid) && record.pid > 0
    && record.control && Number.isInteger(record.control.port) && record.control.port > 0 && record.control.port < 65536
    && typeof record.control.token === 'string' && record.control.token.length >= 16
    && typeof record.evidenceDir === 'string';
  if (!ok) throw new Error('Session file is malformed');
  return record;
}

export async function writeSessionFile(file, record) {
  validateSessionRecord(record);
  await mkdir(dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, file);
}

/** The record, or `null` when there is no session file. A corrupt file throws. */
export async function readSessionFile(file) {
  let raw;
  try { raw = await readFile(file, 'utf8'); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  try { return validateSessionRecord(JSON.parse(raw)); }
  catch (error) { throw new Error(`${error.message}: ${file}`, { cause: error }); }
}

export function isProcessAlive(pid, kill = process.kill) {
  try { kill(pid, 0); return true; }
  catch (error) { return error.code === 'EPERM'; }
}

/** Removes the session directory only while the record in it still belongs to `pid`. */
export async function removeSessionFile(file, pid) {
  let record = null;
  try { record = await readSessionFile(file); } catch { /* corrupt: ours to clear only if pid matches, which we cannot know */ return false; }
  if (record && record.pid !== pid) return false;
  await rm(dirname(file), { recursive: true, force: true });
  return true;
}

// ---- scratch left behind by sessions that were killed without cleaning up

export async function writeOwnerFile(dir, pid = process.pid) {
  await writeFile(join(dir, OWNER_FILE), JSON.stringify({ pid, startedAt: new Date().toISOString() }));
}

/** Removes `run-*` scratch directories whose owning process is gone. Live and unrecognised ones stay. */
export async function reapStaleRuns(scratch, { isAlive = isProcessAlive, now = Date.now(), ownerlessGraceMs = 3_600_000 } = {}) {
  let names;
  try { names = await readdir(scratch); }
  catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  const reaped = [];
  for (const name of names.filter(entry => /^run-[A-Za-z0-9]+$/.test(entry))) {
    const dir = join(scratch, name);
    let owner = null;
    try { owner = JSON.parse(await readFile(join(dir, OWNER_FILE), 'utf8')); } catch { /* ownerless */ }
    if (Number.isInteger(owner?.pid)) { if (isAlive(owner.pid)) continue; }
    else {
      let modified;
      try { modified = (await stat(dir)).mtimeMs; } catch { continue; }
      if (now - modified < ownerlessGraceMs) continue;
    }
    await rm(dir, { recursive: true, force: true });
    reaped.push(name);
  }
  return reaped;
}
