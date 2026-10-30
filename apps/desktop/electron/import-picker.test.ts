import { constants } from 'node:fs';
import { expect, it, vi } from 'vitest';
import { DESIGN_BLOB_CAP } from './design-host';
import { IMPORT_LIMITS } from '../../../modules/design/app/storage/transactions.ts';
import { createImportPicker, type ImportPickerDependencies, type ImportPickerFileHandle, type ImportPickerResult } from './import-picker';

const MiB = 1024 * 1024;
const signature = [137, 80, 78, 71, 13, 10, 26, 10];
const privatePath = '/synthetic/selected/hidden.png';
interface Entry {
  path?: string;
  kind?: 'symlink' | 'fifo' | 'directory';
  size?: number;
  actualSize?: number;
  afterSize?: number;
  signature?: readonly number[];
  chunk?: number;
  readResult?: number;
  failure?: 'open' | 'stat' | 'read' | 'restat' | 'close';
}

// Virtual bytes are generated into the caller's bounded buffer; no disk or scratch exists.
function fixture(entries: readonly Entry[] = [{}]) {
  const paths = entries.map((entry, index) => entry.path ?? `/synthetic/selected/${index}.png`);
  const activity = entries.map(() => ({ opened: 0, closed: 0, stats: 0, reads: 0, readBytes: 0, maxRead: 0, flags: -1, nextPosition: 0 }));
  const showOpenDialog = vi.fn<ImportPickerDependencies['showOpenDialog']>().mockResolvedValue({ canceled: false, filePaths: paths });
  let opens = 0;
  const fs: ImportPickerDependencies['fs'] = {
    async open(path, flags) {
      const index = opens++;
      const entry = entries[index]!;
      const log = activity[index]!;
      expect(path).toBe(paths[index]);
      log.flags = flags;
      if (entry.kind === 'symlink' || entry.failure === 'open') throw new Error(`ELOOP: ${path}`);
      log.opened++;
      const size = entry.size ?? 8;
      return {
        async stat() {
          log.stats++;
          if (entry.failure === 'stat' || (entry.failure === 'restat' && log.stats > 1)) throw new Error(path);
          return { size: log.stats > 1 ? entry.afterSize ?? size : size, isFile: () => !entry.kind };
        },
        async read(buffer, offset, length, position) {
          log.reads++;
          log.maxRead = Math.max(log.maxRead, length);
          expect(position).toBe(log.nextPosition);
          expect(offset + length).toBeLessThanOrEqual(buffer.length);
          if (entry.failure === 'read') throw new Error(path);
          if (entry.readResult !== undefined) return { bytesRead: entry.readResult };
          const bytesRead = Math.min(length, entry.chunk ?? length, Math.max(0, (entry.actualSize ?? size) - position));
          buffer.fill(0, offset, offset + bytesRead);
          for (let index = position; index < Math.min(position + bytesRead, 8); index++) buffer[offset + index - position] = (entry.signature ?? signature)[index]!;
          log.nextPosition += bytesRead;
          log.readBytes += bytesRead;
          return { bytesRead };
        },
        async close() {
          log.closed++;
          if (entry.failure === 'close') throw new Error(path);
        },
      } satisfies ImportPickerFileHandle;
    },
  };
  return { picker: createImportPicker({ showOpenDialog, fs }), showOpenDialog, activity, openCount: () => opens };
}

function expectClosed(activity: ReturnType<typeof fixture>['activity']) {
  for (const log of activity) expect(log.closed).toBe(log.opened);
}

function expectRejected(result: ImportPickerResult, reason: string) {
  expect(result).toEqual({ status: 'rejected', reason });
  expect(result).not.toHaveProperty('files');
  expect(JSON.stringify(result)).not.toContain('/synthetic');
}

it('constructs without IO, requests PNG multiselect only on pick, and cancels without opening', async () => {
  const f = fixture();
  expect(f.showOpenDialog).not.toHaveBeenCalled();
  expect(f.openCount()).toBe(0);
  f.showOpenDialog.mockResolvedValue({ canceled: true, filePaths: [privatePath] });
  expect(await f.picker.pick()).toEqual({ status: 'canceled' });
  expect(f.showOpenDialog).toHaveBeenCalledWith({ properties: ['openFile', 'multiSelections'], filters: [{ name: 'PNG images', extensions: ['png'] }] });
  expect(f.openCount()).toBe(0);
  expect(await fixture([]).picker.pick()).toEqual({ status: 'canceled' });
});

it('returns ordered PNG bytes and basenames only, with read-only no-follow nonblocking descriptors', async () => {
  const f = fixture([{ path: privatePath, size: 11 }, { path: 'C:\\synthetic\\selected\\second.png' }]);
  const result = await f.picker.pick();
  expect(result).toEqual({ status: 'picked', files: [
    { name: 'hidden.png', mediaType: 'image/png', bytes: new Uint8Array([...signature, 0, 0, 0]) },
    { name: 'second.png', mediaType: 'image/png', bytes: new Uint8Array(signature) },
  ] });
  expect(JSON.stringify(result)).not.toMatch(/synthetic|selected|rights|provenance/);
  for (const log of f.activity) {
    expect(log.flags & constants.O_NOFOLLOW).toBe(constants.O_NOFOLLOW);
    expect(log.flags & constants.O_NONBLOCK).toBe(constants.O_NONBLOCK);
    expect(log.flags & (constants.O_WRONLY | constants.O_RDWR | constants.O_CREAT | constants.O_TRUNC | constants.O_APPEND)).toBe(0);
  }
  expectClosed(f.activity);
});

it.each(['symlink', 'fifo', 'directory'] as const)('refuses %s before any read and closes every acquired descriptor', async kind => {
  const f = fixture([{ kind }]);
  expectRejected(await f.picker.pick(), kind === 'symlink' ? 'unavailable' : 'not-regular-file');
  expect(f.activity[0]!.reads).toBe(0);
  expectClosed(f.activity);
});

