import { afterEach, expect, it, vi } from 'vitest';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { createSaveDialog } from './save-dialog';
import { createWorkExport, readExport, WORK_EXPORT_CAP } from './work-export';
const owned: string[] = [];
afterEach(async () => { for (const path of owned.splice(0)) await rm(path, { recursive: true, force: true }); });
const config = { get: () => new URL('http://127.0.0.1:12345') };
it('native dialog stub writes unmodified bytes by temp + rename and returns no path', async () => {
  await mkdir('.t3/shared-r3', { recursive: true }); const root = await mkdtemp(join(process.cwd(), '.t3/shared-r3/export-')); owned.push(root);
  const destination = join(root, 'chosen.json'), bytes = new Uint8Array([0xef, 0xbb, 0xbf, 123, 32, 125, 13, 10, 0, 255]);
  const choose = vi.fn(async () => destination), read = vi.fn(async () => ({ ok: true as const, status: 200, body: bytes, replayed: false }));
  const exportWork = createWorkExport(config, createSaveDialog(choose), read);
  expect(await exportWork({ format: 'json' })).toEqual({ ok: true, status: 200, body: { saved: true }, replayed: false });
  expect(new Uint8Array(await readFile(destination))).toEqual(bytes); expect(await readdir(root)).toEqual(['chosen.json']);
  expect(read.mock.calls[0]![0].pathname).toBe('/api/export');
});
it('8 MiB is accepted, larger bytes are refused before the native dialog, and errors never write', async () => {
  const save = vi.fn(async () => ({ saved: true }));
  for (const [size, accepted] of [[WORK_EXPORT_CAP, true], [WORK_EXPORT_CAP + 1, false]] as const) {
    save.mockClear(); const read = async () => ({ ok: true as const, status: 200, body: new Uint8Array(size), replayed: false });
    expect((await createWorkExport(config, save, read)({ format: 'markdown' })).ok).toBe(accepted); expect(save).toHaveBeenCalledTimes(accepted ? 1 : 0);
  }
  save.mockClear();
  expect(await createWorkExport(config, save, async () => ({ ok: true, status: 503, body: new Uint8Array(), replayed: false }))({ format: 'json' })).toEqual({ ok: true, status: 503, body: { saved: false }, replayed: false });
  expect(await createWorkExport(config, save, async () => { throw Error('transport lost'); })({ format: 'json' })).toEqual({ ok: false, kind: 'unavailable' });
  expect(save).not.toHaveBeenCalled();
});
it('cancel writes nothing and rejects renderer paths or unsupported formats', async () => {
  const choose = vi.fn(async () => null), read = vi.fn(async () => ({ ok: true as const, status: 200, body: new Uint8Array(), replayed: false }));
  const run = createWorkExport(config, createSaveDialog(choose), read);
  expect(await run({ format: 'markdown' })).toEqual({ ok: true, status: 200, body: { saved: false }, replayed: false });
  for (const params of [{ format: 'json', path: '/not-allowed' }, { format: 'html' }, {}]) expect(await run(params)).toEqual({ ok: false, kind: 'unavailable' });
  expect(choose).toHaveBeenCalledTimes(1);
});
it('the HTTP reader caps streamed bytes, preserves non-JSON, and never follows redirects', async () => {
  const server = createServer((req, res) => {
    if (req.url === '/large') { res.end(Buffer.alloc(WORK_EXPORT_CAP + 1)); return; }
    if (req.url === '/redirect') { res.writeHead(302, { Location: '/must-not-follow' }); res.end(); return; }
    if (req.url === '/must-not-follow') throw Error('Redirect followed');
    res.end(Buffer.from([0, 255, 13, 10]));
  });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  try {
    const address = server.address() as { port: number }, base = `http://127.0.0.1:${address.port}`;
    expect(await readExport(new URL(base + '/bytes'))).toEqual({ ok: true, status: 200, body: Buffer.from([0, 255, 13, 10]), replayed: false });
    expect(await readExport(new URL(base + '/large'))).toEqual({ ok: false, kind: 'unavailable' });
    expect(await readExport(new URL(base + '/redirect'))).toMatchObject({ ok: true, status: 302 });
  } finally { server.closeAllConnections(); await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
});
