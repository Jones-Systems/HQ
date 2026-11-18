import { afterEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readdir, readFile, rename, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { JsonValue } from '@hq/contracts/services';
import { WorkLocalError, workLocalPersistence } from '../../../modules/work/live/durable';
import { createWorkLocal, WORK_LOCAL_MAX_BYTES, type Replace } from './work-local';

const owned: string[] = [];
afterEach(async () => { for (const path of owned.splice(0)) await rm(path, { recursive: true, force: true }); });
async function scratch(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'hq-b1-work-local-'));
  owned.push(root);
  return root;
}
const A = new URL('http://127.0.0.1:4100'), B = new URL('http://127.0.0.1:4200');
const documentName = (origin: string) => `${createHash('sha256').update(origin).digest('hex')}.json`;
/** Storage over a scratch directory whose Work address the test can change, as Settings does. */
async function open(options: { maxBytes?: number; replace?: Replace; root?: string } = {}) {
  const root = options.root ?? await scratch();
  let address: URL | null = A;
  const storage = createWorkLocal({ root, endpoint: () => address, ...(options.maxBytes === undefined ? {} : { maxBytes: options.maxBytes }) }, options.replace);
  const directory = join(root, 'work-local');
  return { root, directory, storage, point: (next: URL | null) => { address = next; }, call: storage.call, fileOf: (origin: URL) => join(directory, documentName(origin.origin)) };
}
type Storage = Awaited<ReturnType<typeof open>>;
const loadOf = async (s: Storage) => {
  const answer = await s.call('load', {});
  if (!answer.ok) throw new Error(`load refused: ${answer.kind}`);
  return answer.value as { binding: string; revision: number; value: JsonValue | null };
};
const save = (s: Storage, binding: string, expectedRevision: number, value: unknown) => s.call('save', { binding, expectedRevision, value });
const refusal = (kind: string) => ({ ok: false, kind });
const bytes = (path: string) => readFile(path);

