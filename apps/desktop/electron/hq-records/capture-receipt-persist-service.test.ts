import { describe, expect, it, vi } from 'vitest';
import type { CanonicalValue } from './canonical.js';
import { encodeCaptureReceipt } from './capture-evidence.js';
import { createCaptureReceiptPersistService, type CaptureReceiptPersistBacking } from './capture-receipt-persist-service.js';
import { captureReceiptKey } from './keys.js';

// Synthetic protocol input only; no producer, fixture attestation or real store is exercised.
function receipt() {
  return {
    schema: 'hq.design.capture-evidence/v1', captureId: 'capture-1',
    producer: { id: 'hq.electron-preview', contract: 1, mode: 'production', appVersion: '0.0.0-synthetic', packaged: false },
    host: { sessionId: 'synthetic-session', hostVersionId: 'synthetic-host', generation: 1 },
    page: { origin: 'https://example.com', route: '/synthetic', state: '' },
    viewport: { w: 320.5, h: 240.25, dpr: 2 }, scroll: { x: 0.1, y: 1e-7 },
    pageExtentCss: { width: 640.75, height: 960.125 },
    imageRectCss: { x: 0.1, y: 1e-7, width: 320.5, height: 240.25 },
    image: { mediaType: 'image/png', digest: `sha256:${'a'.repeat(64)}`, byteLength: 123, pixelWidth: 641, pixelHeight: 481 },
    time: { capturedAt: '2026-11-02T00:00:01Z', basis: 'host-clock-after-coherence-before-persist', acquisition: null },
    persistedAt: '2026-11-02T00:00:02Z', fixture: { state: 'unknown', attestedBy: null },
  };
}

function backing(put: CaptureReceiptPersistBacking['putDocument']) {
  return {
    putDocument: vi.fn(put),
    getDocument: vi.fn(() => { throw new Error('Unexpected read'); }),
    listDocuments: vi.fn(() => { throw new Error('Unexpected list'); }),
    hasBlob: vi.fn(() => { throw new Error('Unexpected blob probe'); }),
  };
}

function expectNoReads(fake: ReturnType<typeof backing>) {
  expect(fake.getDocument).not.toHaveBeenCalled();
  expect(fake.listDocuments).not.toHaveBeenCalled();
  expect(fake.hasBlob).not.toHaveBeenCalled();
}

