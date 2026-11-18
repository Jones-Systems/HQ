import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, open, readdir, readFile, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { JsonValue, WorkLocalResult, WorkLocalRoute, WorkLocalValues } from '@hq/contracts/services';
import { keys, record } from './services.js';

export const WORK_LOCAL_MAX_BYTES = 16 * 1024 * 1024;
const SCHEMA = 'hq.work-local/v1';
/** Work documents are shallow; this also stops a cyclic value. */
const MAX_DEPTH = 64;
/** What the envelope adds to a value at the cap. */
const ENVELOPE_SLACK = 1024;
type Answer = WorkLocalResult<WorkLocalValues[WorkLocalRoute]>;
type Refusal = Extract<Answer, { ok: false }>['kind'];
type Stored = { readonly revision: number; readonly value: JsonValue | null };
type Request = { readonly route: 'load' } | { readonly route: 'save'; readonly binding: string; readonly expectedRevision: number; readonly value: unknown };
const refuse = (kind: Refusal): Answer => ({ ok: false, kind });
/** Moves a finished temporary file over the document; a seam so a test can make the step fail. */
export type Replace = (temporary: string, destination: string) => Promise<void>;

/** The closed call shapes of `WorkLocalParams`, or null. */
function parse(route: unknown, params: unknown): Request | null {
  if (route === 'load') return record(params) && keys(params, []) ? { route } : null;
  if (route !== 'save' || !record(params) || !keys(params, ['binding', 'expectedRevision', 'value'])) return null;
  const { binding, expectedRevision, value } = params;
  if (typeof binding !== 'string' || !Number.isSafeInteger(expectedRevision) || (expectedRevision as number) < 0) return null;
  return { route, binding, expectedRevision: expectedRevision as number, value };
}

/**
 * Walks a value that must survive JSON unchanged: finite numbers, plain objects, dense arrays, bounded depth. Every
 * node serializes to at least one byte, so a value with more nodes than `budget.left` cannot fit under the cap.
 */
function walk(value: unknown, budget: { left: number }, depth = 0): 'ok' | 'invalid' | 'too_large' {
  if (--budget.left < 0) return 'too_large';
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return 'ok';
  if (typeof value === 'number') return Number.isFinite(value) ? 'ok' : 'invalid';
  if (depth >= MAX_DEPTH) return 'invalid';
  let children: readonly unknown[];
  if (Array.isArray(value)) {
    if (Object.keys(value).length !== value.length) return 'invalid';
    children = value;
  } else if (record(value)) children = Object.values(value);
  else return 'invalid';
  for (const child of children) {
    const verdict = walk(child, budget, depth + 1);
    if (verdict !== 'ok') return verdict;
  }
  return 'ok';
}

/** The stored document, `revision` 0 when there is none, or why it cannot be used. It is never repaired or replaced. */
async function readDocument(file: string, maxBytes: number): Promise<Stored | 'invalid' | 'too_large'> {
  try {
    let info;
    try { info = await lstat(file); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { revision: 0, value: null }; throw error; }
    if (!info.isFile()) return 'invalid';
    if (info.size > maxBytes + ENVELOPE_SLACK) return 'too_large';
    const document: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await readFile(file)));
    if (!record(document) || !keys(document, ['schema', 'revision', 'value']) || document.schema !== SCHEMA) return 'invalid';
    const { revision, value } = document;
    if (!Number.isSafeInteger(revision) || (revision as number) < 1 || (revision as number) >= Number.MAX_SAFE_INTEGER) return 'invalid';
    const verdict = walk(value, { left: maxBytes });
    return verdict === 'ok' ? { revision: revision as number, value: value as JsonValue } : verdict;
  } catch { return 'invalid'; }
}

/**
 * Writes `text` as the document: a temporary file in the same directory (0600, exclusive), synced, renamed over the
 * document, then the directory synced. A failure before the rename leaves the previous document untouched; one after
 * it (the directory sync) is reported although the new document is in place, so a later save with the old revision
 * conflicts until the next load.
 */
