import { describe, expect, it, vi } from 'vitest';
import { canonicalFiniteDigest, sha256Bytes, type Digest } from './canonical.js';
import { captureReceiptDigest, decodeCaptureReceipt, encodeCaptureReceipt, staticCaptureEligible, type CaptureReceipt, type StaticCaptureEligibility } from './capture-evidence.js';
import { createCaptureReceiptReadService } from './capture-receipt-read-service.js';
import { captureReceiptKey } from './keys.js';

type Mutable<T> = T extends object ? { -readonly [K in keyof T]: Mutable<T[K]> } : T;
const goldenDigest: Digest = 'sha256:4fac383be73be1e6b1095dfc528036c8c65e0d67491b5e39e2eae9bf717a4ae8';

// Matches the CAP-1 codec vector. Synthetic stored evidence never proves a production capture.
function receipt(): Mutable<CaptureReceipt> {
  return {
    schema: 'hq.design.capture-evidence/v1', captureId: 'capture-1',
    producer: { id: 'hq.electron-preview', contract: 1, mode: 'production', appVersion: '0.0.0-synthetic', packaged: false },
    host: { sessionId: 'synthetic-session', hostVersionId: 'synthetic-host-version', generation: 7 },
    page: { origin: 'https://example.com', route: '/design?view=1', state: '' }, viewport: { w: 1920, h: 1080, dpr: 1 },
    scroll: { x: 0.1, y: 1e-7 }, pageExtentCss: { width: 1920.5, height: 1080.25 },
    imageRectCss: { x: 0, y: 0, width: 1920.5, height: 1080.25 },
    image: { mediaType: 'image/png', digest: `sha256:${'a'.repeat(64)}`, byteLength: 1234, pixelWidth: 1921, pixelHeight: 1081 },
    time: { capturedAt: '2026-11-02T00:00:01Z', basis: 'host-clock-after-coherence-before-persist',
      acquisition: { start: '2026-11-02T00:00:00Z', end: '2026-11-02T00:00:01Z' } },
    persistedAt: '2026-11-02T00:00:02Z', fixture: { state: 'known-absent', attestedBy: 'hq.electron-preview/contract-1' },
  };
}

function document(value: unknown = receipt()) {
  return { key: captureReceiptKey('capture-1'), revision: 7, value };
}

function request(value: CaptureReceipt = receipt()) {
  return { captureId: value.captureId, receiptDigest: captureReceiptDigest(value) };
}