describe('inert create-only capture receipt persistence', () => {
  it('does no construction I/O and writes one exact detached receipt, retaining fractional geometry', async () => {
    const source = receipt();
    const fake = backing(async (key, value) => ({ key, revision: 1, value }));
    const service = createCaptureReceiptPersistService({ backing: fake });
    expect(fake.putDocument).not.toHaveBeenCalled();
    expect(await service.persist(source)).toBe(true);
    expect(fake.putDocument).toHaveBeenCalledExactlyOnceWith(captureReceiptKey(source.captureId), source, { expectedRevision: null });
    const written = fake.putDocument.mock.calls[0][1] as ReturnType<typeof receipt>;
    expect(written).not.toBe(source);
    for (const field of ['producer', 'host', 'page', 'viewport', 'scroll', 'pageExtentCss', 'imageRectCss', 'image', 'time', 'fixture'] as const) {
      expect(written[field]).not.toBe(source[field]);
    }
    expect(encodeCaptureReceipt(written)).toBe(encodeCaptureReceipt(source));
    expect(written.scroll).toEqual({ x: 0.1, y: 1e-7 });
    expect(written.imageRectCss).toEqual({ x: 0.1, y: 1e-7, width: 320.5, height: 240.25 });
    expectNoReads(fake);
  });

  it('rejects invalid schema, IDs, nested fields and any fixture beyond exact unknown/null before I/O', async () => {
    const fake = backing(async (key, value) => ({ key, revision: 1, value }));
    const service = createCaptureReceiptPersistService({ backing: fake });
    const source = receipt();
    const invalid: unknown[] = [
      null, {}, { ...source, schema: 'hq.design.capture-evidence/v2' },
      { ...source, captureId: 'capture/1' }, { ...source, captureId: 'A' },
      { ...source, viewport: { ...source.viewport, w: Infinity } },
      { ...source, image: { ...source.image, digest: 'invalid' } },
      { ...source, time: { ...source.time, acquisition: { start: 'invalid', end: 'invalid' } } },
      { ...source, extra: true },
      { ...source, fixture: { state: 'known-present', attestedBy: null } },
      { ...source, fixture: { state: 'known-absent', attestedBy: 'hq.electron-preview/contract-1' } },
      { ...source, fixture: { state: 'unknown', attestedBy: 'hq.electron-preview/contract-1' } },
      { ...source, fixture: { state: 'unknown' } },
    ];
    for (const value of invalid) expect(await service.persist(value)).toBe(false);
    expect(fake.putDocument).not.toHaveBeenCalled();
    expectNoReads(fake);
  });

  it('keeps concurrent and later collisions create-only, with no read or retry for the loser', async () => {
    const stored = new Map<string, CanonicalValue>();
    const fake = backing(async (key, value, options) => {
      expect(options).toEqual({ expectedRevision: null });
      if (stored.has(key)) throw Object.assign(new Error('Already exists'), { code: 'CONFLICT' });
      stored.set(key, value);
      await Promise.resolve();
      return { key, revision: 1, value };
    });
    const service = createCaptureReceiptPersistService({ backing: fake });
    const first = receipt(), collision = { ...receipt(), page: { ...receipt().page, route: '/collision' } };
    expect(await Promise.all([service.persist(first), service.persist(collision)])).toEqual([true, false]);
    expect(await service.persist(first)).toBe(false);
    expect(fake.putDocument).toHaveBeenCalledTimes(3);
    expect(stored.get(captureReceiptKey(first.captureId))).toEqual(first);
    expectNoReads(fake);
  });

  it('returns false for conflicts, general throws and lost acknowledgements without retry or rollback', async () => {
    for (const error of [Object.assign(new Error('Conflict'), { code: 'CONFLICT' }), new Error('Unavailable'), undefined]) {
      const fake = backing(() => { throw error; });
      expect(await createCaptureReceiptPersistService({ backing: fake }).persist(receipt())).toBe(false);
      expect(fake.putDocument).toHaveBeenCalledTimes(1);
      expectNoReads(fake);
    }
    let possiblyWritten: CanonicalValue | undefined;
    const fake = backing(async (_key, value) => {
      possiblyWritten = value;
      throw new Error('Acknowledgement lost after write');
    });
    expect(await createCaptureReceiptPersistService({ backing: fake }).persist(receipt())).toBe(false);
    expect(possiblyWritten).toEqual(receipt());
    expect(fake.putDocument).toHaveBeenCalledTimes(1);
    expectNoReads(fake);
  });

  it('requires the same key, exact revision 1 and a codec-valid canonically equal ACK value', async () => {
    const source = receipt(), key = captureReceiptKey(source.captureId);
    const valid = { key, revision: 1, value: source };
    const badAcks: unknown[] = [
      undefined, null, false, [], {}, { key, revision: 1 },
      { ...valid, key: `${key}-other` },
      ...[0, 2, 1.5, '1', null, NaN].map(revision => ({ ...valid, revision })),
      { ...valid, value: { ...source, captureId: 'capture-2' } },
      { ...valid, value: { ...source, scroll: { ...source.scroll, y: 0.2 } } },
      { ...valid, value: { ...source, fixture: { state: 'known-present', attestedBy: null } } },
      { ...valid, value: { ...source, extra: true } },
      Object.defineProperty({ ...valid }, 'value', { enumerable: true, get() { throw new Error('Malformed ACK'); } }),
    ];
    for (const ack of badAcks) {
      const fake = backing(async () => ack);
      expect(await createCaptureReceiptPersistService({ backing: fake }).persist(source)).toBe(false);
      expect(fake.putDocument).toHaveBeenCalledTimes(1);
      expectNoReads(fake);
    }
    const fake = backing(async () => ({ ...valid, value: JSON.parse(encodeCaptureReceipt(source)), namespace: 'workspace' }));
    expect(await createCaptureReceiptPersistService({ backing: fake }).persist(source)).toBe(true);
    expect(fake.putDocument).toHaveBeenCalledTimes(1);
    expectNoReads(fake);
  });

  it('holds the admission snapshot while the caller mutates during an outstanding write', async () => {
    for (const acknowledgeMutatedCaller of [false, true]) {
      const source = receipt();
      const original = JSON.parse(encodeCaptureReceipt(source));
      let acknowledge!: (value: unknown) => void;
      const fake = backing((_key, value) => {
        expect(value).toEqual(original);
        return new Promise(resolve => { acknowledge = resolve; });
      });
      const pending = createCaptureReceiptPersistService({ backing: fake }).persist(source);
      source.page.route = '/caller-mutated';
      source.scroll.y = 0.75;
      acknowledge({ key: captureReceiptKey(original.captureId), revision: 1, value: acknowledgeMutatedCaller ? source : original });
      expect(await pending).toBe(!acknowledgeMutatedCaller);
      expect(fake.putDocument.mock.calls[0][1]).toEqual(original);
      expect(fake.putDocument).toHaveBeenCalledTimes(1);
      expectNoReads(fake);
    }
  });

  it('does not let synchronous or asynchronous backing mutation redefine the admitted comparison', async () => {
    for (const asynchronous of [false, true]) for (const acknowledgeMutatedArgument of [false, true]) {
      const source = receipt(), original = JSON.parse(encodeCaptureReceipt(source));
      const fake = backing(async (key, value) => {
        if (asynchronous) await Promise.resolve();
        const mutable = value as ReturnType<typeof receipt>;
        mutable.page.route = '/backing-mutated';
        mutable.imageRectCss.width = 123.125;
        return { key, revision: 1, value: acknowledgeMutatedArgument ? value : original };
      });
      expect(await createCaptureReceiptPersistService({ backing: fake }).persist(source)).toBe(!acknowledgeMutatedArgument);
      expect(source).toEqual(original);
      expect(fake.putDocument).toHaveBeenCalledTimes(1);
      expectNoReads(fake);
    }
  });
});