it('accepts the inclusive 16 MiB file cap shared with the host and storage, refusing oversize before read', async () => {
  expect(DESIGN_BLOB_CAP).toBe(16 * MiB);
  expect(IMPORT_LIMITS.blobBytes).toBe(DESIGN_BLOB_CAP);
  const f = fixture([{ size: DESIGN_BLOB_CAP }]);
  const result = await f.picker.pick();
  expect(result.status).toBe('picked');
  if (result.status !== 'picked') throw new Error('Expected boundary file');
  expect(result.files[0]!.bytes.byteLength).toBe(DESIGN_BLOB_CAP);
  expect(f.activity[0]!.maxRead).toBeLessThanOrEqual(64 * 1024);
  expect(f.activity[0]!.reads).toBe(257);
  expectClosed(f.activity);
  const over = fixture([{ size: DESIGN_BLOB_CAP + 1 }]);
  expectRejected(await over.picker.pick(), 'file-too-large');
  expect(over.activity[0]!.reads).toBe(0);
  expectClosed(over.activity);
});

it('accepts 256 files and refuses 257 before opening any descriptor', async () => {
  const f = fixture(Array.from({ length: 256 }, () => ({})));
  const result = await f.picker.pick();
  expect(result.status).toBe('picked');
  if (result.status !== 'picked') throw new Error('Expected boundary selection');
  expect(result.files).toHaveLength(256);
  expectClosed(f.activity);
  const over = fixture(Array.from({ length: 257 }, () => ({})));
  expectRejected(await over.picker.pick(), 'too-many-files');
  expect(over.openCount()).toBe(0);
});

it('accepts exactly 64 MiB aggregate and refuses one byte over without a partial result or reading the excess file', async () => {
  expect(IMPORT_LIMITS.totalBytes).toBe(64 * MiB);
  const f = fixture(Array.from({ length: 4 }, () => ({ size: 16 * MiB })));
  const result = await f.picker.pick();
  expect(result.status).toBe('picked');
  if (result.status !== 'picked') throw new Error('Expected aggregate boundary');
  expect(result.files.reduce((total, file) => total + file.bytes.byteLength, 0)).toBe(IMPORT_LIMITS.totalBytes);
  expectClosed(f.activity);
  const over = fixture([{ size: 16 * MiB }, { size: 16 * MiB }, { size: 16 * MiB }, { size: 16 * MiB - 7 }, { size: 8 }]);
  expectRejected(await over.picker.pick(), 'total-too-large');
  expect(over.activity[4]!.reads).toBe(0);
  expectClosed(over.activity);
});

it.each([
  { size: 7 },
  ...signature.map((byte, index) => ({ signature: signature.map((value, offset) => offset === index ? byte ^ 255 : value) })),
])('refuses short or incorrect eight-byte PNG signatures with no partial result: %j', async entry => {
  const f = fixture([{}, entry]);
  expectRejected(await f.picker.pick(), 'invalid-png');
  expectClosed(f.activity);
});

it('reassembles partial reads, uses explicit contiguous positions, and probes EOF after exactly the validated size', async () => {
  const f = fixture([{ size: 31, chunk: 3 }]);
  const result = await f.picker.pick();
  expect(result).toEqual({ status: 'picked', files: [{ name: '0.png', mediaType: 'image/png', bytes: new Uint8Array([...signature, ...Array<number>(23).fill(0)]) }] });
  expect(f.activity[0]).toMatchObject({ readBytes: 31, reads: 12, stats: 2 });
  expectClosed(f.activity);
});

it.each([
  { size: 16, actualSize: 10 },
  { size: 8, actualSize: 9 },
  { afterSize: 9 },
  { afterSize: 7 },
  { size: -1 },
  { size: Number.NaN },
  { size: Number.POSITIVE_INFINITY },
  { size: 8.5 },
  { size: Number.MAX_SAFE_INTEGER + 1 },
  { readResult: 0 },
  { readResult: -1 },
  { readResult: 9 },
  { readResult: 0.5 },
  { readResult: Number.NaN },
])('rejects invalid metadata, premature EOF, growth and invalid read counts: %j', async entry => {
  const f = fixture([entry]);
  expectRejected(await f.picker.pick(), 'file-changed');
  expectClosed(f.activity);
});

it('bounds pathological short-read call counts and closes on exhaustion', async () => {
  const f = fixture([{ size: 8192, chunk: 1 }]);
  expectRejected(await f.picker.pick(), 'read-limit');
  expect(f.activity[0]!.reads).toBe(4096);
  expectClosed(f.activity);
});

it.each(['open', 'stat', 'read', 'restat', 'close'] as const)('sanitizes %s errors, discards earlier files, and closes acquired handles', async failure => {
  const f = fixture([{}, { path: privatePath, failure }, {}]);
  expectRejected(await f.picker.pick(), 'unavailable');
  expect(f.openCount()).toBe(2);
  expectClosed(f.activity);
});

it('sanitizes dialog failures without opening files and permits a subsequent independent pick', async () => {
  const f = fixture();
  f.showOpenDialog.mockRejectedValueOnce(new Error(privatePath));
  expectRejected(await f.picker.pick(), 'unavailable');
  expect(f.openCount()).toBe(0);
  expect((await f.picker.pick()).status).toBe('picked');
  expectClosed(f.activity);
});

it('refuses malformed selections and unsafe empty basenames before opening', async () => {
  for (const path of ['', '/', '.', '..']) {
    const f = fixture([{ path }]);
    expectRejected(await f.picker.pick(), 'invalid-selection');
    expect(f.openCount()).toBe(0);
  }
});