describe('inert capture receipt reads with fake backing only', () => {
  it('has no construction effects and rejects malformed closed requests before any I/O', async () => {
    const getDocument = vi.fn(async () => document());
    const service = createCaptureReceiptReadService({ backing: { getDocument } });
    expect(getDocument).not.toHaveBeenCalled();
    expect(Object.keys(service)).toEqual(['read']);
    const readAccessor = vi.fn(() => { throw Error('request getter must not execute'); });
    const accessor = Object.defineProperty({ receiptDigest: goldenDigest }, 'captureId', { enumerable: true, get: readAccessor });
    const malformed: unknown[] = [null, undefined, true, 'capture-1', [], {},
      { captureId: 'capture-1' }, { receiptDigest: goldenDigest }, { ...request(), extra: undefined },
      { ...request(), operationId: 'read-1' }, { ...request(), [Symbol('extra')]: true }, accessor,
      ...['', 'A', 'a/b', 'a'.repeat(65), 1, null].map(captureId => ({ ...request(), captureId })),
      ...['', 'a'.repeat(64), `sha256:${'A'.repeat(64)}`, `sha256:${'a'.repeat(63)}`, 1, null]
        .map(receiptDigest => ({ ...request(), receiptDigest })),
    ];
    for (const value of malformed) {
      expect(await service.read(value)).toEqual({ status: 'invalid', reason: 'request-invalid' });
    }
    expect(getDocument).not.toHaveBeenCalled();
    expect(readAccessor).not.toHaveBeenCalled();
  });

  it('reads exactly the authoritative receipt key and returns closed absence or unknown without retry/error leakage', async () => {
    const getDocument = vi.fn(async (_key: string): Promise<unknown> => null);
    const service = createCaptureReceiptReadService({ backing: { getDocument } });
    expect(await service.read(request())).toEqual({ status: 'absent' });
    expect(getDocument.mock.calls).toEqual([[captureReceiptKey('capture-1')]]);
    getDocument.mockRejectedValueOnce({ privateError: 'must not escape' });
    expect(await service.read(request())).toEqual({ status: 'unknown', phase: 'receipt-read' });
    expect(getDocument.mock.calls).toEqual([[captureReceiptKey('capture-1')], [captureReceiptKey('capture-1')]]);
  });

  it('rejects malformed observations, unsafe revisions, invalid CAP-1 values and mismatched capture identity', async () => {
    const wrongIdentity = { ...receipt(), captureId: 'capture-2' };
    const malformed: unknown[] = [undefined, [], 'document', {},
      { ...document(), key: captureReceiptKey('capture-2') }, { ...document(), key: undefined },
      ...[0, -1, 0.5, Number.MAX_SAFE_INTEGER + 1, NaN, Infinity, '7', undefined]
        .map(revision => ({ ...document(), revision })),
      ...[null, {}, { ...receipt(), schema: 'hq.design.capture-evidence/v2' },
        { ...receipt(), extra: true }, { ...receipt(), scroll: { x: Infinity, y: 0 } }, wrongIdentity].map(value => document(value)),
      Object.defineProperty(document(), 'value', { enumerable: true, get: () => { throw Error('no getter'); } }),
    ];
    for (const observation of malformed) {
      const getDocument = vi.fn(async () => observation);
      const service = createCaptureReceiptReadService({ backing: { getDocument } });
      // Even a matching digest cannot replace the requested capture identity.
      const admitted = { ...request(), receiptDigest: captureReceiptDigest(wrongIdentity) };
      expect(await service.read(admitted)).toEqual({ status: 'invalid', reason: 'receipt-invalid' });
      expect(getDocument.mock.calls).toEqual([[captureReceiptKey('capture-1')]]);
    }
  });

  it('conflicts on protocol digest mismatch without substituting a different stored receipt', async () => {
    const stored = receipt();
    stored.page.state = '#different-stored-state';
    const getDocument = vi.fn(async () => document(stored));
    const service = createCaptureReceiptReadService({ backing: { getDocument } });
    expect(await service.read(request())).toEqual({ status: 'conflict', reason: 'receipt-digest-mismatch' });
    expect(stored.page.state).toBe('#different-stored-state');
    expect(getDocument).toHaveBeenCalledTimes(1);
  });

  it('returns the observed revision and finite protocol digest with exact fractional codec parity', async () => {
    const stored = receipt();
    const observation = { ...document(stored), valueDigest: `sha256:${'f'.repeat(64)}`, updatedAt: 'store-metadata' };
    const getDocument = vi.fn(async () => observation);
    const service = createCaptureReceiptReadService({ backing: { getDocument } });
    expect(await service.read(request())).toEqual({ status: 'observed', revision: 7, receiptDigest: goldenDigest,
      receipt: decodeCaptureReceipt(stored), eligibility: staticCaptureEligible(stored) });
    const fractional = { ...stored, scroll: { x: 0.30000000000000004, y: 1e-7 },
      pageExtentCss: { width: 123.45600000000002, height: 1e-7 },
      imageRectCss: { x: 0, y: 0, width: 123.45600000000002, height: 1e-7 } };
    observation.value = fractional;
    observation.revision = Number.MAX_SAFE_INTEGER;
    const digest = canonicalFiniteDigest(decodeCaptureReceipt(fractional));
    expect(digest).toBe(captureReceiptDigest(fractional));
    expect(digest).toBe(sha256Bytes(encodeCaptureReceipt(fractional)));
    expect(await service.read(request(fractional))).toEqual({ status: 'observed', revision: Number.MAX_SAFE_INTEGER,
      receiptDigest: digest, receipt: fractional, eligibility: { eligible: true } });
    // A hash of pretty serialized store data is not the protocol digest of its parsed value.
    expect(await service.read({ captureId: 'capture-1', receiptDigest: sha256Bytes(JSON.stringify(fractional, null, 2)) }))
      .toEqual({ status: 'conflict', reason: 'receipt-digest-mismatch' });
    expect(getDocument.mock.calls).toEqual(Array.from({ length: 3 }, () => [captureReceiptKey('capture-1')]));
  });

  it('delegates every eligibility outcome exactly, without issuing production trust', async () => {
    const partials = (['x', 'y', 'width', 'height'] as const).map(field => {
      const value = receipt();
      value.imageRectCss[field] += 1e-7;
      return value;
    });
    const cases: readonly (readonly [CaptureReceipt, StaticCaptureEligibility])[] = [
      [{ ...receipt(), producer: { ...receipt().producer, mode: 'qualification' }, fixture: { state: 'unknown', attestedBy: null } },
        { eligible: false, reason: 'not-production' }],
      [{ ...receipt(), fixture: { state: 'unknown', attestedBy: null } }, { eligible: false, reason: 'fixture-unknown' }],
      [{ ...receipt(), fixture: { state: 'known-present', attestedBy: null } }, { eligible: false, reason: 'fixture-present' }],
      ...partials.map(value => [value, { eligible: false, reason: 'partial-extent' }] as const),
      [receipt(), { eligible: true }],
    ];
    for (const [value, expected] of cases) {
      const getDocument = vi.fn(async () => document(value));
      const result = await createCaptureReceiptReadService({ backing: { getDocument } }).read(request(value));
      expect(result.status).toBe('observed');
      if (result.status !== 'observed') throw Error('Expected stored codec evidence');
      expect(result.eligibility).toEqual(expected);
      expect(result.eligibility).toEqual(staticCaptureEligible(value));
      expect(getDocument).toHaveBeenCalledTimes(1);
    }
  });

  it('detaches admitted request primitives before a pending read, including the expected digest', async () => {
    let release!: (value: unknown) => void;
    const pending = new Promise<unknown>(resolve => { release = resolve; });
    const getDocument = vi.fn((_key: string) => pending);
    const service = createCaptureReceiptReadService({ backing: { getDocument } });
    const admitted = request();
    const read = service.read(admitted);
    admitted.captureId = 'capture-2';
    admitted.receiptDigest = `sha256:${'b'.repeat(64)}`;
    release(document());
    const result = await read;
    expect(result).toEqual({ status: 'observed', revision: 7, receiptDigest: goldenDigest,
      receipt: receipt(), eligibility: { eligible: true } });
    expect(getDocument.mock.calls).toEqual([[captureReceiptKey('capture-1')]]);
  });

  it('isolates nested result mutations from authoritative values and later reads with no other capabilities', async () => {
    const stored = document();
    const before = structuredClone(stored);
    const getDocument = vi.fn(async (_key: string) => stored);
    const forbidden = vi.fn(() => { throw Error('only a document read is authorized'); });
    const backing = { getDocument };
    for (const name of ['putDocument', 'commitPuts', 'listDocuments', 'getBlob', 'putBlob', 'hasBlob', 'listBlobs',
      'appendEvent', 'readEvents', 'now', 'mintId', 'fetch', 'preview', 'publishReceipt']) {
      Object.defineProperty(backing, name, { get: forbidden });
    }
    const service = createCaptureReceiptReadService({ backing });
    const first = await service.read(request());
    if (first.status !== 'observed') throw Error('Expected stored codec evidence');
    const changed = first as Mutable<typeof first>;
    changed.revision = 1;
    changed.receiptDigest = `sha256:${'0'.repeat(64)}`;
    changed.receipt.captureId = 'capture-2';
    changed.receipt.producer.appVersion = 'changed';
    changed.receipt.host.sessionId = 'changed';
    changed.receipt.page.state = '#changed';
    changed.receipt.viewport.w = 1;
    changed.receipt.scroll.x = 1;
    changed.receipt.pageExtentCss.width = 1;
    changed.receipt.imageRectCss.width = 1;
    changed.receipt.image.byteLength = 1;
    changed.receipt.time.capturedAt = 'changed';
    if (changed.receipt.time.acquisition) changed.receipt.time.acquisition.start = 'changed';
    changed.receipt.fixture.state = 'unknown';
    changed.eligibility.eligible = false;
    expect(stored).toEqual(before);
    const later = await service.read(request());
    expect(later).toEqual({ status: 'observed', revision: 7, receiptDigest: goldenDigest,
      receipt: receipt(), eligibility: { eligible: true } });
    expect(later).not.toBe(first);
    expect(forbidden).not.toHaveBeenCalled();
    expect(getDocument.mock.calls).toEqual([[captureReceiptKey('capture-1')], [captureReceiptKey('capture-1')]]);
    expect(stored).toEqual(before);
    expect(Object.keys(service)).toEqual(['read']);
  });
});
