import { expect, expectTypeOf, it, vi } from 'vitest';
import { DESIGN_SERVICE_ROUTES, type DesignServiceParams, type DesignServiceValues, type ImportPickResult } from '@hq/contracts/services';
import { createDesignHost, type DesignStore } from './design-host';
import type { ImportPickerResult } from './import-picker.js';

const unavailable = { ok: false, kind: 'unavailable' };
const unopened = () => vi.fn(async (): Promise<DesignStore> => { throw new Error('Store must not open'); });
function barrier() {
  let resolve!: () => void;
  const promise = new Promise<void>(r => { resolve = r; });
  return { promise, resolve };
}

it('declares the empty-parameter picker route and matching renderer/backend result types', () => {
  expect(DESIGN_SERVICE_ROUTES).toContain('import.pick');
  expectTypeOf<DesignServiceParams['import.pick']>().toEqualTypeOf<Record<string, never>>();
  expectTypeOf<ImportPickResult>().toEqualTypeOf<ImportPickerResult>();
  expectTypeOf<DesignServiceValues['import.pick']>().toEqualTypeOf<ImportPickerResult>();
});

it('stays disabled without an injected picker and never opens storage', async () => {
  const open = unopened(), host = createDesignHost(open);
  try {
    expect(await host.call('import.pick', {})).toEqual({ ...unavailable, reason: 'disabled' });
    expect(open).not.toHaveBeenCalled();
  } finally { await host.close(); }
});

it.each([
  { status: 'canceled', path: 'synthetic-private-path', extra: true },
  { status: 'rejected', reason: 'invalid-png', path: 'synthetic-private-path', extra: true },
] as const)('returns only the public fields for $status without storage', async input => {
  const open = unopened(), pick = vi.fn(async () => input), host = createDesignHost(open, undefined, pick);
  try {
    expect(await host.call('import.pick', {})).toEqual({ ok: true, value: input.status === 'canceled'
      ? { status: 'canceled' } : { status: 'rejected', reason: 'invalid-png' } });
    expect(pick).toHaveBeenCalledTimes(1);
    expect(pick).toHaveBeenCalledWith();
    expect(open).not.toHaveBeenCalled();
  } finally { await host.close(); }
});

it('copies picked bytes and drops all extra and path fields at both result levels', async () => {
  const bytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  const input = { status: 'picked' as const, files: [{ name: 'synthetic.png', mediaType: 'image/png' as const, bytes, path: 'synthetic-private-path', extra: true }], path: 'synthetic-private-path', extra: true };
  const open = unopened(), pick = vi.fn(async () => input), host = createDesignHost(open, undefined, pick);
  try {
    const result = await host.call('import.pick', {});
    expect(result).toEqual({ ok: true, value: { status: 'picked', files: [{ name: 'synthetic.png', mediaType: 'image/png', bytes }] } });
    const value = (result as { ok: true; value: Extract<ImportPickResult, { status: 'picked' }> }).value;
    expect(value.files[0]!.bytes).not.toBe(bytes);
    bytes[0] = 0;
    expect(value.files[0]!.bytes[0]).toBe(137);
    value.files[0]!.bytes[1] = 0;
    expect(bytes[1]).toBe(80);
    expect(pick).toHaveBeenCalledTimes(1);
    expect(open).not.toHaveBeenCalled();
  } finally { await host.close(); }
});

it.each([
  null, [], 'invalid', { path: 'synthetic-private-path' }, { files: [] },
])('rejects nonempty or non-record parameters before the picker and storage: %j', async params => {
  const open = unopened(), pick = vi.fn(async (): Promise<ImportPickerResult> => ({ status: 'canceled' }));
  const host = createDesignHost(open, undefined, pick);
  try {
    expect(await host.call('import.pick', params)).toEqual({ ok: false, kind: 'invalid' });
    expect(pick).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
  } finally { await host.close(); }
});