async function writeDocument(directory: string, name: string, text: string, replace: Replace): Promise<void> {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  // This document's lock is held, so any earlier temporary file is the remains of an interrupted write.
  for (const stale of await readdir(directory)) if (stale.startsWith(`${name}.`) && stale.endsWith('.tmp')) await rm(join(directory, stale), { force: true });
  const file = join(directory, name), temporary = `${file}.${randomUUID()}.tmp`;
  try {
    const handle = await open(temporary, 'wx', 0o600);
    try { await handle.writeFile(text); await handle.sync(); } finally { await handle.close(); }
    await replace(temporary, file);
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => {});
    throw error;
  }
  const folder = await open(directory, 'r');
  try { await folder.sync(); } finally { await folder.close(); }
}

export interface WorkLocalOptions {
  /** The directory the `work-local` folder lives in: Electron's userData. */
  readonly root: string;
  /** The configured Work address, or null. Asked on every call, so a saved change applies at once. */
  readonly endpoint: () => URL | null;
  /** The cap on a saved value's JSON text; `WORK_LOCAL_MAX_BYTES` when absent. */
  readonly maxBytes?: number;
}

/**
 * Durable Work state on this device (`hqServices.workLocal`): one JSON document per configured Work address, under
 * `<root>/work-local/<sha256 of the origin>.json`. The renderer never learns the path or the address. A `load`
 * hands out an opaque binding for the current address; a `save` is accepted only with that binding and the revision it
 * read, so a session that loaded one address's document cannot write into another's, nor over a newer revision. Calls
 * on one document run one at a time. Failures answer with a kind only.
 */
export function createWorkLocal(options: WorkLocalOptions, replace: Replace = rename) {
  const maxBytes = options.maxBytes ?? WORK_LOCAL_MAX_BYTES;
  const directory = join(options.root, 'work-local');
  const bindings = new Map<string, string>();
  const queues = new Map<string, Promise<unknown>>();

  function serialized<T>(name: string, task: () => Promise<T>): Promise<T> {
    const run = (queues.get(name) ?? Promise.resolve()).then(task);
    const tail = run.catch(() => undefined);
    queues.set(name, tail);
    void tail.then(() => { if (queues.get(name) === tail) queues.delete(name); });
    return run;
  }

  async function load(origin: string, name: string): Promise<Answer> {
    const stored = await readDocument(join(directory, name), maxBytes);
    if (typeof stored === 'string') return refuse(stored);
    let binding = bindings.get(origin);
    if (binding === undefined) bindings.set(origin, binding = randomUUID());
    return { ok: true, value: { binding, revision: stored.revision, value: stored.value } };
  }

  async function save(origin: string, name: string, request: Extract<Request, { route: 'save' }>, valueText: string): Promise<Answer> {
    if (request.binding !== bindings.get(origin)) return refuse('conflict');
    const stored = await readDocument(join(directory, name), maxBytes);
    if (typeof stored === 'string') return refuse(stored);
    if (stored.revision !== request.expectedRevision) return refuse('conflict');
    const revision = stored.revision + 1;
    await writeDocument(directory, name, `{"schema":"${SCHEMA}","revision":${revision},"value":${valueText}}`, replace);
    return { ok: true, value: { revision } };
  }

  return {
    async call(route: unknown, params: unknown): Promise<Answer> {
      try {
        const request = parse(route, params);
        if (!request) return refuse('invalid');
        let valueText = '';
        if (request.route === 'save') {
          const verdict = walk(request.value, { left: maxBytes });
          if (verdict !== 'ok') return refuse(verdict);
          valueText = JSON.stringify(request.value);
          if (Buffer.byteLength(valueText) > maxBytes) return refuse('too_large');
        }
        const base = options.endpoint();
        if (!base) return refuse('unavailable');
        const { origin } = base;
        const name = `${createHash('sha256').update(origin).digest('hex')}.json`;
        return await serialized(name, () => request.route === 'load' ? load(origin, name) : save(origin, name, request, valueText));
      } catch { return refuse('unavailable'); }
    },
  };
}