describe('documents', () => {
  it('answers an empty load without creating anything, and a binding that is neither the address nor its hash', async () => {
    const s = await open();
    const loaded = await loadOf(s);
    expect(loaded).toEqual({ binding: expect.any(String), revision: 0, value: null });
    expect(loaded.binding).toMatch(/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/u);
    expect(loaded.binding).not.toContain(documentName(A.origin).slice(0, -5));
    expect(JSON.stringify(loaded)).not.toMatch(/127\.0\.0\.1|4100/u);
    await expect(stat(s.directory)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('keeps one document per address under work-local/<sha256 of the origin>.json, directory 0700 and file 0600', async () => {
    const s = await open();
    const a = await loadOf(s);
    expect(await save(s, a.binding, 0, { address: 'a' })).toEqual({ ok: true, value: { revision: 1 } });
    s.point(B);
    const b = await loadOf(s);
    expect(await save(s, b.binding, 0, { address: 'b' })).toEqual({ ok: true, value: { revision: 1 } });

    expect((await readdir(s.directory)).sort()).toEqual([documentName(A.origin), documentName(B.origin)].sort());
    expect(documentName(A.origin)).toMatch(/^[0-9a-f]{64}\.json$/u);
    expect(JSON.parse(await readFile(s.fileOf(A), 'utf8'))).toEqual({ schema: 'hq.work-local/v1', revision: 1, value: { address: 'a' } });
    expect(JSON.parse(await readFile(s.fileOf(B), 'utf8'))).toEqual({ schema: 'hq.work-local/v1', revision: 1, value: { address: 'b' } });
    expect((await stat(s.directory)).mode & 0o777).toBe(0o700);
    for (const origin of [A, B]) expect((await stat(s.fileOf(origin))).mode & 0o777).toBe(0o600);
    s.point(A);
    expect(await s.call('load', {})).toEqual({ ok: true, value: { binding: a.binding, revision: 1, value: { address: 'a' } } });
  });

  it('is one document per origin, whatever else the address says', async () => {
    const s = await open();
    s.point(new URL('http://127.0.0.1:4100/some/path?x=1'));
    const loaded = await loadOf(s);
    await save(s, loaded.binding, 0, { n: 1 });
    expect(await readdir(s.directory)).toEqual([documentName('http://127.0.0.1:4100')]);
  });

  it('loads what a save stored, and the same binding on every load while this process runs', async () => {
    const s = await open();
    const first = await loadOf(s);
    const value = { queue: [{ queueId: 'q1', text: 'é ✓ 🙂', n: -1.5, flag: false, none: null }], nested: { a: [[], {}] } };
    await save(s, first.binding, 0, value);
    const again = await loadOf(s);
    expect(again).toEqual({ binding: first.binding, revision: 1, value });
  });

  it('gives a new process a new binding, and refuses the old one', async () => {
    const s = await open();
    const old = await loadOf(s);
    const restarted = await open({ root: s.root });
    const fresh = await loadOf(restarted);
    expect(fresh.binding).not.toBe(old.binding);
    expect(await save(restarted, old.binding, 0, { n: 1 })).toEqual(refusal('conflict'));
    expect(await save(restarted, fresh.binding, 0, { n: 1 })).toEqual({ ok: true, value: { revision: 1 } });
  });
});

describe('the revision guard', () => {
  it('accepts a save only at the stored revision, 0 when nothing is stored', async () => {
    const s = await open();
    const { binding } = await loadOf(s);
    expect(await save(s, binding, 1, { n: 0 })).toEqual(refusal('conflict'));
    expect(await save(s, binding, 0, { n: 1 })).toEqual({ ok: true, value: { revision: 1 } });
    expect(await save(s, binding, 0, { n: 2 })).toEqual(refusal('conflict'));
    expect(await save(s, binding, 5, { n: 3 })).toEqual(refusal('conflict'));
    expect(await save(s, binding, 1, { n: 4 })).toEqual({ ok: true, value: { revision: 2 } });
    expect(await loadOf(s)).toMatchObject({ revision: 2, value: { n: 4 } });
  });

  it('refuses a save with no binding from a load, or an unknown one, and writes nothing', async () => {
    const s = await open();
    expect(await save(s, 'never-handed-out', 0, { n: 1 })).toEqual(refusal('conflict'));
    await loadOf(s);
    expect(await save(s, '', 0, { n: 1 })).toEqual(refusal('conflict'));
    expect(await save(s, 'never-handed-out', 0, { n: 1 })).toEqual(refusal('conflict'));
    await expect(readdir(s.directory)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('treats a document another writer replaced since the load as a conflict, not something to overwrite', async () => {
    const s = await open();
    const { binding } = await loadOf(s);
    await save(s, binding, 0, { n: 1 });
    await writeFile(s.fileOf(A), JSON.stringify({ schema: 'hq.work-local/v1', revision: 9, value: { theirs: true } }));
    expect(await save(s, binding, 1, { n: 2 })).toEqual(refusal('conflict'));
    expect(JSON.parse(await readFile(s.fileOf(A), 'utf8')).value).toEqual({ theirs: true });
  });
});

describe('the binding across an address change', () => {
  it('lets a session that loaded one address\'s document write nowhere else', async () => {
    const s = await open();
    const loadedA = await loadOf(s);
    await save(s, loadedA.binding, 0, { address: 'a' });
    s.point(B);
    // The renderer still holds A's binding and revision; main now resolves B.
    expect(await save(s, loadedA.binding, 1, { address: 'leaked into b' })).toEqual(refusal('conflict'));
    expect(await save(s, loadedA.binding, 0, { address: 'leaked into b' })).toEqual(refusal('conflict'));
    await expect(stat(s.fileOf(B))).rejects.toMatchObject({ code: 'ENOENT' });
    const loadedB = await loadOf(s);
    expect(loadedB.binding).not.toBe(loadedA.binding);
    expect(loadedB).toMatchObject({ revision: 0, value: null });
    expect(await save(s, loadedB.binding, 0, { address: 'b' })).toEqual({ ok: true, value: { revision: 1 } });
    // And B's binding does not reach A.
    s.point(A);
    expect(await save(s, loadedB.binding, 1, { address: 'leaked into a' })).toEqual(refusal('conflict'));
    expect(JSON.parse(await readFile(s.fileOf(A), 'utf8')).value).toEqual({ address: 'a' });
    // Back at A, the binding it was handed is good again, at the revision it read.
    expect(await save(s, loadedA.binding, 1, { address: 'a again' })).toEqual({ ok: true, value: { revision: 2 } });
  });

  it('refuses every save when no address is set, and a load', async () => {
    const s = await open();
    const { binding } = await loadOf(s);
    s.point(null);
    expect(await s.call('load', {})).toEqual(refusal('unavailable'));
    expect(await save(s, binding, 0, { n: 1 })).toEqual(refusal('unavailable'));
    await expect(readdir(s.directory)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('answers unavailable, naming nothing, when asking for the address throws', async () => {
    const root = await scratch();
    const storage = createWorkLocal({ root, endpoint: () => { throw new Error(`no config at ${root}`); } });
    const answer = await storage.call('load', {});
    expect(answer).toEqual(refusal('unavailable'));
    expect(JSON.stringify(answer)).not.toContain(root);
  });
});

describe('the size cap', () => {
  it('has a 16 MiB default and accepts a megabyte', async () => {
    expect(WORK_LOCAL_MAX_BYTES).toBe(16 * 1024 * 1024);
    const s = await open();
    const { binding } = await loadOf(s);
    expect(await save(s, binding, 0, { text: 'x'.repeat(1024 * 1024) })).toEqual({ ok: true, value: { revision: 1 } });
  });

  it('measures the serialized value in bytes: the cap is accepted and one byte over is too large', async () => {
    const s = await open({ maxBytes: 1_000 });
    const { binding } = await loadOf(s);
    expect(await save(s, binding, 0, 'x'.repeat(998))).toEqual({ ok: true, value: { revision: 1 } }); // 1,000 bytes with its quotes
    expect(await save(s, binding, 1, 'x'.repeat(999))).toEqual(refusal('too_large'));
    expect(await save(s, binding, 1, 'é'.repeat(500))).toEqual(refusal('too_large')); // 1,002 bytes in UTF-8, 502 characters
    expect(await save(s, binding, 1, 'é'.repeat(499))).toEqual({ ok: true, value: { revision: 2 } });
  });

  it('refuses a value of many tiny nodes without serializing it, and leaves the stored document alone', async () => {
    const s = await open({ maxBytes: 1_000 });
    const { binding } = await loadOf(s);
    await save(s, binding, 0, { kept: true });
    const before = await bytes(s.fileOf(A));
    expect(await save(s, binding, 1, Array.from({ length: 5_000 }, () => 0))).toEqual(refusal('too_large'));
    expect(await bytes(s.fileOf(A))).toEqual(before);
    expect(await loadOf(s)).toMatchObject({ revision: 1, value: { kept: true } });
  });

  it('will not read a document over the cap, and does not touch it', async () => {
    const s = await open({ maxBytes: 1_000 });
    await mkdir(s.directory, { recursive: true });
    const big = JSON.stringify({ schema: 'hq.work-local/v1', revision: 1, value: 'x'.repeat(5_000) });
    await writeFile(s.fileOf(A), big);
    expect(await s.call('load', {})).toEqual(refusal('too_large'));
    expect(await readFile(s.fileOf(A), 'utf8')).toBe(big);
  });
});

describe('closed parameters and JSON values', () => {
  const ok = { binding: 'b', expectedRevision: 0, value: { n: 1 } };
  it.each([
    ['an unknown route', 'delete', {}], ['a missing route', undefined, {}], ['a numeric route', 7, {}], ['a prototype name', 'toString', {}], ['__proto__', '__proto__', {}],
    ['load with a member', 'load', { binding: 'b' }], ['load with null params', 'load', null], ['load with an array', 'load', []], ['load with a string', 'load', 'x'],
    ['load with a class instance', 'load', new (class Params {})()], ['save with null params', 'save', null], ['save with an array', 'save', [ok]],
    ['save without a binding', 'save', { expectedRevision: 0, value: 1 }], ['save without a revision', 'save', { binding: 'b', value: 1 }],
    ['save without a value', 'save', { binding: 'b', expectedRevision: 0 }], ['save with an extra member', 'save', { ...ok, path: '/tmp/x' }],
    ['a numeric binding', 'save', { ...ok, binding: 7 }], ['a null binding', 'save', { ...ok, binding: null }],
    ...[-1, 1.5, '0', Number.NaN, Number.POSITIVE_INFINITY, 2 ** 53, null, undefined].map((expectedRevision): [string, string, unknown] => [`a revision of ${String(expectedRevision)}`, 'save', { ...ok, expectedRevision }]),
  ])('refuses %s as invalid and writes nothing', async (_label, route, params) => {
    const s = await open();
    await loadOf(s);
    expect(await s.call(route, params)).toEqual(refusal('invalid'));
    await expect(readdir(s.directory)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  const cyclic = () => { const loop: Record<string, unknown> = {}; loop.self = loop; return loop; };
  const deep = (levels: number) => { let value: unknown = 'leaf'; for (let i = 0; i < levels; i += 1) value = [value]; return value; };
  const sparse = () => { const list = [1, 2, 3]; delete list[1]; return list; };
  const withExtra = () => Object.assign([1, 2], { note: 'dropped by JSON' });
  it.each([
    ['undefined', undefined], ['a member that is undefined', { a: undefined }], ['NaN', { a: Number.NaN }], ['Infinity', [Number.POSITIVE_INFINITY]],
    ['-Infinity', Number.NEGATIVE_INFINITY], ['a function', { a: () => 1 }], ['a Date', { a: new Date(0) }], ['a bigint', { a: 1n }], ['a Map', new Map()],
    ['a Set', { a: new Set([1]) }], ['a typed array', { a: new Uint8Array(2) }], ['a symbol', { a: Symbol('x') }], ['a class instance', { a: new (class Note { text = 'x'; })() }],
    ['an object with a null-prototype child that holds a function', { a: Object.assign(Object.create(null), { f: () => 1 }) }],
    ['a cycle', cyclic()], ['a value nested 65 deep', deep(65)], ['a value nested 100,000 deep', deep(100_000)], ['a sparse array', sparse()], ['an array with a member that is not an index', withExtra()],
  ])('refuses %s as an invalid value', async (_label, value) => {
    const s = await open();
    const { binding } = await loadOf(s);
    expect(await save(s, binding, 0, value)).toEqual(refusal('invalid'));
    await expect(readdir(s.directory)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('accepts a value nested 63 deep and every plain JSON kind', async () => {
    const s = await open();
    const { binding } = await loadOf(s);
    const value = { a: deep(62), s: 'text', n: [0, -1, 1.5e300, 5e-324], t: true, f: false, z: null, o: {}, e: [], u: 'é🙂\u0000' };
    expect(await save(s, binding, 0, value)).toEqual({ ok: true, value: { revision: 1 } });
    expect((await loadOf(s)).value).toEqual(value);
  });

  it('never throws, whatever it is handed', async () => {
    const s = await open();
    const hostile = new Proxy({}, { getPrototypeOf() { throw new Error('trap'); }, ownKeys() { throw new Error('trap'); } });
    expect(await s.call('load', hostile)).toEqual(refusal('unavailable'));
    expect(await s.call('save', hostile)).toEqual(refusal('unavailable'));
  });
});

describe('a document that cannot be used is never replaced', () => {
  const schema = 'hq.work-local/v1';
  const valid = { schema, revision: 1, value: { n: 1 } };
  const files: [string, string | Uint8Array][] = [
    ['text that is not JSON', 'not json'], ['an empty file', ''], ['a JSON null', 'null'], ['a JSON array', '[]'], ['an empty object', '{}'],
    ['a truncated document', JSON.stringify(valid).slice(0, 30)],
    ['another schema', JSON.stringify({ ...valid, schema: 'hq.work-local/v2' })], ['a missing schema', JSON.stringify({ revision: 1, value: 1 })],
    ['an extra member', JSON.stringify({ ...valid, path: '/x' })], ['a missing value', JSON.stringify({ schema, revision: 1 })],
    ['revision 0', JSON.stringify({ ...valid, revision: 0 })], ['a negative revision', JSON.stringify({ ...valid, revision: -1 })],
    ['a fractional revision', JSON.stringify({ ...valid, revision: 1.5 })], ['a string revision', JSON.stringify({ ...valid, revision: '1' })],
    ['a revision that cannot be incremented', `{"schema":"${schema}","revision":9007199254740991,"value":1}`],
    ['a value nested too deep', `{"schema":"${schema}","revision":1,"value":${'['.repeat(80)}${']'.repeat(80)}}`],
    ['bytes that are not UTF-8', new Uint8Array([0xff, 0xfe, 0xfd])],
  ];
  it.each(files)('answers invalid for %s, for a load and for a save, and leaves it as it was', async (_label, content) => {
    const s = await open();
    const { binding } = await loadOf(s);
    await save(s, binding, 0, { n: 1 });
    await writeFile(s.fileOf(A), content);
    const before = await bytes(s.fileOf(A));
    expect(await s.call('load', {})).toEqual(refusal('invalid'));
    expect(await save(s, binding, 1, { n: 2 })).toEqual(refusal('invalid'));
    expect(await bytes(s.fileOf(A))).toEqual(before);
    expect(await readdir(s.directory)).toEqual([documentName(A.origin)]);
  });

  it('reads a document an editor gave a UTF-8 byte order mark: it is well-formed, so it is not refused', async () => {
    const s = await open();
    const { binding } = await loadOf(s);
    await mkdir(s.directory, { recursive: true });
    await writeFile(s.fileOf(A), `\uFEFF${JSON.stringify(valid)}`);
    expect(await s.call('load', {})).toEqual({ ok: true, value: { binding, revision: 1, value: { n: 1 } } });
    expect(await save(s, binding, 1, { n: 2 })).toEqual({ ok: true, value: { revision: 2 } });
    expect(await readFile(s.fileOf(A), 'utf8')).toBe(JSON.stringify({ schema: 'hq.work-local/v1', revision: 2, value: { n: 2 } }));
  });

  it('answers invalid for a document path that is not a readable file, and a save leaves it alone', async () => {
    const s = await open();
    const { binding } = await loadOf(s);
    await mkdir(s.fileOf(A), { recursive: true });
    expect(await s.call('load', {})).toEqual(refusal('invalid'));
    expect(await save(s, binding, 0, { n: 1 })).toEqual(refusal('invalid'));
    expect((await stat(s.fileOf(A))).isDirectory()).toBe(true);
    expect(await readdir(s.fileOf(A))).toEqual([]);
  });

  it('does not follow a link at the document path, even to a valid document, and leaves both alone', async () => {
    const s = await open();
    const { binding } = await loadOf(s);
    await mkdir(s.directory, { recursive: true });
    const target = join(s.root, 'elsewhere.json');
    const body = JSON.stringify({ schema: 'hq.work-local/v1', revision: 1, value: { n: 1 } });
    await writeFile(target, body);
    await symlink(target, s.fileOf(A));
    expect(await s.call('load', {})).toEqual(refusal('invalid'));
    expect(await save(s, binding, 1, { n: 2 })).toEqual(refusal('invalid'));
    expect(await readFile(target, 'utf8')).toBe(body);
    expect((await stat(s.fileOf(A))).isFile()).toBe(true);
    expect(await readdir(s.directory)).toEqual([documentName(A.origin)]);
  });

  it('answers unavailable, naming no path, when the directory cannot be created', async () => {
    const s = await open();
    const { binding } = await loadOf(s);
    await writeFile(s.directory, 'a file where the directory should be');
    const answer = await save(s, binding, 0, { n: 1 });
    expect(answer.ok).toBe(false);
    expect(JSON.stringify(answer)).toMatch(/^\{"ok":false,"kind":"(invalid|unavailable)"\}$/u);
    expect(JSON.stringify(answer)).not.toContain(s.root);
  });
});

describe('serialization', () => {
  it('lets exactly one of several saves at the same revision win, the first one called', async () => {
    const s = await open();
    const { binding } = await loadOf(s);
    const answers = await Promise.all(Array.from({ length: 10 }, (_, n) => save(s, binding, 0, { winner: n })));
    expect(answers.filter((a) => a.ok)).toEqual([{ ok: true, value: { revision: 1 } }]);
    expect(answers[0]).toEqual({ ok: true, value: { revision: 1 } });
    expect(answers.slice(1)).toEqual(Array.from({ length: 9 }, () => refusal('conflict')));
    expect(JSON.parse(await readFile(s.fileOf(A), 'utf8'))).toEqual({ schema: 'hq.work-local/v1', revision: 1, value: { winner: 0 } });
    expect(await readdir(s.directory)).toEqual([documentName(A.origin)]);
  });

  it('applies saves issued together in call order, and runs a load in between against the document as it stands', async () => {
    const s = await open();
    const { binding } = await loadOf(s);
    const [one, between, two, last] = await Promise.all([
      save(s, binding, 0, { n: 1 }), s.call('load', {}), save(s, binding, 1, { n: 2 }), s.call('load', {}),
    ]);
    expect(one).toEqual({ ok: true, value: { revision: 1 } });
    expect(between).toEqual({ ok: true, value: { binding, revision: 1, value: { n: 1 } } });
    expect(two).toEqual({ ok: true, value: { revision: 2 } });
    expect(last).toEqual({ ok: true, value: { binding, revision: 2, value: { n: 2 } } });
    expect(await readdir(s.directory)).toEqual([documentName(A.origin)]);
  });

  it('runs different documents independently', async () => {
    const s = await open();
    const a = await loadOf(s);
    s.point(B);
    const b = await loadOf(s);
    s.point(A);
    const first = save(s, a.binding, 0, { address: 'a' });
    s.point(B);
    const second = save(s, b.binding, 0, { address: 'b' });
    expect(await Promise.all([first, second])).toEqual([{ ok: true, value: { revision: 1 } }, { ok: true, value: { revision: 1 } }]);
  });
});

describe('a failed write', () => {
  /** A rename that fails while `failing` is set, as a full disk or a crash before the swap would. */
  function flaky() {
    const state = { failing: true };
    const replace: Replace = async (temporary, destination) => {
      if (state.failing) throw new Error(`ENOSPC: no space left on device, rename '${temporary}' -> '${destination}'`);
      await rename(temporary, destination);
    };
    return { state, replace };
  }

  it('leaves the previous document intact, removes its temporary file, answers with a kind only, and does not advance the revision', async () => {
    const { state, replace } = flaky();
    state.failing = false;
    const s = await open({ replace });
    const { binding } = await loadOf(s);
    await save(s, binding, 0, { version: 'one' });
    const before = await bytes(s.fileOf(A));
    state.failing = true;
    const answer = await save(s, binding, 1, { version: 'two' });
    expect(answer).toEqual(refusal('unavailable'));
    expect(JSON.stringify(answer)).not.toMatch(/ENOSPC|rename|space|tmp/u);
    expect(await bytes(s.fileOf(A))).toEqual(before);
    expect(await readdir(s.directory)).toEqual([documentName(A.origin)]);
    expect(await loadOf(s)).toMatchObject({ revision: 1, value: { version: 'one' } });
    // The same save succeeds once the disk does, at the same revision: only one revision was ever spent.
    state.failing = false;
    expect(await save(s, binding, 1, { version: 'two' })).toEqual({ ok: true, value: { revision: 2 } });
  });

  it('leaves no document and no temporary file when the very first save fails', async () => {
    const { replace } = flaky();
    const s = await open({ replace });
    const { binding } = await loadOf(s);
    expect(await save(s, binding, 0, { n: 1 })).toEqual(refusal('unavailable'));
    expect(await readdir(s.directory)).toEqual([]);
    expect(await s.call('load', {})).toEqual({ ok: true, value: { binding, revision: 0, value: null } });
  });

  it('removes the remains of an interrupted write of the same document, and only those', async () => {
    const s = await open();
    const { binding } = await loadOf(s);
    await save(s, binding, 0, { n: 1 });
    const mine = `${documentName(A.origin)}.00000000-0000-4000-8000-000000000000.tmp`;
    const another = `${documentName(B.origin)}.00000000-0000-4000-8000-000000000000.tmp`;
    for (const name of [mine, another, 'unrelated.tmp', `${documentName(A.origin)}.keep`]) await writeFile(join(s.directory, name), 'x');
    expect(await save(s, binding, 1, { n: 2 })).toEqual({ ok: true, value: { revision: 2 } });
    expect((await readdir(s.directory)).sort()).toEqual([documentName(A.origin), `${documentName(A.origin)}.keep`, another, 'unrelated.tmp'].sort());
  });
});

describe('with the renderer persistence', () => {
  /** The real storage behind the preload's shape: what the renderer's `workLocalPersistence` talks to. */
  const persistenceOver = (s: Storage) => workLocalPersistence({ call: (route, params) => s.call(route, params) as never });

  it('loads, saves whole and reloads after a restart, and a stale writer is refused', async () => {
    const s = await open();
    const writer = persistenceOver(s);
    expect(await writer.load()).toBeNull();
    await writer.save({ queue: ['one'] });
    await writer.save({ queue: ['one', 'two'] });

    const restarted = await open({ root: s.root });
    const next = persistenceOver(restarted);
    expect(await next.load()).toEqual({ queue: ['one', 'two'] });
    await next.save({ queue: ['three'] });

    // The first writer never reloaded: its binding belongs to the previous process, so it cannot overwrite.
    await expect(writer.save({ queue: ['stale'] })).rejects.toBeInstanceOf(WorkLocalError);
    expect(JSON.parse(await readFile(s.fileOf(A), 'utf8')).value).toEqual({ queue: ['three'] });
  });

  it('refuses a second writer that loaded before the first saved', async () => {
    const s = await open();
    const first = persistenceOver(s), second = persistenceOver(s);
    await first.load();
    await second.load();
    await first.save({ by: 'first' });
    await expect(second.save({ by: 'second' })).rejects.toMatchObject({ kind: 'conflict' });
    expect(JSON.parse(await readFile(s.fileOf(A), 'utf8'))).toEqual({ schema: 'hq.work-local/v1', revision: 1, value: { by: 'first' } });
  });

  it('cannot write into another address\'s document after the address changes', async () => {
    const s = await open();
    const persistence = persistenceOver(s);
    await persistence.load();
    await persistence.save({ for: 'a' });
    s.point(B);
    await expect(persistence.save({ for: 'b?' })).rejects.toMatchObject({ kind: 'conflict' });
    await expect(stat(s.fileOf(B))).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await persistence.load()).toBeNull();
    await persistence.save({ for: 'b' });
    expect(JSON.parse(await readFile(s.fileOf(B), 'utf8')).value).toEqual({ for: 'b' });
    expect(JSON.parse(await readFile(s.fileOf(A), 'utf8')).value).toEqual({ for: 'a' });
  });

  it('rejects a load of a corrupt document, and then every save, leaving the file alone', async () => {
    const s = await open();
    const persistence = persistenceOver(s);
    await persistence.load();
    await persistence.save({ n: 1 });
    await writeFile(s.fileOf(A), '{ damaged');
    await expect(persistence.load()).rejects.toMatchObject({ kind: 'invalid' });
    await expect(persistence.save({ n: 2 })).rejects.toMatchObject({ kind: 'not_loaded' });
    expect(await readFile(s.fileOf(A), 'utf8')).toBe('{ damaged');
  });
});