it.each([
  null, undefined, [], 'picked', {}, { status: 'other' },
  { status: 'rejected' }, { status: 'rejected', reason: 1 },
  { status: 'picked' }, { status: 'picked', files: {} },
  { status: 'picked', files: [null] },
  { status: 'picked', files: [{ name: 1, mediaType: 'image/png', bytes: new Uint8Array() }] },
  { status: 'picked', files: [{ name: 'synthetic.png', mediaType: 'image/jpeg', bytes: new Uint8Array() }] },
  { status: 'picked', files: [{ name: 'synthetic.png', mediaType: 'image/png', bytes: [1] }] },
  { status: 'picked', files: [{ name: 'synthetic.png', mediaType: 'image/png', bytes: new Uint8Array() }, null] },
])('maps malformed picker output to unavailable without leaking it: %j', async value => {
  const open = unopened(), pick = vi.fn(async () => value as ImportPickerResult);
  const host = createDesignHost(open, undefined, pick);
  try {
    expect(await host.call('import.pick', {})).toEqual(unavailable);
    expect(pick).toHaveBeenCalledTimes(1);
    expect(open).not.toHaveBeenCalled();
  } finally { await host.close(); }
});

it.each([
  () => { throw new Error('synthetic-private-path'); },
  async () => { throw new Error('synthetic-private-path'); },
  async () => ({ get status(): never { throw new Error('synthetic-private-path'); } }),
])('maps thrown picker and validation failures to a closed unavailable envelope', async implementation => {
  const open = unopened(), pick = vi.fn(implementation as () => Promise<ImportPickerResult>);
  const host = createDesignHost(open, undefined, pick);
  try {
    expect(await host.call('import.pick', {})).toEqual(unavailable);
    expect(pick).toHaveBeenCalledTimes(1);
    expect(open).not.toHaveBeenCalled();
  } finally { await host.close(); }
});

it('resolves import.pick while import.commit holds the exclusive gate behind an unresolved barrier', async () => {
  const entered = barrier(), blocked = barrier();
  let released = false, commitFinished = false;
  const commit = vi.fn(async () => {
    entered.resolve();
    await blocked.promise;
    commitFinished = true;
    return { ok: true as const, value: { committed: true } };
  });
  const workspace = { getDocument: vi.fn(), putDocument: vi.fn(), listDocuments: vi.fn(), putBlob: vi.fn(), getBlob: vi.fn(), hasBlob: vi.fn(), appendEvent: vi.fn(), readEvents: vi.fn() };
  const store = {
    workspace,
    transactions: { workspace, status: { accepted: true, state: 'candidate' }, recover: vi.fn().mockResolvedValue({ ok: true }), commit, repair: vi.fn(), diagnostics: vi.fn() },
    exportBundle: { status: { state: 'disabled' }, preview: vi.fn(), build: vi.fn() },
    cache: { getDocument: vi.fn(), putDocument: vi.fn() }, close: vi.fn().mockResolvedValue(undefined),
  } satisfies DesignStore;
  const open = vi.fn(async () => store), pick = vi.fn(async (): Promise<ImportPickerResult> => ({ status: 'canceled' }));
  const host = createDesignHost(open, undefined, pick);
  const committing = host.call('import.commit', { ops: [{ op: 'put-document', namespace: 'workspace', key: 'design/projects/synthetic', value: {}, expectedRevision: null }] });
  let picking: ReturnType<typeof host.call> | undefined;
  try {
    await entered.promise;
    expect(commit).toHaveBeenCalledTimes(1);
    expect(commitFinished).toBe(false);
    picking = host.call('import.pick', {});
    // Direct dispatch invokes the fake picker now; a queued regression fails before awaiting it.
    expect(pick).toHaveBeenCalledTimes(1);
    expect(await picking).toEqual({ ok: true, value: { status: 'canceled' } });
    expect(released).toBe(false);
    expect(commitFinished).toBe(false);
    expect(open).toHaveBeenCalledTimes(1);
  } finally {
    released = true;
    blocked.resolve();
    await Promise.allSettled([committing, ...(picking ? [picking] : [])]);
    await host.close();
  }
  expect(await committing).toEqual({ ok: true, value: { committed: true } });
  expect(store.close).toHaveBeenCalledTimes(1);
});
